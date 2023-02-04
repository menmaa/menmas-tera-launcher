const ffi = require('ffi-napi');

const SLS_URL = (global.environment === "TEST" ? "https://emilia.menmastera.com/serverlist/test/" : "https://emilia.menmastera.com/serverlist/live/");

const teraLauncher = ffi.Library('./Teralauncher.dll', {
    'LaunchGame': [
        'void', ['string', 'string']
    ],
    'RegisterMessageListener': [
        'void', ['pointer']
    ],
    'SendMessageToClient': [
        'void', ['string', 'string']
    ]
});

function registerMessageListener(listener) {
    let cb = ffi.Callback('void', ['string', 'int'], listener);
    teraLauncher.RegisterMessageListener(cb);
    return cb;
}

function launchGame(gamestr, lang, cb) {
    teraLauncher.LaunchGame.async(SLS_URL + lang, gamestr, cb);
}

function launchGameSync(gamestr) {
    teraLauncher.LaunchGame(SLS_URL, gamestr);
}

function sendMessageToClient(msg, content) {
    teraLauncher.SendMessageToClient(msg, content);
}

module.exports = { launchGame, launchGameSync, registerMessageListener, sendMessageToClient };