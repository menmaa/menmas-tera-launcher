# party
Submodule tracking current player party

**You need to specifically request this submodule during your module's initialization by calling `mod.game.initialize`!**

# Functions
## isMember
- Returns true/false
- Exemplary usage: `mod.game.party.isPartyMember(<gameId>)`

## inParty
- Returns true/false
- Exemplary usage: `mod.game.party.inParty()`

## getMemberData
- Returns { gameId..., playerId:... , serverId:..., name: ..., class: ... } if entity in party of null
- Exemplary usage: `mod.game.party.getMemberData(<gameId>)`

# Events
## list
- Emitted when S_PARTY_MEMBER_LIST received AND/OR modified OR party list WAS FIXED
- Exemplary usage: `mod.game.party.on(list', (list) => { ... })`
- Parameters: `list` is array of objects with content { gameId..., playerId:... , serverId:..., name: ..., class: ... }

## member_leave
- Emitted when S_LEAVE_PARTY_MEMBER received
- Exemplary usage: `mod.game.party.on('member_leave', (obj) => { ... })`
- Parameters: `obj` is object { playerId:... , serverId:..., name: ..., class: ... }

## member_kick
- Emitted when S_BAN_PARTY_MEMBER received
- Exemplary usage: `mod.game.party.on('member_kick', (obj) => { ... })`
- Parameters: `obj` is object { playerId:... , serverId:..., name: ..., class: ... }

## leave
- Emitted when S_LEAVE_PARTY received
- Exemplary usage: `mod.game.party.on('leave', () => { ... })`
- Parameters: not included

