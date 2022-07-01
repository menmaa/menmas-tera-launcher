const { app, BrowserWindow, ipcMain } = require('electron');
const keytar = require('keytar');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const loginController = require('./login');
const tl = require('./launcher');
const TeraProxy = require(path.join(process.cwd(), 'proxy/bin/proxy'));
const patcher = require('./patcher');
const installer = require('./installer');

const KEYTAR_SERVICE_NAME = "MenmasTeraLauncherUwU";

let MessageListener;
let loginData;
let gameStr;
let win;
let proxy;

function createWindow () {
    win = new BrowserWindow({
        width: 839,
        height: 530,
        transparent: true,
        frame: false,
        resizable: false,
        maximizable: false,
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false
        }
    });

    win.loadFile('src/index.html');

    MessageListener = tl.registerMessageListener((message, code) => {
        //console.log(`Received message: ${message}(${code})`);
    
        switch(message) {
            case "ticket": {
                loginController.getServerInfo(loginData.token).then((data) => {
                    gameStr = data;
                    tl.sendMessageToClient('ticket', `{"ticket": "${JSON.parse(gameStr).ticket}", "result-code": 200}`);
                }).catch((err) => {
                    tl.sendMessageToClient('ticket', '{"result-code": 0, "result-message": "No handler"}');
                });
                break;
            }
            case "last_svr": {
                let gs = JSON.parse(gameStr);
                delete gs["user_permission"];
                delete gs["chars_per_server"];
                delete gs["ticket"];
                tl.sendMessageToClient("last_svr", JSON.stringify(gs));
                break;
            }
            case "char_cnt": {
                let gs = JSON.parse(gameStr);
                delete gs["user_permission"];
                delete gs["last_connected_server_id"];
                delete gs["ticket"];
                tl.sendMessageToClient("char_cnt", JSON.stringify(gs));
                break;
            }
            case "gameEvent":
            case "endPopup": {
                win.webContents.send('gameMessage', message, code);
                break;
            }
        }
    });

    win.webContents.on('dom-ready', async () => {
        keytar.findCredentials(KEYTAR_SERVICE_NAME).then((result) => {
            if(result[0]) {
                loginData = {
                    username: result[0].account,
                    token: result[0].password
                };
                win.webContents.send('loginResponse', null, loginData.username, false);
            }
        }).catch((err) => {
            console.error(err);
        });

        axios.get('https://account.menmastera.com/api/v1/launcher/retrieve_promo_info').then((response) => {
            win.webContents.send('promotionBannerInfo', response.data);
        }).catch((err) => { console.error(err.message) });

        if(fs.existsSync(path.join(app.getAppPath(), 'install_data', 'dl_complete'))) {
            win.webContents.send('predownloadProgress', 100, 'Predownload Completed', 4);
        }

        patcher.checkForUpdates(win);
    });

    // Redirect console to built-in one
    const nodeConsole = require("console");
    console = new nodeConsole.Console(process.stdout, process.stderr);

    const old_stdout = process.stdout.write;
    process.stdout.write = function (msg, ...args) {
        old_stdout(msg, ...args);
        log(msg, "log");
    };
    const old_stderr = process.stderr.write;
    process.stderr.write = function (msg, ...args) {
        old_stderr(msg, ...args);
        if(msg.startsWith("warn:"))
            log(msg.replace("warn:", ""), "warn");
        else 
            log(msg, "error");
    };
}

app.whenReady().then(() => {
    require('./update')(createWindow);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

function log(msg, type) {
    win.webContents.send('console-log', msg, type);
}

ipcMain.on('loginRequest', async (event, username, password, rememberMe) => {
    try {
        if(loginData && loginData.username === username && password === "password") {
            event.reply('loginResponse', null, username, true);
            return;
        }

        let result = await loginController.login(username, password);
        if(loginData) {
            loginController.logout(loginData.token);
            keytar.deletePassword(KEYTAR_SERVICE_NAME, loginData.username);
        }
        loginData = Object.assign({}, result);

        if(rememberMe) {
            keytar.setPassword(KEYTAR_SERVICE_NAME, result.username, result.token);
        }

        event.reply('loginResponse', null, result.username, true);
    } catch (err) {
        event.reply('loginResponse', err);
    }
});

ipcMain.on('logoutRequest', (event) => {
    loginController.logout(loginData.token);
    keytar.deletePassword(KEYTAR_SERVICE_NAME, loginData.username);
});

ipcMain.on('abort-login-req', (event) => {
    loginController.cancelAllRequests();
});

ipcMain.on('launchGame', async (event, startVulkan) => {
    try {
        gameStr = await loginController.getServerInfo(loginData.token);

        let vulkanPathEnabled = path.join(process.cwd(), 'Client/Binaries/d3d9.dll');
        let vulkanPathDisabled = path.join(process.cwd(), 'Client/Binaries/d3d9.dis');

        if(startVulkan && !fs.existsSync(vulkanPathEnabled))
            fs.renameSync(vulkanPathDisabled, vulkanPathEnabled);
        else if(!startVulkan && !fs.existsSync(vulkanPathDisabled)) {
            fs.renameSync(vulkanPathEnabled, vulkanPathDisabled);
        }

        event.reply('launchGameRes', null);

        tl.launchGame(gameStr, (err) => {
            if(err) throw err;
            event.reply('exitGame');
        });
    } catch (err) {
        event.reply('launchGameRes', err);
    }
});

ipcMain.on('patch-paused-state', (event, paused) => {
    if(paused) {
        patcher.pauseDownload();
    } else {
        patcher.downloadFiles(win);
    }
});

ipcMain.on('predownloadStart', (event) => {
    installer.startInstallation(win);
});

ipcMain.on('predownload-paused-state', (event, paused) => {
    if(paused)
        installer.pauseDownload();
    else
        installer.startInstallation(win);
});

ipcMain.on('repair-client', (event) => {
    patcher.checkForUpdates(win, true);
});

ipcMain.on('window-minimize', (event) => {
    BrowserWindow.getFocusedWindow().minimize();
});

ipcMain.on('window-close', (event) => {
    ipcMain.removeAllListeners();
    BrowserWindow.getFocusedWindow().close();
    app.quit();
});

ipcMain.on('startProxy', (event) => {
    global.TeraProxy = {
        DevMode: false,
        DiscordUrl: "https://discord.gg/YjUnmbgVjX",
        SupportUrl: "https://discord.gg/YjUnmbgVjX",
        GUIMode: false,
        IsAdmin: true
    };

    let DataFolder = path.join(process.cwd(), 'proxy', 'data');
    let ModuleFolder = path.join(process.cwd(), 'proxy', 'mods');

    proxy = new TeraProxy(ModuleFolder, DataFolder, {
        uilanguage: 'en',
        devmode: false,
        noslstags: true,
        noserverautojoin: false
    }, () => {
        event.sender.send('proxy-running', proxy.modManager.failedMods);
    }, (e) => {
        event.sender.send('proxy-stopped', e);
    });
    proxy.run();
});

ipcMain.on('stopProxy', (event) => {
    if(proxy) {
        proxy.destructor();
        proxy = null;

        event.sender.send('proxy-stopped');
    }
});

process.on('exit', () => { 
    MessageListener;

    if(proxy) {
        proxy.destructor();
        proxy = null;
    }
});