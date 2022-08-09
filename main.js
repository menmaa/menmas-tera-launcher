const { app, BrowserWindow, ipcMain } = require('electron');
const keytar = require('keytar');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const loginController = require('./login');
const tl = require('./launcher');
const patcher = require('./patcher');
const installer = require('./installer');
const TeraProxy = require(path.join(process.cwd(), 'proxy/bin/proxy'));
const strings = require('./strings.json');

global.config = (function() {
    try {
        return require(path.join(process.cwd(), 'config.json'));
    } catch (e) {
        let defaultCfg = {
            lang: "uk"
        };
        fs.writeFileSync(path.join(process.cwd(), 'config.json'), JSON.stringify(defaultCfg, null, 4));
        return defaultCfg;
    }
})();

global.patchStatus = {
    status: 0,
    stringId: "UI_TEXT_PATCH_PROGRESS_COMPLETED",
    percentage: 100,
    downloadedSize: null,
    totalSize: null,
    downloadSpeed: null,
    timeRemaining: null,
    errorMessage: null
};

global.TeraProxy = {
    DevMode: false,
    DiscordUrl: "https://discord.gg/YjUnmbgVjX",
    SupportUrl: "https://discord.gg/YjUnmbgVjX",
    GUIMode: false,
    IsAdmin: true
};

const KEYTAR_SERVICE_NAME = "MenmasTERA";

let MessageListener;
let loginData;
let gameStr;
let patcherWay = 0;
let win;
let proxy;
let legacyInstaller = (process.argv.includes("--MT_LEGACY_INSTALLER"));

function createWindow () {
    win = new BrowserWindow({
        width: 1280,
        height: 720,
        transparent: true,
        frame: false,
        resizable: false,
        maximizable: false,
        webPreferences: {
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false,
        }
    });

    win.loadURL(`file://${__dirname}/src/index.html?lang=${global.config.lang}`);

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

    keytar.findCredentials(KEYTAR_SERVICE_NAME).then((result) => {
        if(result[0]) {
            loginData = {
                username: result[0].account,
                token: result[0].password
            };
        }
    }).catch((err) => {
        console.error(err);
    });

    let buildInfoExists = fs.existsSync(path.join(process.cwd(), 'Client/build.json'));

    if(buildInfoExists) {
        let buildInfo = require(path.join(process.cwd(), 'Client/build.json'));

        if(buildInfo.architecture !== "x64") {
            win.webContents.send('patchProgress', 100, strings[global.config.lang]["UI_TEXT_PATCH_PROGRESS_REMOVE_LEGACY_INSTALL"]);

            const rimraf = require('rimraf');
            rimraf(path.join(process.cwd(), 'Client'), (err) => {
                if(err) throw err;
            });

            buildInfoExists = false;
        }
    };

    if(legacyInstaller || buildInfoExists) {
        patcher.checkForUpdates(win);
        patcherWay = 1;
    } else {
        installer.startInstallation(win, () => { patcher.checkForUpdates(win, true) });
        patcherWay = 2;
    }

    win.webContents.on('dom-ready', async () => {
        if(loginData) {
            win.webContents.send('loginResponse', null, loginData.username, false);
        }

        let str = strings[config.lang][global.patchStatus.stringId]
                .replace('${percentage}', global.patchStatus.percentage)
                .replace('${downloadSize}', global.patchStatus.downloadSize)
                .replace('${totalSize}', global.patchStatus.totalSize)
                .replace('${downloadSpeed}', global.patchStatus.downloadSpeed)
                .replace('${timeRemaining}', global.patchStatus.timeRemaining)
                .replace('${errorMessage}', global.patchStatus.errorMessage);

        win.webContents.send('patchProgress', global.patchStatus.percentage, str, global.patchStatus.status);

        axios.get(`https://account.menmastera.com/api/v1/launcher/retrieve_promo_info?locale=${global.config.lang}`).then((response) => {
            win.webContents.send('promotionBannerInfo', response.data);
        }).catch((err) => { console.error(err.message) });

        if(proxy) {
            win.webContents.send('proxy-running', proxy.modManager.failedMods);
        }
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

ipcMain.on('switchLanguage', (event, lang) => {
    config.lang = lang;
    fs.writeFileSync(path.join(process.cwd(), 'config.json'), JSON.stringify(config, null, 4));
    win.loadURL(`file://${__dirname}/src/index.html?lang=${global.config.lang}`);
});

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
    loginData = null;
});

ipcMain.on('abort-login-req', (event) => {
    loginController.cancelAllRequests();
});

ipcMain.on('launchGame', async (event) => {
    try {
        gameStr = await loginController.getServerInfo(loginData.token);
        event.reply('launchGameRes', null);

        tl.launchGame(gameStr, config.lang, (err) => {
            if(err) throw err;
            event.reply('exitGame');
        });
    } catch (err) {
        event.reply('launchGameRes', err);
    }
});

ipcMain.on('patch-paused-state', (event, paused) => {
    if(paused) {
        if(patcherWay == 1) patcher.pauseDownload();
        else if(patcherWay == 2) installer.pauseDownload();
    } else {
        if(patcherWay == 1) patcher.downloadFiles(win);
        else if(patcherWay == 2) installer.startInstallation(win, () => { patcher.checkForUpdates(win, true) });
    }
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