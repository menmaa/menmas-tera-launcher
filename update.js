const { BrowserWindow } = require('electron');
const axios = require('axios');
const http = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const strings = require('./strings.json');

const UPDATE_URL = "https://emilia.menmastera.com/launcher/";

let win;
let finishCallback;

function createWindow(cb) {
    finishCallback = cb;
    win = new BrowserWindow({
        width: 325,
        height: 250,
        transparent: false,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
        }
    });

    win.loadFile('src/update.html');

    win.webContents.on('dom-ready', () => {
        checkForUpdatesAndDownload();
    });
}

async function checkForUpdatesAndDownload() {
    updateStatus('UI_TEXT_UPDATE_CHECK_FOR_UPDATES');

    if(fs.existsSync('./MTLUpdater.exe.bak'))
        fs.unlinkSync('./MTLUpdater.exe.bak');

    if(fs.existsSync('./update-cache')) {
        fs.rmdirSync('./update-cache', { recursive: true });
    }

    try {
        let response = await axios.get(UPDATE_URL + 'manifest.json');
        let manifest = response.data;

        let version = fs.readFileSync('./version.txt', 'utf-8');

        if(version === manifest.version) {
            finishCallback();
            win.close();
            return;
        }

        updateStatus('UI_TEXT_UPDATE_DOWNLOADING_UPDATE', 0);

        fs.mkdirSync('./update-cache');
        let fstream = fs.createWriteStream('./update-cache/' + manifest.path);
        http.get(UPDATE_URL + manifest.path, (res) => {
            if(res.statusCode === 200) {
                res.pipe(fstream);
                let total = Number(res.headers['content-length']);
                let received = 0;

                res.on('data', (chunk) => {
                    received += chunk.length;
                    let percentage = Math.trunc(received / total * 10000) / 100;
                    updateStatus('UI_TEXT_UPDATE_DOWNLOADING_UPDATE', percentage);
                });
            } else {
                fstream.destroy();
                throw new Error('Could not download update. The server responded with a status code of ' + response.statusCode);
            }

            fstream.on('finish', () => {
                if(res.complete) {
                    updateStatus('UI_TEXT_UPDATE_VERIFYING_INTEGRITY');

                    let sha256 = crypto.createHash('sha256').update(fs.readFileSync('./update-cache/' + manifest.path)).digest('hex');

                    if(sha256 === manifest.hash) {
                        updateStatus('UI_TEXT_UPDATE_INSTALLING_UPDATE');

                        fstream.close(() => {
                            startProcess('update-cache\\' + manifest.path, "\"Menma's TERA.exe\"");
                            win.close();
                        });
                    } else throw new Error(`Integrity verification failed. Expected hash ${manifest.hash}, got ${sha256}.`);
                }
            });
        }).on('error', (err) => {
            fstream.destroy();
            throw err;
        });
    } catch (e) {
        updateStatus('UI_TEXT_UPDATE_FAILED');
        console.error(e);

        setTimeout(function() {
            finishCallback();
            win.close();
        }, 5000);
    }
}

function startProcess(archivePath, launcherPath) {
    let child = spawn('start "MTL Updater"', ['MTLUpdater.exe', archivePath, launcherPath], { detached: true, shell: true });
    child.unref();
}

function updateStatus(stringId, percentage) {
    win.webContents.send('updateStatus', strings[global.config.lang][stringId].replace('${percentage}', percentage));
}

module.exports = createWindow;