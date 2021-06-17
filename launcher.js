const ffi = require('ffi-napi');

const SLS_URL = "https://tera.menmasystems.com/server/serverlist.uk";

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

function launchGame(gamestr, cb) {
    teraLauncher.LaunchGame.async(SLS_URL, gamestr, cb);
}

function launchGameSync(gamestr) {
    teraLauncher.LaunchGame(SLS_URL, gamestr);
}

function sendMessageToClient(msg, content) {
    teraLauncher.SendMessageToClient(msg, content);
}

module.exports = { launchGame, launchGameSync, registerMessageListener, sendMessageToClient };