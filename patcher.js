const fs = require('graceful-fs');
const crypto = require('crypto');
const axios = require('axios');
const http = require('http');
const { ConcurrencyManager } = require("axios-concurrency");
const retry = require('retry');

const MAX_CONCURRENT_REQUESTS = 5;
const PATCH_URL = 'http://patch.tera.menmasystems.com';

exports.checkForUpdates = async function(win) {
    let patchProgressUpdate;
    let downloadedFiles = {};

    win.webContents.send('patchProgress', 100, "Checking for updates...", false);

    try {
		fs.unlink("Client/build", () => {});
		
        if(fs.existsSync("Client/build.json")) {
            let buildData = JSON.parse(fs.readFileSync("Client/build.json", 'utf8'));

            let localBuildVersion = buildData.buildVersion;
            let remoteBuildVersion = await getLatestBuildVersion();

            if(localBuildVersion === remoteBuildVersion) {
                win.webContents.send('patchProgress', 100, "Completed", true);
                return;
            }

            downloadedFiles = Object.assign({}, buildData.files);
        }

        win.webContents.send('patchProgress', 100, "Retrieving patch information...", false);

        let patchInfo = await getLatestBuildInfo();
        let toDownload = new Map();
        let toDownloadSize = 0;

        win.webContents.send('patchProgress', 0, "Checking existing files...", false);

        for (let i in patchInfo.entries) {
            let entry = patchInfo.entries[i];

            if(entry.directory) {
                if(!fs.existsSync(entry.file))
                    fs.mkdirSync(entry.file, { recursive: true });
                continue;
            };

            if(downloadedFiles[entry.file]) {
                if(downloadedFiles[entry.file] !== entry.sha1) {
                    toDownload.set(entry.sha1, entry.file);
                    toDownloadSize += entry.size;
                }
            } else if(!(await checkFileIntegrity(entry))) {
                toDownload.set(entry.sha1, entry.file);
                toDownloadSize += entry.size;
            } else downloadedFiles[entry.file] = entry.sha1;

            let percentage = (Math.trunc(i / patchInfo.entries.length * 10000) / 100).toFixed(2);
            win.webContents.send('patchProgress', percentage, `Checking existing files ${percentage}%...`, false);
        }

        if(toDownload.size > 0) {
            let downloadedSize = 0;
            let lastDownloadedSize = 0;
            let toDownloadSizeFormatted = formatBytes(toDownloadSize);
            let source = axios.CancelToken.source();
            let agent = axios.create({
                baseURL: PATCH_URL + '/latest/download',
                method: 'get',
                responseType: 'stream',
                cancelToken: source.token,
                httpAgent: new http.Agent({ keepAlive: true })
            });
            let manager = ConcurrencyManager(agent, MAX_CONCURRENT_REQUESTS);
            let errorHandler = function(err) {
                source.cancel(err);
                manager.detach();
                clearInterval(patchProgressUpdate);
                win.webContents.send('patchProgress', 0, `Failed to patch. Please check your internet connection and try again. (${err.message})`, false);
            }

            win.webContents.send('patchProgress', 0, 'Downloading Files...', false);

            Array.from(toDownload.keys()).forEach((entry) => {
                let operation = retry.operation({ retries: 3 });

                operation.attempt(function() {
                    agent.get(`/${entry}`).then((response) => {
                        let hash = response.headers['m-integrity-hash'];

                        if(hash && toDownload.has(hash)) {
                            let file = toDownload.get(hash);
                            let fstream = fs.createWriteStream(file);
                            response.data.pipe(fstream);

                            response.data.on('data', function(chunk) {
                                downloadedSize += chunk.length;
                            });

                            response.data.on('end', function() {
                                if(response.data.complete) {
                                    downloadedFiles[file] = hash;
                                    toDownload.delete(hash);
                                } else if(!operation.retry(new Error('Connection interrupted'))) {
                                    errorHandler(operation.mainError());
                                }
                            });
                        } else if(!operation.retry(new Error('Received unexpected integrity hash'))) {
                            errorHandler(operation.mainError());
                        }
                    }).catch((err) => {
                        if(!axios.isCancel(err) && !operation.retry(err)) {
                            errorHandler(operation.mainError());
                        }
                    });
                });
            });

            patchProgressUpdate = setInterval(() => {
                if(toDownload.size == 0) {
                    manager.detach();
                    clearInterval(patchProgressUpdate);
                    win.webContents.send('patchProgress', 100, "Completed", true);

                    fs.writeFile('Client/build.json', JSON.stringify({ files: downloadedFiles, buildVersion: patchInfo.buildVersion }), (err) => {
                        if(err) throw err;
                    });
                    return;
                }

                let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
                let downloadSizeFormatted = formatBytes(downloadedSize);
                let downloadSpeed = downloadedSize - lastDownloadedSize;
                let downloadSpeedFormatted = formatBytes(downloadSpeed) + "/s";
                let timeRemaining = (downloadSpeed == 0 ? "infinite" : secondsToTime((toDownloadSize - downloadedSize) / downloadSpeed));
                lastDownloadedSize = downloadedSize;

                let str = `Downloading Files ${percentage}%... (${downloadSizeFormatted}/${toDownloadSizeFormatted} - ${downloadSpeedFormatted} - ETA: ${timeRemaining})`;
                win.webContents.send('patchProgress', percentage, str, false);
            }, 1000);
        } else {
            win.webContents.send('patchProgress', 100, "Completed", true);

            fs.writeFile('Client/build.json', JSON.stringify({ files: downloadedFiles, buildVersion: patchInfo.buildVersion }), (err) => {
                if(err) throw err;
            });
        }
    } catch (err) {
        clearInterval(patchProgressUpdate);
        win.webContents.send('patchProgress', 0, `Failed to patch. Please check your internet connection and try again. (${err.message})`, false);
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
    if (bytes === 0) return '0 Bytes';

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