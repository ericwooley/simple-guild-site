# Addon source reuse

## Selected sources

Checked on 2026-11-20. Download counts describe entire CurseForge projects.
They do not prove that 2,000 people used one release or the Forever version.
Cached pages can report different totals. The recorded totals both exceed the requested threshold.

| Addon | Observed downloads | License | Selected release | Relevant code |
| --- | ---: | --- | --- | --- |
| [Bank Tabs](https://www.curseforge.com/wow/addons/bank-tabs) | 4,291 | MIT | 2.4.0 | Bank, bag, and guild-bank snapshots |
| [Forever Guild](https://www.curseforge.com/wow/addons/forever-guild) | 3,394 | MIT | v0.9.2 | Roster, profession skills, learned recipes, and guild-bank data |

Both projects publish Forever files for client 1.60.1.
Both selected source revisions declare Interface 16001 in their addon manifests.
This provides published compatibility evidence. It does not replace a test in the current game client.

## Source identity and licenses

### Bank Tabs

- CurseForge owner: Vatik. Source owner and copyright holder: jonlipin.
- Source repository: https://github.com/jonlipin/bank-tabs
- The older `jonlipin/casement` source link redirects to this repository.
- Selected tag: `2.4.0`.
- Selected commit: `2e27935aaaa34ae61d9dec094b83bdac1f2f0a55`.
- Source license: https://github.com/jonlipin/bank-tabs/blob/2e27935aaaa34ae61d9dec094b83bdac1f2f0a55/LICENSE
- Release evidence: the source tag and the matching CurseForge 2.4.0 release from 2026-11-15.
- No GitHub release object exists for this tag. Do not treat that missing object as a missing source release.

### Forever Guild

- CurseForge and GitHub owner: Japy01. Copyright holder: Diego and contributors.
- Source repository: https://github.com/Japy01/LevelMates
- The repository retains its earlier LevelMates name.
- Selected tag: `v0.9.2`.
- Selected commit: `5eb0ca61ea09224f3b210c9fb12de8291f2ea78c`.
- Source license: https://github.com/Japy01/LevelMates/blob/5eb0ca61ea09224f3b210c9fb12de8291f2ea78c/LICENSE
- Release: https://github.com/Japy01/LevelMates/releases/tag/v0.9.2
- The author published this release on 2026-11-20.

The MIT licenses permit reuse, modification, and redistribution with their copyright and permission notices.
The copied licenses remain beside the source files.
The project adds no GPL, noncommercial, or all-rights-reserved source in this import.

## Copied code

The source and license files reside in `vendor/addons/`.
The machine-readable inventory in `vendor/addons/manifest.json` records revisions, original paths, line ranges, and hashes.
Each excerpt preserves the exact upstream lines. Each complete file preserves the exact upstream bytes.
The import process verified each full source file against the selected commit's Git blob before copying it.

| Local source | Original source | Selection | Intended reuse |
| --- | --- | --- | --- |
| `bank-tabs/Vault.lua` | `Vault.lua` | Complete file | Container API fallbacks, slot records, paced bank-tab reads, and preservation of hidden tabs |
| `forever-guild/Roster.readers.lua` | `LevelMates/Roster.lua` | Lines 1–108 | Community roster reads, legacy roster fallback, rank fields, and rejection of unknown guild members |
| `forever-guild/Professions.readers.lua` | `LevelMates/Professions.lua` | Lines 1–66 | Profession IDs and the character's profession skill records |
| `forever-guild/Skills.read.lua` | `LevelMates/Journal.lua` | Lines 180–206 | Skill reads that preserve unknown professions under collapsed headers |
| `forever-guild/Recipes.scan.lua` | `LevelMates/Recipes.lua` | Lines 1–134 | Own-character recipe scans, item and enchant outputs, and compact recipe lists |
| `forever-guild/GuildBank.lua` | `LevelMates/GuildBank.lua` | Complete file | Shared bank records, tab queries, item quantities, and missing-tab preservation |

## Integration boundaries

These files provide source material for the planned addon. They do not form an installable addon.
There is no addon `.toc` entry point, game installation step, or website import of these files.
The source excerpts require adaptation before use. They retain their original namespace contracts.

- Bank Tabs expects a namespace with `report`, `vault`, `Who`, and `After` support.
  The complete file includes layout helpers that our collector does not need.
- The roster reader expects name helpers, plain-value handling, and game roster APIs.
  Its in-game officer checks do not authorize website requests.
- The profession reader expects `ns.char.skills`. Its grouping function also expects the original module's `P.List`.
  Reuse the data reader without importing that UI grouping path.
- The skill reader defines a local `readProfessions` function. An adapter must expose it and supply the prior snapshot.
- The recipe scanner expects `ns.Professions.IDS`, `ns.char`, `ns.Plain`, `ns.List`, and `ns.Fire`.
  Its original sharing protocol, recipe catalogue, and Discord UI paths are outside the copied range.
- The complete Forever Guild bank module expects its original `Comm`, `Sync`, event bus, and game frame APIs.
  Reuse the capture logic without treating that in-game protocol as the website upload protocol.
- No Discord module or Discord helper enters this import.
- No external library, artwork, packaging script, release workflow, or game asset enters this import.

## Rules for adaptation

1. Extract collection and normalization into small modules before connecting them to website storage.
2. Inject clocks, scheduling, saved state, and game API access where practical.
3. Add tests for the current Forever client before activating the addon.
4. Preserve provenance when adapting a copied function.
5. Define explicit snapshot completeness and deletion rules.
6. Validate website uploads independently of the upstream wire decoders.
7. Verify character ownership and guild permissions independently of addon-provided names and ranks.

The upstream bank readers preserve earlier data when tabs are hidden or reads appear empty.
That behavior protects against incomplete reads, but it cannot distinguish every empty bank from a failed read.
Our addon must represent confirmed empty tabs separately from incomplete snapshots.

The upstream recipe scanner excludes recipes whose `learned` field equals `false`.
It treats a missing `learned` field differently. Test that field against the current client before trusting unknown values.
Its compact decoder also accepts some separator patterns that a website parser should reject.
Do not use it as an untrusted web-input validator.

The upstream bank keys and roster helpers include realm and short-name assumptions.
Verify Forever character and guild identifiers before using those keys in PostgreSQL.
Never use a display name alone as proof of ownership.

## Maintenance and dependency checks

- Both repositories remain public and unarchived.
- Bank Tabs last received a source push on 2026-11-15 when checked.
- Forever Guild last received a source push on 2026-11-20 when checked.
- Both repositories had zero GitHub stars when checked. The CurseForge totals satisfy the user's adoption threshold.
- The selected source trees contain no `SECURITY.md` policy.
- The GitHub public repository advisory endpoints returned zero published advisories for both projects.
  This is a limited check. It does not prove that either addon contains no vulnerabilities.
- Forever Guild declares optional Questie, NeedRoll, LibProfessionDB, and ProfessionDB integrations.
  This import contains none of those libraries. Any later inclusion needs separate license and dependency research.
- Bank Tabs declares optional EllesmereUI integrations. This import contains none of those addons.
- The project adds no npm package or executable runtime dependency for these sources.

## Other candidates

| Candidate | Evidence | Decision |
| --- | --- | --- |
| [Guild Finder Forever](https://www.curseforge.com/wow/addons/guild-finder-forever) | MIT, Forever support, 3,009 project downloads on the inspected listing | Recruitment is outside the agreed scope. Copy no source. |
| [Profession Master](https://www.curseforge.com/wow/addons/profession-master) | Established profession addon, but the listing reserves all rights | Copy no source without an applicable reuse license. |
| [Forever Profession Master](https://www.curseforge.com/wow/addons/forever-profession-master) | 18,683 project downloads, all rights reserved | Copy no source. |
| [Guild Bank Alts](https://www.curseforge.com/wow/addons/guild-bank-alts) | MIT, Forever support, 17 project downloads | Below the requested threshold. Copy no source. |
| [Conclave](https://www.curseforge.com/wow/addons/conclave) | Relevant features, 41 project downloads, all rights reserved | Below the threshold and lacks reuse permission. Copy no source. |

## Verification limits

- Execute `pnpm test` to check local provenance records, licenses, and the existing static page.
- Execute `pnpm test:addon` to check Lua syntax and five selected reader behaviors.
  This command uses Python's standard library and the system Lua 5.4 shared library.
  It reports a missing Lua library as a test failure. It does not install a package.
- The behavior checks load source into a restricted environment with controlled game API inputs.
  Copied code receives no filesystem, process, network, or package-loading API.
- The skill-reader check exposes its local reader inside the test environment without changing the copied file.
- Six copied Lua files passed syntax checks. Five behavior checks passed.
- Lua 5.4 syntax checks do not establish compatibility with WoW's modified Lua runtime.
- Published release files establish declared Forever support.
- Source hashes establish the identity of the imported code.
- Local checks can verify syntax and selected behavior with controlled game API inputs.
- No WoW Forever game client is available in this environment.
- Actual capture, addon event timing, permissions, and website synchronization still require in-game tests.
