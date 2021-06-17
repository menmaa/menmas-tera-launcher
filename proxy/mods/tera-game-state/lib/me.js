const EventEmitter = require('events');

class Me extends EventEmitter {
    constructor(parent) {
        super();
        this.setMaxListeners(0);

        this.parent = parent;

        // TODO: check if we're not ingame. if we are, fail!

        this.reset();
        this.installHooks();
    }

    destructor() {
        this.reset();
        this.parent = undefined;
    }

    initialize(feature) {
        switch (feature) {
            case 'abnormalities':
                if (!this.abnormalities) {
                    this.abnormalities = {};
                    this.installHooksAbnormalities();
                }
                break;
            default:
                throw new Error(`Invalid feature "me.${feature}"!`);
        }
    }

    installHook(name, version, cb) {
        return this.parent.mod.hook(name, version, { order: -10000, filter: { fake: null, modified: null, silenced: null } }, cb);
    }

    tryInstallHook(name, version, cb) {
        return this.parent.mod.tryHook(name, version, { order: -10000, filter: { fake: null, modified: null, silenced: null } }, cb);
    }

    installHooks() {
        this.installHook('S_LOGIN', 14, (event) => {
            this.gameId = event.gameId;
            this.playerId = event.playerId;

            this.setTemplate(event.templateId);
            this.setName(event.name);
            this.setLevel(event.level);
            this.setStatus(event.status);
            this.setAlive(event.alive);
        });

        if (this.parent.mod.majorPatchVersion >= 99) {
            this.installHook('TTB_S_CHANGE_HERO', 1, (event) => {
                if (this.is(event.gameId))
                    this.setTemplate(event.templateId);
            });
        }

        this.installHook('S_LOAD_TOPO', 3, (event) => {
            this.setMount(null, null);
            this.setZone(event.zone, event.quick);
        });

        this.installHook('S_SPAWN_ME', 3, (event) => {
            this.setAlive(event.alive);
        });

        this.installHook('S_CREATURE_LIFE', 3, (event) => {
            if (this.is(event.gameId))
                this.setAlive(event.alive);
        });

        this.installHook('S_MOUNT_VEHICLE', 2, (event) => {
            if (this.is(event.gameId))
                this.setMount(event.id, event.skill);
        });

        this.installHook('S_UNMOUNT_VEHICLE', 2, (event) => {
            if (this.is(event.gameId))
                this.setMount(null, null);
        });

        if (!this.tryInstallHook('S_USER_CHANGE_NAME', 1, (event) => {
            if (this.is(event.gameId))
                this.setName(event.name);
        })) {
            this.parent.mod.warn('Unable to hook S_USER_CHANGE_NAME. Some functionality will be broken. If you are not playing on the Korean servers, please report this!');
        }

        if (!this.tryInstallHook('S_USER_LEVELUP', 2, (event) => {
            if (this.is(event.gameId))
                this.setLevel(event.level);
        })) {
            this.parent.mod.warn('Unable to hook S_USER_LEVELUP. Some functionality will be broken. If you are not playing on the Korean servers, please report this!');
        }

        this.installHook('S_USER_STATUS', 3, (event) => {
            if (this.is(event.gameId))
                this.setStatus(event.status);
        });

        this.parent.on('leave_game', () => { this.reset(); });
    }

    installHooksAbnormalities() {
        this.installHook('S_ABNORMALITY_BEGIN', 3, (event) => {
            if (this.is(event.target)) {
                const abnormalitydata = this.parent.data.abnormalities;
                const id = event.id;
                const until = Date.now() + event.duration;
                this.abnormalities[id] = {
                    id,
                    stacks: event.stacks,
                    until,
                    get remaining() { return Math.max(0, until - Date.now()); },
                    get data() { return abnormalitydata.get(id); }
                };
            }
        });

        this.installHook('S_ABNORMALITY_REFRESH', 1, (event) => {
            if (this.is(event.target)) {
                const abnormalitydata = this.parent.data.abnormalities;
                const id = event.id;
                const until = Date.now() + event.duration;
                this.abnormalities[id] = {
                    id,
                    stacks: event.stacks,
                    until,
                    get remaining() { return Math.max(0, until - Date.now()); },
                    get data() { return abnormalitydata.get(id); }
                };
            }
        });

        this.installHook('S_ABNORMALITY_END', 1, (event) => {
            if (this.is(event.target))
                delete this.abnormalities[event.id];
        });
    }

    is(gameId) {
        return this.gameId && this.gameId === gameId;
    }

    setTemplate(templateId) {
        if (this.templateId !== templateId) {
            this.templateId = templateId;

            // Cache some stuff
            const UserData = this.parent.data.users.get(this.templateId);
            if (!UserData)
                throw new Error(`Invalid user template ID ${this.templateId}!`);

            this.class = UserData.class;
            this.race = UserData.race;
            this.gender = UserData.gender;

            this.emit('change_template', this.templateId, this.class, this.race, this.gender);
        }
    }

    setZone(zone, quick) {
        if (this.zone !== zone) {
            this.zone = zone;
            this.emit('change_zone', zone, quick);
        }
    }

    setAlive(alive) {
        if (this.alive !== alive) {
            let old_alive = this.alive;
            this.alive = alive;

            if (old_alive !== null)
                this.emit(alive ? 'resurrect' : 'die');
        }
    }

    setMount(id, skill) {
        if (this.mountId !== id || this.mountSkill !== skill) {
            this.mountId = id;
            this.mountSkill = skill;

            if (this.mounted)
                this.emit('mount', id, skill);
            else
                this.emit('dismount');
        }
    }

    get mounted() { return !!this.mountId; }

    setName(name) {
        if (this.name !== name) {
            let old_name = this.name;
            this.name = name;

            if (old_name !== null)
                this.emit('change_name', name);
        }
    }

    setLevel(level) {
        if (this.level !== level) {
            let old_level = this.level;
            this.level = level;

            if (old_level !== null)
                this.emit('change_level', level);
        }
    }

    setStatus(status) {
        if (this.status !== status) {
            let old_status = this.status;
            this.status = status;

            switch (old_status) {
                case 1: this.emit('leave_combat'); break;
                case 3: this.emit('finish_pegasus'); break;
            }

            switch (status) {
                case 1: this.emit('enter_combat'); break;
                case 3: this.emit('start_pegasus'); break;
            }
        }
    }

    get inCombat() { return this.status === 1; }
    get onPegasus() { return this.status === 3; }
    get inOpenWorld() { const continent = this.parent.data.continents.get(this.zone); return continent && ['none', 'field', 'channelingZone'].includes(continent.channelType); }
    get inBattleground() { const continent = this.parent.data.continents.get(this.zone); return continent && continent.channelType === 'battleField'; }
    get inDungeon() { const continent = this.parent.data.continents.get(this.zone); return continent && continent.channelType === 'dungeon'; }
    get inCivilUnrest() { const continent = this.parent.data.continents.get(this.zone); return continent && continent.channelType === 'citywar'; }
    get serverId() { return this.parent.serverId; }

    reset() {
        this.gameId = null;
        this.templateId = null;
        this.playerId = null;
        this.name = null;
        this.level = null;
        this.class = null;
        this.race = null;
        this.gender = null;
        this.zone = null;
        this.alive = null;
        this.mountId = null;
        this.mountSkill = null;
        this.status = null;
        if (this.abnormalities)
            this.abnormalities = {};
    }
}

module.exports = Me;
