# me
Submodule representing the player's currently played character while ingame. Accessible through `mod.game.me`.

**This submodule is loaded by default!**

# Functions
## is
- Utility function to safely check if a gameId is the current player's gameId. Returns false if the player is not ingame, or if the gameIds mismatch.
- Exemplary usage: `mod.game.me.is(event.gameId)`

# Attributes
Each of the following attributes can be accessed through, for example, `mod.game.me.gameId`.
- `gameId`: The player's gameId, which is constant until logging out or returning to character selection
- `templateId`: The character's templateId (see UserData in datacenter)
- `serverId`: The id of the server being played on.
- `playerId`: The unique id of the character on the current server. This remains constant unless transferring servers. The tuple `(serverId, playerId)` is guaranteed to be unique for the entire game region (e.g. all EU servers)
- `name`: The character's name.
- `level`: The character's level.
- `class`: The character's class (as a string). Consistent with names in datacenter (e.g. `fighter` instead of `brawler`). Derived from `templateId` automatically.
- `race`: The character's race (as a string). Consistent with names in datacenter. Derived from `templateId` automatically.
- `gender`: The character's gender (as a string). Consistent with names in datacenter. Derived from `templateId` automatically.
- `zone`: The current zone id.
- `alive`: Indicates whether the player is alive.
- `mounted`: Indicates whether the player is on a vehicle.
- `mountId` / `mountSkill`: Current vehicle data. See `mount` event.
- `status`: The player's current status. See `S_USER_STATUS` def for values.
- `inCombat`: Indicates whether the player is in combat.
- `onPegasus`: Indicates whether the player is on a pegasus ride.
- `inOpenWorld`: Indicates whether the player is currently in the open world.
- `inBattleground`: Indicates whether the player is currently in a battleground.
- `inDungeon`: Indicates whether the player is currently in a dungeon.
- `inCivilUnrest`: Indicates whether the player is currently in CU.

# Events
## change_template
- Emitted if the current player template changes (emitted once on `S_LOGIN` for all game modes, and whenever the TBA hero is switched)
- Exemplary usage: `mod.game.me.on('change_template', (templateId, class, race, gender) => { ... })`
- Parameters: `templateId` is the new templateId used. `class`, `race`, and `gender` indicates the new template's class, race, and gender.

## change_zone
- Emitted if the current zone changes on `S_LOAD_TOPO`
- Exemplary usage: `mod.game.me.on('change_zone', (zone, quick) => { ... })`
- Parameters: `zone` is the new zone to load, `quick` indicates if a loading screen is shown (false) or not (true)
- **Note:** Does *not* trigger when changing channels or teleporting within the same zone!

## die
- Emitted on the player's death
- Exemplary usage: `mod.game.me.on('die', () => { ... })`
- Parameters: none

## resurrect
- Emitted on the player's resurrection of any kind
- Exemplary usage: `mod.game.me.on('resurrect', () => { ... })`
- Parameters: none

## mount
- Emitted when the player mounts a vehicle (only regular vehicles, neither pegasus nor NPC vehicles)
- Exemplary usage: `mod.game.me.on('mount', (id, skill) => { ... })`
- Parameters: `id` is the vehicle id, skill is the id of the skill used to mount up

## dismount
- Emitted when the player dismounts a vehicle (only regular vehicles, neither pegasus nor NPC vehicles)
- Exemplary usage: `mod.game.me.on('dismount', () => { ... })`
- Parameters: none

## change_name
- Emitted when the player's name is changed while ingame
- Exemplary usage: `mod.game.me.on('change_name', (name) => { ... })`
- Parameters: `name` is the new name

## change_level
- Emitted when the player's level is changed while ingame
- Exemplary usage: `mod.game.me.on('change_level', (level) => { ... })`
- Parameters: `level` is the new level

## enter_combat
- Emitted when the player enters combat
- Exemplary usage: `mod.game.me.on('enter_combat', () => { ... })`
- Parameters: none

## leave_combat
- Emitted when the player leaves combat
- Exemplary usage: `mod.game.me.on('leave_combat', () => { ... })`
- Parameters: none

## start_pegasus
- Emitted when the player starts a pegasus ride
- Exemplary usage: `mod.game.me.on('start_pegasus', () => { ... })`
- Parameters: none

## finish_pegasus
- Emitted when the player finishes a pegasus ride
- Exemplary usage: `mod.game.me.on('finish_pegasus', () => { ... })`
- Parameters: none

# Feature `"abnormalities"`
Tracks currently active abnormalities on the player. Must be activated through `mod.game.initialize("me.abnormalities")`.

Adds the `abnormalities` attribute which is an object with abnormality IDs as keys and objects with the following properties as values:
- `id`: The abnormality's ID.
- `stacks`: Number of stacks.
- `until`: Timestamp of expiry (milliseconds; computed through `Date.now() + duration`).
- `remaining`: Milliseconds remaining until expiry.
- `data`: Link to the [corresponding game data queried from the DataCenter file](data.md#abnormalities)

Exemplary usage:
```js
// Logs info about all currently active abnormalities
Object.values(mod.game.me.abnormalities).forEach(abnormality => {
    mod.log(`${abnormality.data.name} (ID: ${abnormality.id})`)
    abnormality.data.effects.forEach(effect => {
        mod.log(`  - Type ${effect.type}, Method ${effect.method}, Value ${effect.value}`);
    });
});
```
