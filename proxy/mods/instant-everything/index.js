const SettingsUI = require('tera-mod-ui').Settings;

exports.NetworkMod = function(mod) {
    const PURPOSES = ['enchant', 'upgrade', 'soulbind', 'merge', 'dismantle'];

    let hooks = {};
    function hook(purpose, ...args) {
        if (!hooks[purpose])
            hooks[purpose] = [];

        hooks[purpose].push(mod.hook(...args));
    }

    let enchanting = null;
    let upgrading = null;
    function enable(purpose) {
        switch (purpose) {
            case 'enchant': {
                if(mod.majorPatchVersion >= 61) {
                    hook('enchant', 'C_REGISTER_ENCHANT_ITEM', 1, event => { enchanting = event });

                    hook('enchant', 'C_START_ENCHANT', 1, event => {
                        if (enchanting && event.contract === enchanting.contract) {
                            mod.send('C_REQUEST_ENCHANT', 1, enchanting);
                            return false;
                        }
                    });

                    hook('enchant', 'C_REQUEST_ENCHANT', 'event', () => false);
                } else {
                    // TODO Classic
                }
                break;
            }

            case 'upgrade': {
                if(mod.majorPatchVersion >= 79) {
                    hook('upgrade', 'C_REGISTER_EVOLUTION_ITEM', 1, event => { upgrading = event });

                    hook('upgrade', 'C_START_EVOLUTION', 1, event => {
                        if (upgrading && event.contract === upgrading.contract) {
                            mod.send('C_REQUEST_EVOLUTION', 1, upgrading);
                            return false;
                        }
                    });

                    hook('upgrade', 'C_REQUEST_EVOLUTION', 'event', () => false);
                }
                break;
            }

            case 'soulbind': {
                hook('soulbind', 'C_BIND_ITEM_BEGIN_PROGRESS', 1, event => {
                    mod.send('C_BIND_ITEM_EXECUTE', 1, {
                        contractId: event.contractId,
                    });

                    process.nextTick(() => {
                        mod.send('S_CANCEL_CONTRACT', 1, {
                            type: 32,
                            id: event.contractId,
                        });
                    });
                });

                hook('soulbind', 'C_BIND_ITEM_EXECUTE', 'event', () => false);
                break;
            }

            case 'merge': {
                hook('merge', 'S_REQUEST_CONTRACT', 1, event => {
                    if (!mod.game.me.is(event.senderId) || event.type != 33)
                        return;

                    mod.send('C_MERGE_ITEM_EXECUTE', 1, {
                        contractId: event.id,
                    });

                    process.nextTick(() => {
                        mod.send('S_CANCEL_CONTRACT', 1, {
                            type: 33,
                            id: event.id,
                        });
                    });
                });

                hook('merge', 'C_MERGE_ITEM_EXECUTE', 'event', () => false);
                break;
            }

            case 'dismantle': {
                if(mod.majorPatchVersion >= 77) {
                    hook('dismantle', 'C_RQ_START_SOCIAL_ON_PROGRESS_DECOMPOSITION', 1, event => {
                        mod.send('C_RQ_COMMIT_DECOMPOSITION_CONTRACT', 1, {
                            contract: event.contract,
                        });
                        return false;
                    });

                    hook('dismantle', 'C_RQ_COMMIT_DECOMPOSITION_CONTRACT', 'event', () => false);
                }
                break;
            }
        }
    }

    function disable(purpose) {
        if (hooks[purpose]) {
            hooks[purpose].forEach(h => mod.unhook(h));
            hooks[purpose] = [];
        }
    }

    // Main
    PURPOSES.forEach(purpose => {
        if (mod.settings[purpose])
            enable(purpose);
    });

    mod.command.add('instant', {
        $default(purpose) {
            if (PURPOSES.indexOf(purpose) < 0) {
                if (ui) {
                    ui.show();
                } else {
                    mod.command.message(purpose ? `Invalid mode: ${purpose}!` : 'Must specify mode!');
                    mod.command.message(`Valid modes: ${PURPOSES.join(', ')}`);
                }

                return;
            }

            if (mod.settings[purpose]) {
                disable(purpose);
                mod.command.message(`Instant ${purpose} disabled!`);
            } else {
                enable(purpose);
                mod.command.message(`Instant ${purpose} enabled!`);
            }

            mod.settings[purpose] = !mod.settings[purpose];
        }
    });

    // Settings UI
    let ui = null;
    if (global.TeraProxy.GUIMode) {
        ui = new SettingsUI(mod, require('./settings_structure'), mod.settings, { height: 232 });
        ui.on('update', settings => { mod.settings = settings; });

        this.destructor = () => {
            if (ui) {
                ui.close();
                ui = null;
            }
        };
    }
};
