# Companion addon testing

## Initial build

The installable addon targets Forever Interface 16001.
It uses native game controls and no external runtime libraries.
The window follows the BetterBags Simple Dark patterns in the addon UI guide.
The addon does not open an HTTP connection.
The Wails desktop app (`desktop/`) sends the captured outbox to the website.
No Forever client is available here. Game behavior still needs human testing.

## Install and connect

1. Execute `pnpm addon:package` from the repository.
2. Download `http://localhost:4321/downloads/HelpingHand.zip` while the website runs.
3. Extract the `HelpingHand` folder into the Forever client's `Interface/AddOns` folder.
4. Enable Helping Hand in the game's addon list.
5. Enter `/hh` and select Characters.
6. Read the Character and Realm fields before configuring local test identities.
7. Sign into the website and open Addon Sync.
8. Generate the correct member or guild sync token.
9. Enter `/hh` in the game.
10. Paste the token into Connection and select Save token.
11. Open the guild roster and your Skills window.
12. Open your own profession window to capture its learned recipes.
13. Select Characters and select Capture my data.
14. If you own the guild and have guild consent, select Guild and select Capture guild data.
15. Enter `/reload` to save the capture and token.
16. Open the Helping Hand desktop app, select your account's `WTF/Account/ACCOUNT/SavedVariables/HelpingHand.lua` file on the Account page, and click **Sync now** (or enable **Start auto-sync**).

Use the account SavedVariables file. Do not use the addon source file from Interface/AddOns.
Use the website's test fixture configuration for your real character and guild names during local testing.
The website rejects names that do not match verified or explicitly configured test identities.
Local test accounts do not prove Battle.net ownership or guild-owner status.

## Token handling

The saved token grants sync access. Protect the SavedVariables file and its `.bak` copy.
The addon masks the token field but the game stores the token as plain text.
Never share these saved files or include them in bug reports.
Use Clear token and `/reload` to remove the active saved value.
Revoke the token on the website to stop further uploads immediately.
Review game backups separately if you need to remove old local copies.

Saving a token shows Configured. It does not prove a website connection.
The bridge does not write website receipts into the game.
The addon therefore leaves the website receipt unknown.

## Desktop bridge checks

The Wails desktop app (`desktop/`) parses a bounded Lua data subset in Go (`desktop/lua_parser.go`). It never executes Lua.
It selects only `HelpingHandDB.outbox` (and optional `TOGBankClassic.lua` bank history), sends the token in an HTTP `Authorization` header, and rejects private field names, redirects, unsupported syntax, duplicate keys, and invalid list shapes.

Each capture needs a new `/reload` before the desktop app can read it.
A repeated upload keeps the same snapshot identifier. The server handles duplicate submissions.
The desktop app reports malformed or incomplete files without changing them.
If a read fails during `/reload`, sync again after the game finishes writing.

## Data checks in Forever

1. Confirm that Characters shows your full first name and surname.
2. Confirm that the website links the capture to the correct verified character.
3. Confirm that a member capture contains no guild roster or bank fields.
4. Confirm that Guild permits capture only for the game guild owner.
5. Confirm that the website also requires current guild-owner permission.
6. Capture an open profession and check its learned recipes on the website.
7. Capture a linked profession window and confirm that it cannot replace your learned recipes.
8. Capture guild data with Ultimate Bank absent and confirm that old stock remains.
9. Capture several current-guild designated banks and compare each public stock count.
10. Confirm that a private Ultimate Bank item never appears on the website.
11. Hide a previously public item and capture a complete published bank view again.
12. Confirm that the website removes that item after the complete replacement.
13. Confirm that view-only stock cannot receive requests.
14. Confirm that signed suffix and enchant variants remain separate.
15. Revoke the website token and confirm that the bridge cannot upload.
16. Test tabs, drag, Escape, token masking, and readable text at your usual UI scale.

A complete bank record means the full published visible Ultimate Bank view.
It requires a stored record and Ultimate Bank's current coverage schema.
It does not establish current physical bank, bag, or mailbox scan times.
The addon leaves observed scan time unknown because the visible accessor provides no reliable scan timestamp.
Failed reads and unknown coverage remain incomplete. The website must preserve previous confirmed stock in these cases.
Sister-guild banks stay excluded because the collector selects current guild roster members only.
The collector never reads private inventory accessors or raw hidden inventory.
The collector captures only the current character's professions. It does not invent other members' unavailable recipes.

## Automated checks

```sh
pnpm test:desktop
pnpm addon:package
```

The archive contains only the six listed addon source and notice files.
It excludes tokens, SavedVariables, test data, website code, and upstream dependencies.
