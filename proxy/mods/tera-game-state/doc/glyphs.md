# glyphs
Submodule tracking data related to glyphs, for example learned/enabled ones. Accessible through `mod.game.glyphs`.

**You need to specifically request this submodule during your module's initialization by calling `mod.game.initialize`!**

# Functions
## isKnown
- Returns whether or not the glyph with the given ID is known.
- Exemplary usage: `mod.game.glyphs.isKnown(12345)`

## isEnabled
- Returns whether or not the glyph with the given ID is known and enabled.
- Exemplary usage: `mod.game.glyphs.isEnabled(12345)`

# Attributes
Each of the following attributes can be accessed through, for example, `mod.game.glyphs.known`.
- `known`: ID -> Enabled object containing all known glyphs
- `enabled`: array containing the IDs of all currently enabled glyphs

# Events
## change
- Emitted when the list of known/enabled glyphs changes
- Exemplary usage: `mod.game.glyphs.on('change', () => { ... })`
- Parameters: None.
