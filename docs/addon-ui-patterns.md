# Companion addon UI patterns

## Selected reference

Use BetterBags, especially its Simple Dark theme, as the companion addon's UI reference.
Its grouped inventory layout fits our bank view. Its restrained window style also fits connection and sync settings.
This is our design choice, not a claim that download totals measure visual quality.

Checked on 2026-11-20:

| Evidence | Result |
| --- | --- |
| [Author project page](https://www.curseforge.com/wow/addons/better-bags) | 5,093,598 observed project downloads across all clients. Later page reads reported slightly higher totals. |
| [Source repository](https://github.com/Cidan/BetterBags) | Cidan owns the repository. It had 104 stars and remained unarchived. |
| [Selected release](https://github.com/Cidan/BetterBags/releases/tag/v0.9.5) | v0.9.5, published 2026-11-18. |
| Revision | `a1116a1a583aaea382335be4a618217c2c9d0e65` |
| [License](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/LICENSE) | MIT, copyright 2023 Antonio Lobato. Preserve the notice with copied source. |
| [Forever manifest](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/BetterBags_Camelot.toc) | Interface 16001. CurseForge also lists a Forever release. |

The author publishes [inventory and settings screenshots](https://github.com/Cidan/BetterBags/tree/a1116a1a583aaea382335be4a618217c2c9d0e65#screenshots)
and a [Simple Dark screenshot](https://i.imgur.com/wf62OjY.png).
The image host blocked direct inspection. The source below supports the specific patterns we selected.
The screenshots show Retail interfaces. They do not establish Forever runtime behavior.

## Patterns to copy

| BetterBags pattern | Source evidence | Application in our addon |
| --- | --- | --- |
| Dark surfaces, thin borders, white titles | [Simple Dark theme](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/sonata/themes/simpledark.lua) | Use one dark window and consistent inset panels. Keep title contrast high. |
| Distinct selected tabs and restrained hover fills | Same theme's `Tab` definition | Use Connection, Characters, and Guild tabs. Keep selection visible without motion. |
| Shared styles for windows and controls | Same theme's `Windows` and `Elements` definitions | Define shared colors, spacing, title, field, button, and status styles. |
| Persistent search within the current inventory view | [Search UI](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/frames/search.lua), `CreateBox`, `GetSearchText`, and `UpdateSearch` | Search the chosen bank view. Retain its query when stock redraws. Clear the filter when the query empties. |
| Keyboard focus control | Same search UI's Escape and focus handlers | Let Escape release token-field focus. Require deliberate focus before token entry. |
| Named groups of item icons with count overlays | [Author layout description](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/README.md#section-grid) and [section source](https://github.com/Cidan/BetterBags/blob/a1116a1a583aaea382335be4a618217c2c9d0e65/frames/section.lua) | Group visible bank stock by item type. Show counts and item details without merging different variants. |

## Our screen contract

- Use a draggable window with one title, a close button, and three named tabs.
- Use 16-pixel outer spacing and a consistent 8-pixel spacing unit within panels.
- Prefer readable body text and large controls over copying BetterBags' smallest pixel dimensions.
- Keep actions visible. Do not require right-click menus or modifier keys for core sync tasks.
- Show connection and sync states with text as well as color.
- Put the masked sync-token field and Save token action on Connection.
- Show token errors beside the field. Never repeat a rejected token in an error message.
- Saving a token configures the addon. Show Connected only after the supported transfer path confirms authentication.
- Show linked characters and their available professions on Characters.
- Show the owner's permitted roster, bank, and profession sync groups on Guild.
- Explain restricted guild access without offering actions the member cannot use.
- Show source age and last website receipt separately when both exist.
- Keep token storage, inventory collection, transport, and UI state in separate modules.
- Create no subtitles, taglines, or eyebrow text.

The [connection concept](mockups/addon-connection.svg) shows the chosen window, tab, panel, field, and status patterns.
It uses original vector shapes and system text. It includes no game art, copied logo, font file, or real credential.
The concept shows an unconfigured addon. Its controls do not execute actions.
The website retains its existing Arcane theme.

## Copied source and integration limits

`vendor/addons/betterbags/` contains the exact MIT license, Simple Dark theme, and search UI file.
The [source manifest](../vendor/addons/manifest.json) records each upstream path, revision, Git blob, and content hash.
These files provide adaptation references. They do not form an installable addon.

The theme expects BetterBags' AceAddon and Sonata modules.
It references a BetterBags close-button texture that this project does not copy.
The search file also expects BetterBags' window, context, events, database, animation, and inventory modules.
Adapt the patterns through our own small components rather than installing that dependency chain.
Keep the snapshots unchanged and preserve their MIT notice when adapting code.

The repository received a source push on 2026-11-19.
The selected tree contains no `SECURITY.md`. The public repository advisory endpoint returned no published advisories.
This limited check does not establish that the source has no defects.
No dependency or upstream script enters the active runtime.
Keep Ultimate Bank as the inventory source. BetterBags supplies UI references only.

## Other candidates

| Candidate | License evidence | Decision |
| --- | --- | --- |
| [Dialogue UI](https://www.curseforge.com/wow/addons/dialogueui) | All Rights Reserved | Copy no code or artwork. |
| [EllesmereUI](https://www.curseforge.com/wow/addons/ellesmereui/license) | Custom license reserves rights | Copy no code or artwork. |
| [Plumber](https://www.curseforge.com/wow/addons/plumber) | GPLv3 | Prefer BetterBags for the project's permissive reuse requirement. |

Check source integrity and Lua syntax with the existing addon checks.
No Forever client is available here. Test input focus, UI scale, tabs, and game-specific behavior before releasing the addon.
