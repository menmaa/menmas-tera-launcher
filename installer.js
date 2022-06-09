const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const MultiStream = require('multistream');
const unzipper = require('unzipper');

const PATCH_HOSTNAME = 'cdn.menmastera.com';
const PATCH_PATH = '/download';
const DOWNLOAD_PATH = path.join(process.cwd(), 'install_data');

let currentHttpReq;
let agent = new https.Agent({
    keepAlive: true,
    maxSockets: 1,
    keepAliveMsecs: 5000,
    timeout: 5000
});

async function startInstallation(win, callback) {
    win.webContents.send('patchProgress', 100, "Retrieving patch information...", 1);

    let downloadedSize = 0;
    let toDownloadSize = 0;
    let patchProgressUpdate;
    let lastOffset = 0;
    let lastDownloadedSize = 0;
    let startingFileIndex = 0;

    try {
        let buildInfo = await getInstallBuildInfo();

        if(!fs.existsSync(DOWNLOAD_PATH))
            fs.mkdirSync(DOWNLOAD_PATH);

        toDownloadSize = buildInfo.totalSize;
        let toDownloadSizeFormatted = formatBytes(toDownloadSize);

        for(; startingFileIndex < buildInfo.fileList.length; startingFileIndex++) {
            let filePath = path.join(DOWNLOAD_PATH, buildInfo.fileList[startingFileIndex].name);

            if(!fs.existsSync(filePath)) {
                break;
            }

            let fileSize = fs.statSync(filePath).size;
            downloadedSize += fileSize;

            if(fileSize < buildInfo.fileList[startingFileIndex].size) {
                lastOffset = fileSize;
                break;
            }
        }

        if(downloadedSize < toDownloadSize) {
            patchProgressUpdate = setInterval(() => {
                let downloadSpeed = downloadedSize - lastDownloadedSize;
                let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
                let downloadSizeFormatted = formatBytes(downloadedSize);
                let downloadSpeedFormatted = formatBytes(downloadSpeed) + "/s";
                let timeRemaining = (downloadSpeed <= 0 ? "infinite" : secondsToTime((toDownloadSize - downloadedSize) / downloadSpeed));
                lastDownloadedSize = downloadedSize;

                let str = `Downloading Files ${percentage}%... (${downloadSizeFormatted}/${toDownloadSizeFormatted} - ${downloadSpeedFormatted} - ETA: ${timeRemaining})`;
                win.webContents.send('patchProgress', percentage, str, 2);
            }, 1000);

            win.webContents.send('patchProgress', 0, 'Downloading Files...', 2);

            for(let i = startingFileIndex; i < buildInfo.parts; i++) {
                let part = buildInfo.fileList[i];
                let dlPath = path.join(DOWNLOAD_PATH, part.name);
                let fstream = fs.createWriteStream(dlPath, { flags: 'a' });

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
            }

            clearInterval(patchProgressUpdate);
        }

        win.webContents.send('patchProgress', 0, 'Extracting files 0.00%...', 1);

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
            win.webContents.send('patchProgress', percentage, `Extracting files ${percentage}%...`, 1);
        }

        win.webContents.send('patchProgress', 100, 'Completed', 0);

        fs.rm(DOWNLOAD_PATH, { recursive: true, force: true }, (err) => {
            fs.unlink(DOWNLOAD_PATH, () => {});
        });

        if(callback)
            callback();
    } catch (err) {
        clearInterval(patchProgressUpdate);
        if(err instanceof DownloadPauseError) {
            let percentage = (Math.trunc(downloadedSize / toDownloadSize * 10000) / 100).toFixed(2);
            let downloadSizeFormatted = formatBytes(downloadedSize);
            let toDownloadSizeFormatted = formatBytes(toDownloadSize);
            win.webContents.send('patchProgress', percentage, `Download paused ${percentage}%. (${downloadSizeFormatted}/${toDownloadSizeFormatted})`, 3);
        } else {
            win.webContents.send('patchProgress', 0, `Failed to patch. Please check your internet connection and try again. (${err.message})`, 1);
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

class DownloadPauseError extends Error {
    constructor(message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
    }
}

module.exports = { startInstallation, pauseDownload: () => { currentHttpReq.destroy(new DownloadPauseError('Download paused.')); } };