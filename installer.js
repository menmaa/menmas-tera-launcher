const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const MultiStream = require('multistream');
const unzipper = require('unzipper');
const crypto = require('crypto');
const rimraf = require('rimraf');
const strings = require('./strings.json');

const PATCH_HOSTNAME = 'emilia.menmastera.com';
const PATCH_PATH = '/download';
const DOWNLOAD_PATH = path.join(process.cwd(), 'install_data');

let toDownload = [];
let downloadedSize = 0;
let totalSize = 0;
let totalSizeFormatted;
let patchProgressUpdate;
let lastDownloadedSize = 0;
let skipIntegrityCheck = false;
let currentHttpReq;
let agent = new https.Agent({
    keepAlive: true,
    maxSockets: 1,
    keepAliveMsecs: 15000,
    timeout: 30000
});

async function startInstallation(win, callback) {

    if(!skipIntegrityCheck) 
        updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_RETRIEVING_INFO", 100);

    try {
        let buildInfo = await getInstallBuildInfo();
        totalSize = buildInfo.totalSize;
        totalSizeFormatted = formatBytes(totalSize);

        if(!fs.existsSync(DOWNLOAD_PATH)) {
            fs.mkdirSync(DOWNLOAD_PATH);

            updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_PREALLOCATING", 0);

            for(let i = 0; i < buildInfo.fileList.length; i++ ) {
                let file = buildInfo.fileList[i];
                fs.writeFileSync(path.join(DOWNLOAD_PATH, file.name), Buffer.allocUnsafe(0));
                toDownload.push(Object.assign({}, file, { startOffset: 0 }));
                updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_PREALLOCATING", Math.trunc(((i+1)/buildInfo.fileList) * 100));
            }

            skipIntegrityCheck = true;
        }

        if(!skipIntegrityCheck) {
            toDownload = [];
            downloadedSize = 0;
            lastDownloadedSize = 0;

            for(let sfIdx = 0; sfIdx < buildInfo.fileList.length; sfIdx++) {
                updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_CHECKING_EXISTING", Math.trunc(sfIdx / buildInfo.fileList.length * 100));

                let remoteFile = buildInfo.fileList[sfIdx];
                let filePath = path.join(DOWNLOAD_PATH, remoteFile.name);

                if(!fs.existsSync(filePath)) {
                    fs.writeFileSync(filePath, Buffer.allocUnsafe(0));
                    toDownload.push(Object.assign({}, remoteFile, { startOffset: 0 }));
                    continue;
                }

                let fileSize = fs.statSync(filePath).size;

                if(fileSize == 0 || fileSize > remoteFile.size) {
                    fs.writeFileSync(filePath, Buffer.allocUnsafe(0));
                    toDownload.push(Object.assign({}, remoteFile, { startOffset: 0 }));
                    continue;
                }

                if(fileSize < remoteFile.size) {
                    let res = await axios.get(`https://${PATCH_HOSTNAME + PATCH_PATH}/${buildInfo.fileList[sfIdx].sha1}`, {
                        responseType: 'arraybuffer',
                        headers: { 'Range': `bytes=0-${fileSize-1}` }
                    });

                    let hash1 = crypto.createHash('sha1').update(res.data).digest('hex');
                    let hash2 = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
                    let startOffset = 0;

                    if(hash1 === hash2) {
                        startOffset = fileSize;
                        downloadedSize += fileSize;
                    } else {
                        fs.writeFileSync(filePath, Buffer.allocUnsafe(0));
                    }

                    toDownload.push(Object.assign({}, remoteFile, { startOffset }));
                    continue;
                }

                let same = await new Promise((resolve, reject) => {
                    fs.readFile(filePath, (err, data) => {
                        if(err) {
                            reject(err);
                            return;
                        }

                        let hash = crypto.createHash('sha1').update(data).digest('hex');
                        resolve(hash === remoteFile.sha1);
                    });
                });

                if(!same) {
                    toDownload.push(Object.assign({}, remoteFile, { startOffset: 0 }));
                    continue;
                }

                downloadedSize += fileSize;
            }

            skipIntegrityCheck = true;
        }

        if(downloadedSize < totalSize) {
            patchProgressUpdate = setInterval(() => {
                let downloadSpeed = downloadedSize - lastDownloadedSize;
                let percentage = (Math.trunc(downloadedSize / totalSize * 10000) / 100).toFixed(2);
                let downloadSizeFormatted = formatBytes(downloadedSize);
                let downloadSpeedFormatted = formatBytes(downloadSpeed) + "/s";
                let timeRemaining = (downloadSpeed <= 0 ? "infinite" : secondsToTime((totalSize - downloadedSize) / downloadSpeed));
                lastDownloadedSize = downloadedSize;

                updatePatchProgress(win, 2, 'UI_TEXT_PATCH_PROGRESS_DOWNLOADING_FILES', percentage, downloadSizeFormatted, totalSizeFormatted, downloadSpeedFormatted, timeRemaining);
            }, 1000);

            while(toDownload.length > 0) {
                let part = toDownload[0];
                let dlPath = path.join(DOWNLOAD_PATH, part.name);
                let fstream = fs.createWriteStream(dlPath, { flags: 'r+', start: part.startOffset });

                let reqOptions = {
                    agent,
                    hostname: PATCH_HOSTNAME,
                    path: `${PATCH_PATH}/${part.sha1}`,
                    headers: {
                        'Range': `bytes=${part.startOffset}-${part.size-1}`
                    }
                };

                await new Promise(async (resolve, reject) => {
                    currentHttpReq = https.get(reqOptions, (response) => {
                        if(response.statusCode != 200 && response.statusCode != 206) {
                            reject(new Error('Could not retrieve installation files. The server responded with a status code of ' + response.statusCode + '.'));
                            return;
                        }
                        response.pipe(fstream);

                        response.on('data', (chunk) => {
                            downloadedSize += chunk.length;
                            part.startOffset += chunk.length;
                        });

                        response.on('end', () => {
                            if(response.complete) {
                                resolve();
                            }
                        });
                    });

                    currentHttpReq.on('timeout', () => {
                        currentHttpReq.destroy(new Error('Connection Timed Out'));
                    });

                    currentHttpReq.on('error', (err) => {
                        reject(err);
                    });
                });

                await verifyIntegrity(part.sha1, dlPath);

                toDownload.splice(0, 1);
            }

            clearInterval(patchProgressUpdate);
        }

        let partList = buildInfo.fileList.map((part) => fs.createReadStream(path.join(DOWNLOAD_PATH, part.name)));
        let zipFile = new MultiStream(partList).pipe(unzipper.Parse({ forceStream: true }));
        let amount = buildInfo.entryCount, i = 1;

        for await (let entry of zipFile) {
            if(entry.type == 'Directory') {
                if(!fs.existsSync(entry.path))
                    fs.mkdirSync(entry.path, { recursive: true });
                entry.autodrain();
            } else if(entry.type == 'File') {
                entry.pipe(fs.createWriteStream(path.join(process.cwd(), entry.path)));
            }

            let percentage = (Math.trunc((i++) / amount * 10000) / 100).toFixed(2);
            updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_EXTRACTING_FILES", percentage);
        }

        updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_CLEANING_UP");

        rimraf(DOWNLOAD_PATH, (err) => {
            if(err) throw err;
        });

        updatePatchProgress(win, 0, "UI_TEXT_PATCH_PROGRESS_COMPLETED");

        if(callback)
            callback();
    } catch (err) {
        clearInterval(patchProgressUpdate);
        if(err instanceof DownloadPauseError) {
            let percentage = (Math.trunc(downloadedSize / totalSize * 10000) / 100).toFixed(2);
            let downloadSizeFormatted = formatBytes(downloadedSize);
            let toDownloadSizeFormatted = formatBytes(totalSize);
            updatePatchProgress(win, 3, "UI_TEXT_PATCH_PROGRESS_DOWNLOAD_PAUSED", percentage, downloadSizeFormatted, toDownloadSizeFormatted);
        } else {
            console.error(err);
            skipIntegrityCheck = false;
            updatePatchProgress(win, 1, "UI_TEXT_PATCH_PROGRESS_FAILED", null, null, null, null, null, err.message);
        }
    }
}

function updatePatchProgress(win, status, stringId, percentage = 100, downloadSize, totalSize, downloadSpeed, timeRemaining, errorMessage) {
    global.patchStatus.status = status;
    global.patchStatus.stringId = stringId;
    global.patchStatus.percentage = percentage;
    global.patchStatus.downloadSize = downloadSize;
    global.patchStatus.totalSize = totalSize;
    global.patchStatus.downloadSpeed = downloadSpeed;
    global.patchStatus.timeRemaining = timeRemaining;
    global.patchStatus.errorMessage = errorMessage;

    let str = strings[config.lang][stringId]
            .replace('${percentage}', percentage)
            .replace('${downloadSize}', downloadSize)
            .replace('${totalSize}', totalSize)
            .replace('${downloadSpeed}', downloadSpeed)
            .replace('${timeRemaining}', timeRemaining)
            .replace('${errorMessage}', errorMessage);

    win.webContents.send('patchProgress', percentage, str, status);
}

function getInstallBuildInfo() {
    return new Promise((resolve, reject) => {
        axios.get(`https://${PATCH_HOSTNAME + PATCH_PATH}/build.json`)
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

function verifyIntegrity(expectedHash, filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if(err) {
                reject(err);
                return;
            }

            let hash = crypto.createHash('sha1').update(data).digest('hex');

            if(hash !== expectedHash) {
                reject(new Error('Integrity Verification failed for file ' + path.basename(filePath) + '. Please restart download.'));
                return;
            }

            resolve();
        });
    });
}

class DownloadPauseError extends Error {
    constructor(message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
    }
}

module.exports = { startInstallation, pauseDownload: () => { currentHttpReq.destroy(new DownloadPauseError('Download paused.')); } };