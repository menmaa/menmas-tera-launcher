const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const http = require('http');
const https = require('https');
const retry = require('retry');

const MAX_DOWNLOAD_SPEED_VALUES = 10;
const PATCH_URL = 'http://patch.menmastera.com';

let patchProgressUpdate;
let downloadedFiles = {};
let buildVersion;
let cancellationSource;
let toDownload = [];
let toDownloadSize = 0;
let toDownloadSizeFormatted;
let downloadedSize = 0;
let lastDownloadedSize = 0;
let downloadSpeeds = new Array(MAX_DOWNLOAD_SPEED_VALUES).fill(0);
let agent = axios.create({
    baseURL: PATCH_URL,
    method: 'get',
    responseType: 'stream',
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 60000
});

async function checkForUpdates(win, skipCheck = false) {
    patchProgressUpdate = null;
    downloadedFiles = {};
    buildVersion = null;
    cancellationSource = null;
    toDownload = [];
    toDownloadSize = 0;
    toDownloadSizeFormatted = null;
    downloadedSize = 0;
    lastDownloadedSize = 0;

    win.webContents.send('patchProgress', 100, "Checking for updates...", 1);

    try {
        if(fs.existsSync("Client/build.json") && !skipCheck) {
            let buildData = JSON.parse(fs.readFileSync("Client/build.json", 'utf8'));

            let localBuildVersion = buildData.buildVersion;
            let remoteBuildVersion = await getLatestBuildVersion();

            if(localBuildVersion === remoteBuildVersion) {
                win.webContents.send('patchProgress', 100, "Completed", 0);
                return;
            }

            downloadedFiles = Object.assign({}, buildData.files);
        }

        win.webContents.send('patchProgress', 100, "Retrieving patch information...", 1);
        let patchInfo = await getLatestBuildInfo();
        buildVersion = patchInfo.buildVersion;
        
        win.webContents.send('patchProgress', 0, "Checking existing files...", 1);

        for (let i in patchInfo.entries) {
            let entry = patchInfo.entries[i];

            if(entry.directory) {
                if(!fs.existsSync(entry.file))
                    fs.mkdirSync(entry.file, { recursive: true });
                continue;
            };

            if(downloadedFiles[entry.file] && !skipCheck) {
                if(downloadedFiles[entry.file] !== entry.sha1) {
                    toDownload.push({ path: entry.file, hash: entry.sha1 });
                    toDownloadSize += entry.size;
                }
            } else if(!(await checkFileIntegrity(entry))) {
                toDownload.push({ path: entry.file, hash: entry.sha1 });
                toDownloadSize += entry.size;
            } else downloadedFiles[entry.file] = entry.sha1;

            let percentage = (Math.trunc(i / patchInfo.entries.length * 10000) / 100).toFixed(2);
            win.webContents.send('patchProgress', percentage, `Checking existing files ${percentage}%...`, 1);
        }
        toDownloadSizeFormatted = formatBytes(toDownloadSize);

        downloadFiles(win);
    } catch (err) {
        clearInterval(patchProgressUpdate);
        win.webContents.send('patchProgress', 0, `Failed to patch. Please check your internet connection and try again. (${err.message})`, 1);
    }
}

async function downloadFiles(win) {
    try {
        if(toDownload.length > 0) {
            downloadSpeeds = new Array(MAX_DOWNLOAD_SPEED_VALUES).fill(0);

            patchProgressUpdate = setInterval(() => {
                downloadSpeeds.shift();
                downloadSpeeds.push(downloadedSize - lastDownloadedSize);

                let averageDownloadSpeed = 0;
                downloadSpeeds.forEach((speed) => averageDownloadSpeed += speed);
                averageDownloadSpeed /= MAX_DOWNLOAD_SPEED_VALUES;

                let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
                let downloadSizeFormatted = formatBytes(downloadedSize);
                let downloadSpeedFormatted = formatBytes(averageDownloadSpeed) + "/s";
                let timeRemaining = (averageDownloadSpeed <= 0 ? "infinite" : secondsToTime((toDownloadSize - downloadedSize) / averageDownloadSpeed));
                lastDownloadedSize = downloadedSize;

                let str = `Downloading Files ${percentage}%... (${downloadSizeFormatted}/${toDownloadSizeFormatted} - ${downloadSpeedFormatted} - ETA: ${timeRemaining})`;
                win.webContents.send('patchProgress', percentage, str, 2);
            }, 1000);

            let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
            let downloadSizeFormatted = formatBytes(downloadedSize);
            win.webContents.send('patchProgress', percentage, `Downloading Files ${percentage}%... (${downloadSizeFormatted}/${toDownloadSizeFormatted})`, 2);

            for(let { hash, path } of [...toDownload]) {
                await new Promise((resolve, reject) => {
                    cancellationSource = axios.CancelToken.source();
                    let operation = retry.operation({
                        retries: 5,
                        factor: 2,
                        minTimeout: 1 * 1000,
                        maxTimeout: 5 * 1000
                    });

                    try {
                        if(fs.existsSync(path))
                            fs.unlinkSync(path);
                    } catch(err) {
                        reject(err);
                    }

                    operation.attempt(function() {
                        agent.get(`/${path.replaceAll('\\', '/')}`, { cancelToken: cancellationSource.token }).then((response) => {
                            let fstream = fs.createWriteStream(path, { mode: 0o777 });
                            let thisDownloadedSize = 0;
                            response.data.pipe(fstream);

                            response.data.on('data', function(chunk) {
                                downloadedSize += chunk.length;
                                thisDownloadedSize += chunk.length;
                            });

                            response.data.on('end', function() {
                                if(response.data.complete) {
                                    downloadedFiles[path] = hash;
                                    toDownload.shift();
                                    resolve();
                                } else {
                                    downloadedSize -= thisDownloadedSize;
                                    if(!operation.retry(new Error('Connection interrupted'))) {
                                        reject(operation.mainError());
                                    }
                                }
                            });
                        }).catch((err) => {
                            if(!axios.isCancel(err) && !operation.retry(err)) {
                                reject(operation.mainError());
                            } else if(axios.isCancel(err)) {
                                reject(err);
                            }
                        });
                    });
                });
            }
        }

        clearInterval(patchProgressUpdate);
        win.webContents.send('patchProgress', 100, "Completed", 0);

        fs.writeFile('Client/build.json', JSON.stringify({ files: downloadedFiles, buildVersion }), (err) => {
            if(err) throw err;
        });
    } catch(err) {
        clearInterval(patchProgressUpdate);
        if(axios.isCancel(err)) {
            let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
            let downloadSizeFormatted = formatBytes(downloadedSize);
            let toDownloadSizeFormatted = formatBytes(toDownloadSize);
            win.webContents.send('patchProgress', percentage, `Download paused ${percentage}%. (${downloadSizeFormatted}/${toDownloadSizeFormatted})`, 3);
        } else
            win.webContents.send('patchProgress', 0, `Failed to patch. Please check your internet connection and try again. (${err.message})`, 1);
    }
}

function getLatestBuildVersion() {
    return new Promise((resolve, reject) => {
        axios.get(PATCH_URL + '/latest')
        .then((response) => {
            if(response.status === 200) {
                resolve(response.data.latest);
            } else {
                reject(response.status + ": " + response.statusText);
            }
        })
        .catch((err) => {
            reject(err);
        });
    });
}

function getLatestBuildInfo() {
    return new Promise((resolve, reject) => {
        axios.get(PATCH_URL + '/latest/download')
        .then((response) => {
            if(response.status === 200) {
                resolve(response.data);
            } else {
                reject(response.status + ": " + response.statusText);
            }
        })
        .catch((err) => {
            reject(err);
        });
    });
}

function checkFileIntegrity(fileInfo) {
    return new Promise((resolve, reject) => {
        if(!fs.existsSync(fileInfo.file))
            return resolve(false);

        fs.readFile(fileInfo.file, (err, data) => {
            if(err) return reject(err);

            let sha1 = crypto.createHash('sha1').update(data).digest('hex');

            if(fileInfo.sha1 === sha1)
                return resolve(true);

            return resolve(false);
        });
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes <= 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat(bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i];
}

function secondsToTime(s) {
    let secs = s % 60;
    s = (s - secs) / 60;
    let mins = s % 60;
    let hrs = (s - mins) / 60;
  
    let str = "";

    if(hrs > 0)
        str += hrs + "h, ";

    if(mins > 0)
        str += mins + "m, ";

    return str + Math.floor(secs) + 's';
}

module.exports = { checkForUpdates, downloadFiles, pauseDownload: () => { cancellationSource.cancel('Download paused.') } }