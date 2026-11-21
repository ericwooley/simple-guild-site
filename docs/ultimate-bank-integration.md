# Ultimate Bank integration

## Decision and scope

The guild uses Ultimate Bank for its bank characters.
Use its visible inventory as the source for the website bank tab.
Keep website requests and favorites in PostgreSQL, as the product requirements specify.
The user selected requirements and source research for this task.
This document defines a future integration. It adds no working import or copied source.

## Source evidence

Checked on 2026-11-21.

| Field | Evidence |
| --- | --- |
| Project | [Ultimate Bank on CurseForge](https://www.curseforge.com/wow/addons/togbankclassic) |
| Owner | EY3G0R3 |
| Adoption | 26,525 observed project downloads. This total includes all supported clients. |
| Release | [UltimateBank-v1.11.4](https://github.com/EY3G0R3/TOGBankClassic/releases/tag/UltimateBank-v1.11.4), published 2026-11-18 |
| Revision | `5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5` |
| License | [MIT](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/LICENSE), copyright 2025 GrumpyPlayer, Huntmehuntme, Pimptasty |
| Forever support | CurseForge lists 1.60.1. The [Forever manifest](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/TOGBankClassic_Camelot.toc) declares Interface 16001. |

The project meets the requested license and download threshold.
MIT permits reuse, modification, and redistribution with its copyright and permission notices.
Published compatibility does not establish successful operation in our game client.

## Inventory readers

[Guild.lua](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/Modules/Guild.lua)
defines `GetAltItems`, `IsBank`, and `IsViewOnlyBank`.
`GetAltItems(altName)` returns the visible inventory view from the inventory store.
`GetAltItemsWithOwnHidden` also includes the owner's private items. Exclude that accessor from exports.

[Store.lua](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/Modules/Inventory/Store.lua)
stores inventory in `TOGBankClassicInvDB.faction[guildName].alts[altName]`.
Named `sources` contain bank, bags, and mail records. Some received snapshots use one combined `all` source.
Older records can contain a flat `records` array.
Private records occupy a separate `hidden` structure.
The store repairs overlapping combined and named sources. A separate importer must also prevent duplicate counts.

[Database.lua](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/Modules/Database.lua)
removes legacy inventory rows and supplies `alt.items` through a metatable reader.
Reading serialized `alt.items` alone will miss current inventory.
Prefer a companion addon that reads the live visible accessors and exports selected fields.
Treat these internal accessors as version-specific contracts.

## Item identity and source age

[Record.lua](https://github.com/EY3G0R3/TOGBankClassic/blob/5ad372b98c1f97fd7f8d7a7b13a07a6c5cb816c5/Modules/Inventory/Record.lua)
defines tuples as `{id, count, suffix, enchant}` with optional trailing fields.
Its identity key includes item ID, signed suffix, and enchant.
Keep those fields when combining stock. Different variants must remain separate.
Implement strict server validation rather than trusting addon constructors or uploads.

The inventory store's schema version 2 indicates support for mail coverage.
`IsAltComplete` checks the schema version. It does not prove that every container has a recent scan.
Preserve available source timestamps and inventory revision evidence.
Record upload time separately and show unknown age when source evidence is missing.
The store's `updated` field records writes, including received snapshots. It does not prove a new source scan.
`inventoryUpdatedAt` and `version` describe publication of changed content. Do not present them as container scan times.
The current source does not transmit its local per-source `lastScan` values.

## Proposed integration boundary

1. Select designated bank characters within the website's authorized guild scope.
2. Read visible stock and view-only restrictions from a supported Ultimate Bank version.
3. Export only approved inventory fields, identities, coverage, and available source timestamps.
4. Transfer the export through a supported transfer method.
5. Validate ownership, guild scope, upload permission, quantities, and item identity on the server.
6. Replace only confirmed source snapshots and preserve incomplete or stale records with their status.
7. Show combined stock and individual bank characters in the website bank tab.

Never upload the complete SavedVariables file. It can include private inventory and unrelated addon data.
Never execute uploaded Lua as an import method.
Do not interpret an absent bank record as a confirmed empty bank.
Keep request approval separate from stock changes until a valid inventory snapshot confirms the change.

## Reuse and remaining checks

`Record.lua` offers a small candidate for later reuse with its MIT notice.
The live inventory readers offer a smaller integration boundary than copying the complete addon.
The manifest declares Ace3, GuildRoster, ItemDB, DeltaSync, and other libraries.
This task installs none of them. Research each library before adding it to our project.

Test private items, view-only banks, several bank characters, mail coverage, old snapshots, and repeated exports in Forever.
Test variant identity and incomplete scans before allowing stock replacement.
Verify guild identity separately because upstream supports sister-guild banks.
Preserve origin guild scope for sister-guild records. A guild's four-digit bank number does not provide global identity.
Choose the transport and request-queue integration in a later implementation task.
No game client is available here. This research establishes source behavior and a proposed boundary, not an operational sync.
