# talents
Submodule tracking data related to talents, for example learned perks. Accessible through `mod.game.talents`.

**You need to specifically request this submodule during your module's initialization by calling `mod.game.initialize`!**

# Functions
## getPerkLevel
- Returns the learned level of the perk with the given ID, or 0 if not learned.
- Exemplary usage: `mod.game.talents.getPerkLevel(12345)`

## hasPerk
- Returns whether or not the perk with the given ID is learned.
- Exemplary usage: `mod.game.talents.hasPerk(12345)`

# Attributes
Each of the following attributes can be accessed through, for example, `mod.game.talents.perks`.
- `perks`: ID -> level object containing all known perks

# Events
## change_perks
- Emitted when the list of known perks changes
- Exemplary usage: `mod.game.talents.on('change_perks', (how) => { ... })`
- Parameters: `how` is either `"init"` (`S_LOAD_EP_INFO` on login), `"learn"` (`S_LEARN_EP_PERK`, i.e. perks were learned), `"change_preset"` (`TTB_S_LOAD_EP_PAGE`, i.e. perk preset was changed), or `"reset"` (`S_RESET_EP_PERK`, i.e. perks have been reset).
