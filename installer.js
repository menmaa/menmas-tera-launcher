const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const PATCH_HOSTNAME = 'emilia.menmastera.com';
const PATCH_PATH = '/download';
const DOWNLOAD_PATH = path.join(process.cwd(), 'install_data');

let currentHttpReq;
let agent = new https.Agent({
    keepAlive: true,
    maxSockets: 1,
    keepAliveMsecs: 5000,
    timeout: 20000
});

async function startInstallation(win, callback) {
    win.webContents.send('predownloadProgress', 100, "Retrieving Information...", 4);

    let downloadedSize = 0;
    let toDownloadSize = 0;
    let patchProgressUpdate;
    let lastOffset = 0;
    let startingFileIndex = 0;

    try {
        let buildInfo = await getInstallBuildInfo();

        if(!fs.existsSync(DOWNLOAD_PATH))
            fs.mkdirSync(DOWNLOAD_PATH);

        toDownloadSize = buildInfo.totalSize;

        win.webContents.send('predownloadProgress', 100, "Checking existing files. Please wait. This may take a while...", 4);

        for(; startingFileIndex < buildInfo.fileList.length; startingFileIndex++) {
            let filePath = path.join(DOWNLOAD_PATH, buildInfo.fileList[startingFileIndex].name);
            if(!fs.existsSync(filePath))
                break;

            let fileSize = fs.statSync(filePath).size;
            if(fileSize < 2)
                break;

            downloadedSize += fileSize;

            if(fileSize < buildInfo.fileList[startingFileIndex].size) {
                let res = await axios.get(`https://${PATCH_HOSTNAME + PATCH_PATH}/${buildInfo.fileList[startingFileIndex].sha1}`, {
                    responseType: 'arraybuffer',
                    headers: { 'Range': `bytes=0-${fileSize-1}` }
                });

                let hash1 = crypto.createHash('sha1').update(res.data).digest('hex');
                let hash2 = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');

                if(hash1 === hash2) {
                    lastOffset = fileSize;
                } else {
                    lastOffset = 0;
                    downloadedSize -= fileSize;
                }
                break;
            } else if(fileSize > buildInfo.fileList[startingFileIndex].size) {
                lastOffset = 0;
                downloadedSize -= fileSize;
                fs.writeFileSync(filePath, Buffer.allocUnsafe(0));
                break;
            } else {
                let same = await new Promise((resolve, reject) => {
                    fs.readFile(filePath, (err, data) => {
                        if(err)
                            reject(err);

                        let hash = crypto.createHash('sha1').update(data).digest('hex');
                        resolve(hash === buildInfo.fileList[startingFileIndex].sha1);
                    });
                });

                if(!same) {
                    lastOffset = 0;
                    downloadedSize -= fileSize;
                    break;
                }
            }
        }

        if(downloadedSize < toDownloadSize) {
            patchProgressUpdate = setInterval(() => {
                let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
                let downloadSizeFormatted = formatBytes(downloadedSize);
                let toDownloadSizeFormatted = formatBytes(toDownloadSize);

                let str = `Downloading Files ${percentage}%... (${downloadSizeFormatted}/${toDownloadSizeFormatted})`;
                win.webContents.send('predownloadProgress', percentage, str, 2);
            }, 1000);

            win.webContents.send('predownloadProgress', 0, 'Downloading Files...', 2);

            for(let i = startingFileIndex; i < buildInfo.parts; i++) {
                let part = buildInfo.fileList[i];
                let dlPath = path.join(DOWNLOAD_PATH, part.name);

                if(!fs.existsSync(dlPath)) {
                    fs.writeFileSync(dlPath, Buffer.allocUnsafe(0));
                }

                let fstream = fs.createWriteStream(dlPath, { flags: 'r+', start: lastOffset });

                let reqOptions = {
                    agent,
                    hostname: PATCH_HOSTNAME,
                    path: `${PATCH_PATH}/${part.sha1}`,
                    headers: {
                        'Range': `bytes=${lastOffset}-${part.size-1}`
                    }
                };

                await new Promise(async (resolve, reject) => {
                    currentHttpReq = https.get(reqOptions, (response) => {
                        if(response.statusCode != 200 && response.statusCode != 206) {
                            reject(new Error('Could not retrieve installation files. The server responded with a status code of ' + response.statusCode + '.'));
                        }
                        response.pipe(fstream);

                        response.on('data', (chunk) => {
                            downloadedSize += chunk.length;
                            lastOffset += chunk.length;
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

                lastOffset = 0;
                await verifyIntegrity(part.sha1, dlPath);
            }

            clearInterval(patchProgressUpdate);
        }

        win.webContents.send('predownloadProgress', 100, 'Predownload Completed', 4);
        fs.writeFileSync(path.join(DOWNLOAD_PATH, 'dl_complete'), Buffer.allocUnsafe(0));

        if(callback)
            callback();
    } catch (err) {
        clearInterval(patchProgressUpdate);
        if(err instanceof DownloadPauseError) {
            let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
            let downloadSizeFormatted = formatBytes(downloadedSize);
            let toDownloadSizeFormatted = formatBytes(toDownloadSize);
            win.webContents.send('predownloadProgress', percentage, `Download paused ${percentage}%. (${downloadSizeFormatted}/${toDownloadSizeFormatted})`, 3);
        } else {
            win.webContents.send('predownloadProgress', 0, `Failed to download. Error Message: ${err.message}`, 1);
        }
    }
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

function verifyIntegrity(expectedHash, filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if(err)
                reject(err);

            let hash = crypto.createHash('sha1').update(data).digest('hex');

            if(hash !== expectedHash) {
                reject(new Error('Integrity Verification failed for file ' + path.basename(filePath) + '. Please restart download.'));
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