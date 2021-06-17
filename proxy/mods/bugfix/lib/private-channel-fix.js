// Fixes a regression introduced in patch 90 causing private channels to not show up properly in your chat window when re-joining them on login
// Written by: Caali

module.exports = function PrivateChannelFix(mod) {
    if (mod.majorPatchVersion < 90)
        return;

    let queue = [];
    let passthrough = false;

    mod.hook('S_LOGIN', 'event', () => {
        passthrough = false;
    });

    mod.hook('S_JOIN_PRIVATE_CHANNEL', 'raw', (_, data) => {
        if (!passthrough) {
            queue.push(data);
            return false;
        }
    });

    mod.hook('S_REPLY_CLIENT_CHAT_OPTION_SETTING', 'event', () => {
        let i = 0;
        queue.forEach(data => mod.setTimeout(() => {
            mod.toClient(data);
        }, 2000 + 250 * i++));

        passthrough = true;
        queue = [];
    });
};
