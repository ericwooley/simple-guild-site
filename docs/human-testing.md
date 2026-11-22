# Initial human testing

## Ready build

Open [the local website](http://localhost:4321/login).
The registered website and PostgreSQL services run on this workspace machine.
The initial build supports these workflows:

- Member and owner test accounts with separate permissions.
- Guild hall, roster, character details, main selection, and profession titles.
- Bank search, source filters, favorites, item requests, and owner request handling.
- Profession search, offered crafts, and several titles per character.
- Sync token creation, one-time display, expiry, revocation, and upload history.
- Installable Forever addon with Connection, Characters, and Guild tabs.
- Ultimate Bank visible stock capture and a local Python upload bridge.

The local test records represent fixtures, not verified live guild data.
Each test account shows a test indicator throughout the website.
The actual Forever client remains the next verification boundary.
If the sign-in page lacks test choices, enable `ENABLE_LOCAL_TEST_LOGIN=true` in `.env` and restart the local website service.

## Website test

1. Open the local sign-in page.
2. Select Test as guild member.
3. Search the roster and inspect your character under My account.
4. Open Guild bank and favorite Minor Healing Potion.
5. Filter favorites and request two potions for your character.
6. Open Professions and offer Minor Healing Potion to the guild.
7. Search with Offered crafts only enabled.
8. Open My account and generate a member sync token.
9. Copy the token and confirm that refresh does not reveal it again.
10. Revoke that token.
11. Sign out and select Test as guild owner.
12. Approve the item request, then mark it fulfilled.
13. Confirm that request handling does not change confirmed stock.
14. Assign Guild Alchemist to two characters.
15. Assign another profession title to one character.
16. Generate a guild sync token.
17. Repeat the important forms at a narrow window width and with a keyboard.
18. Sign out and confirm that private records disappear.

Read [the website checklist](website-testing.md) for additional cases.

## Configure a game test

Use [the server fixture instructions](server-setup.md#tests-with-game-character-names)
to set the exact names, region, realm value, and designated bank characters.
The addon uses the character name and realm values that the game client supplies.
Use full names, including surnames.
Local fixture configuration does not verify Battle.net ownership.

1. Create a local JSON fixture configuration using the server guide.
2. Execute `pnpm db:seed --config /absolute/path/local-test-config.json`.
3. Sign into the matching local owner or member test account.
4. Generate a new token with the required sync permission.
5. Download the addon from Addon Sync.
6. Extract the addon into the Forever client's `Interface/AddOns` folder.
7. Open the game and enable Helping Hand.
8. Enter `/hh` and paste the token into Connection.
9. Open your guild roster, Skills window, and an owned profession window.
10. Select Capture my data, or select Capture guild data as the guild owner.
11. Enter `/reload` to save the capture.
12. Open the Helping Hand desktop app (`pnpm desktop:build` / `./desktop/build/bin/HelpingHand`), choose your `WTF/Account/ACCOUNT/SavedVariables/HelpingHand.lua` file on the Account page, and click **Sync now** (or **Start auto-sync**).

Protect the SavedVariables file and its backup because they contain the token.

If the game runs on another computer, forward the workspace's local website port to that computer's localhost port.
For example, use an SSH local port forward when SSH access already exists.
Keep browser access at `http://localhost:4321`, which matches the configured form origin.
Use HTTPS for any external website address.
The bridge rejects external plain HTTP addresses.

## Verify the game capture

1. Compare your character name, professions, and learned recipes with the website.
2. Compare each designated bank character's public stock with Ultimate Bank.
3. Confirm that private items never enter the website bank tab.
4. Hide a previously public item and upload a complete visible inventory view.
5. Confirm that the website removes that item.
6. Confirm that view-only banks reject item requests.
7. Upload the same capture twice and confirm that stock does not duplicate.
8. Capture with Ultimate Bank unavailable and confirm that earlier stock remains.
9. Revoke the token and confirm that the bridge rejects another upload.

Complete bank coverage describes the published visible inventory view.
It does not establish a recent physical bank or mailbox scan.
The website shows unknown source scan age when Ultimate Bank provides no reliable timestamp.
The collector captures the current character's professions, not unavailable recipes from other members.
Read [the addon checklist](addon-testing.md) for client-specific cases and transport details.

## Battle.net boundary

Application credentials are not configured in this workspace.
The OAuth flow exists and passed simulated-provider tests.
It establishes Battle.net identity only.
It grants no live character ownership, guild membership, or guild-owner role.
The server keeps live guild access disabled until authenticated Forever API tests establish those checks.
Read [Battle.net setup](server-setup.md#battle-net-login) before testing that flow.

## Reset and report

`pnpm db:seed` replaces only the local fixture guild's records.
It restores the default example names unless you provide the custom configuration again.
It does not replace real account records or other guilds.
Use it only when you want to reset local test progress.

For a defect, record the page or addon tab, action, expected result, and actual result.
Include a screenshot or game Lua error when useful.
Remove tokens, account credentials, and SavedVariables contents before sharing a report.
