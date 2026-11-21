# Guild website requirements

## Product scope

- Build a website for the Band of the Helping Hand guild in World of Warcraft: Forever.
- Keep the website independent of Discord. Require no Discord account, bot, server, or integration.
- Use Astro, PostgreSQL, and the Fantasy RTS UI Themes Arcane theme.
- Build a companion addon to collect supported game data.
- Use the BetterBags patterns in [the addon UI guide](addon-ui-patterns.md) when building the companion addon's interface.
- Treat mobile access, accessibility, privacy, and security as standard requirements for every feature.
- Agents are barred from creating subtitles. Do not add taglines, eyebrow text, or secondary title text.
- The initial static front page is a foundation. It does not implement the features below yet.

## Accounts and characters

- Let members sign in through Battle.net.
- Verify character ownership before linking a character to an account.
- Let one account contain multiple verified characters.
- Let members select a main character and identify their alts.
- Show each character's guild membership, guild rank, and guild profession titles.
- Use verified guild membership and permissions to control access to member features.
- Distinguish Battle.net identity, character ownership, and guild membership. One does not prove the others.
- Recheck membership and permissions when current data becomes available.
- Do not grant officer access from an unverified addon upload or a matching character name alone.

## Guild roster

- Sync member and character data from the companion addon.
- Sync guild membership and guild ranks where the game client permits access.
- Connect verified website characters to their roster records.
- Show when roster data last synced.
- Distinguish missing or stale data from confirmed membership changes.
- Preserve character identity across supported updates. Define the stable identity fields after testing Forever APIs.

## Guild bank

- Use Ultimate Bank (`TOGBankClassic`) as the inventory source for designated bank characters.
- Sync its visible bank, bag, and mailbox stock through the companion addon into the website bank tab.
- Support multiple bank characters and retain each character's stock separately.
- Show combined stock without counting the same source snapshot twice.
- Keep bank-character stock distinct from any future shared guild-bank tabs.
- Exclude items that Ultimate Bank marks as private or hidden.
- Preserve item IDs, signed random suffixes, enchant IDs, quantities, and source bank identities.
- Respect view-only bank restrictions when accepting requests.
- Limit imported bank characters to the website's authorized guild scope.
- Show when bank data last synced and identify incomplete snapshots.
- Distinguish source capture time from website upload time. An upload does not prove a new scan.
- Support item search and filters.
- Let each member keep personal item favorites.
- Let members request an item and quantity for one of their verified guild characters.
- Let members view and track their requests.
- Let authorized members approve, decline, and mark requests as fulfilled.
- Keep request status separate from confirmed bank stock.
- Do not treat approval as an in-game withdrawal.
- Reconcile stock from complete addon snapshots. Do not erase stock after an incomplete scan.
- Handle repeated uploads without duplicating stock or requests.
- The website manages requests. It does not automate in-game trades, mail, or withdrawals.

## Guild professions and offered crafts

- Sync character professions and skill levels where the game client permits access.
- Sync known recipes, crafted items, and enchants where the game client permits access.
- Show when profession and recipe data last synced.
- Let authorized members assign titles such as Guild Alchemist, Guild Enchanter, and Guild Blacksmith.
- Support multiple characters with the same guild profession title.
- Support multiple guild profession titles on one character.
- Keep guild profession titles separate from in-game guild ranks.
- Let members choose which known crafts they offer to the guild.
- Distinguish a known recipe from a craft that the member offers.
- Search for an item or enchant and show the characters who offer it.
- Keep manual offer preferences when recipe data refreshes.
- Mark unavailable data as unknown. Do not infer that a member forgot a recipe from a failed scan.

## Personal guild dashboard

- Show the signed-in member's characters, guild ranks, and guild profession titles.
- Show their offered crafts, bank requests, and personal favorites.
- Show sync status and character links that still need verification.
- Explain access restrictions with clear, actionable messages.

## Addon and website synchronization

- Use the addon as the source for supported roster, bank, profession, and recipe snapshots.
- Store website requests, favorites, offered-craft preferences, and guild profession assignments in PostgreSQL.
- Include the source character, guild identity, capture time, and format version in exported snapshots.
- Record which portions of a snapshot are complete and which require another in-game scan.
- Validate imported data and enforce upload permissions on the server.
- Keep game collection separate from serialization, transport, and website business rules.
- Request consent before uploading member data outside the game.
- Show the last successful sync and report sync errors without exposing credentials.
- Determine supported capture events and export timing through actual Forever client tests.
- Do not promise real-time synchronization before validating the complete transport path.
- Choose manual export, a desktop companion, or another supported transport after research and testing.
- Keep Battle.net tokens and application secrets on the server.
- Do not put website credentials or Battle.net tokens in an addon export.

## Addon sync tokens and permissions

- Add an Addon Sync section to the signed-in member's account area.
- Let members generate a dedicated sync JWT, copy it, and paste it into the companion addon's settings.
- Show the token's permissions, expiry, revocation status, and last successful sync.
- Let members revoke a token and generate a replacement.
- Treat the JWT as a secret bearer credential. Mask saved tokens and exclude them from logs and shared exports.
- Keep the configured sync JWT separate from inventory payloads, Battle.net tokens, and website session credentials.
- Permit member tokens to sync only the member's verified characters, professions, known recipes, and supported personal character data.
- Require verified guild-owner status before issuing a token with guild sync permission.
- Permit guild-owner tokens to sync the guild roster, ranks, designated bank-character stock, and available guild profession and recipe snapshots.
- Apply the same visibility, consent, completeness, freshness, and Ultimate Bank restrictions to guild-owner uploads.
- Preserve website requests, favorites, offered-craft preferences, and guild profession titles when game snapshots refresh.
- Sync only data that the addon can access. An owner token does not supply missing member recipes or private inventory.
- Check current account, character, guild, and owner permissions on every upload.
- Reject uploads after token revocation, token expiry, or loss of the required permission.
- Require signed JWTs with an explicit sync audience, issuer, account subject, token identifier, expiry, and permitted scope.
- Validate signatures, allowed algorithms, required claims, and current server permissions before processing any uploaded records.
- Give sync tokens no website login, account administration, request approval, or in-game action permissions.
- Authenticate transfers over HTTPS. Keep the credential outside URLs and the game addon communication channel.
- Verify the data transfer method separately. Pasting a JWT configures authorization but does not establish network transport.
- Treat authenticated uploads as untrusted data. A valid token does not prove the truth of submitted game records.

The JWT validation requirements follow [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html).
Expiry, revocation, and guild permissions form this project's application requirements.

## Source reuse requirements

- Reuse code only when its license permits the intended use and redistribution.
- Prefer MIT, BSD, or similarly permissive licenses.
- Each source addon must support Forever and have at least 2,000 published project downloads when selected.
- Record the project page, observed download count, observation date, version, source revision, and copied file paths.
- Preserve license and copyright notices with copied code.
- Keep source evidence separate from claims of successful in-game testing.
- Verify transitive libraries before including them.

## Decisions that still need evidence

- Verify Battle.net authorization and account-to-character linking for the current Forever APIs.
- Verify Ultimate Bank readers, bank-character identities, source coverage, and freshness in the current Forever client.
- Define optional shared guild-bank coverage separately from Ultimate Bank's bank-character stock.
- Decide whether website requests will later sync with Ultimate Bank's request queue.
- Verify profession and learned-recipe access in the current Forever client.
- Choose the addon export format and transfer method for JWT-authorized uploads.
- Define token lifetime, renewal behavior, secure local storage, and guild-owner verification for the current Forever environment.
- Define the guild's request approval rules and officer permissions.
- Define how guild profession titles apply when a member changes mains or leaves the guild.

## Scope exclusions

- Discord features are excluded.
- Raid calendars, raid signups, attendance, loot systems, recruitment, and discussion forums are not part of the agreed feature set.
- Craft-order workflows are not part of the agreed feature set. The profession directory lists offered crafts.
- Do not implement excluded features without a new user request.

## Initial acceptance criteria

1. A member signs in through Battle.net and sees only verified characters linked to their account.
2. The member sees their guild membership, ranks, and guild profession titles.
3. An authorized upload refreshes the supported roster, bank, and profession data without duplicate records.
4. A member searches bank items, favorites an item, and requests a quantity for a verified guild character.
5. An authorized member processes the request without changing confirmed stock before the next valid bank snapshot.
6. Several characters hold the same guild profession title, and one character can hold several titles.
7. A member selects offered crafts from synced recipes, and other members find them through search.
8. Failed or incomplete syncs preserve the last confirmed data and clearly show its age.
9. All member workflows work on mobile and with a keyboard.
10. No workflow requires Discord, and no screen contains subtitles.
11. The bank tab shows Ultimate Bank's visible stock across designated bank characters without exposing private items.
12. Repeated bank uploads preserve item variants, source age, stock totals, and view-only restrictions.
13. A member generates a sync JWT in the account area and configures it in the companion addon.
14. A member token updates only verified characters within its permitted scope.
15. A verified guild owner syncs available guild roster, bank, profession, and recipe data within the guild's permissions.
16. Revoked, expired, or unauthorized tokens cannot change stored data.
