# contract
Submodule representing the currently active contract. Accessible through `mod.game.contract`.

**You need to specifically request this submodule during your module's initialization by calling `mod.game.initialize`!**

**Note: Some contracts aren't terminated properly through `S_*_CONTRACT` packets by the server, and hence will not properly update their state in this library yet. This is still to be done!**

# Functions
None

# Attributes
Each of the following attributes can be accessed through, for example, `mod.game.contract.id`.
- `active`: Indicates whether a contract is currently active.
- `id`: The unique identifier of the currently active contract.
- `type`: The type of the currently active contract.

# Events
## begin
- Emitted when a new contract is started through `S_REQUEST_CONTRACT`.
- Exemplary usage: `mod.game.contract.on('begin', (type, id) => { ... })`
- Parameters: `type` and `id` (see attributes)

## end
- Emitted when the currently active contract is terminated
- Exemplary usage: `mod.game.contract.on('end', (how) => { ... })`
- Parameters: `how` is either `"accept"` (`S_ACCEPT_CONTRACT`), `"reject"` (`S_REJECT_CONTRACT`), or `"cancel"` (`S_CANCEL_CONTRACT`).
