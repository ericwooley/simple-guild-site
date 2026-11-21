# Website and addon test build

## Mode and baseline

- Mode: LQM. Use checks without review agents.
- Starting commit: `42e7ba65e21dd523405f49f5a20b4319a480c40b`.
- Content-sensitive baseline: `/tmp/helping-hand-human-test-start.json`.
- Starting index and worktree: clean.
- Read the project rules, product requirements, dependency evidence, addon research, and UI pattern guide.
- No earlier architecture decision record defines an implementation contract.
- The user explicitly requested implementation subagents.

## Checkpoints

1. Establish shared data contracts, server dependencies, PostgreSQL storage, authentication, and authorization.
   Assign the server, website, and addon components to separate implementation agents with distinct file ownership.
   Build the website screens and addon collector against the same sync contract.
   Validate each component and create scoped commits without including another agent's unfinished work.
2. Integrate the website, installable addon, and local bridge.
   Test member and owner workflows, token revocation, sync validation, privacy, repeated uploads, and incomplete snapshots.
   Correct integration defects with regression tests.
   Verify the rendered website and the packaged addon where this environment permits it.
3. Prepare the initial human test handoff.
   Document setup, test accounts, addon installation, bridge use, Battle.net configuration, and known verification limits.
   Complete available checks, inspect the full task diff, commit intended changes, and verify repository state.

## Delivery boundary

- Implement the agreed roster, bank, request, profession, account, and sync workflows.
- Keep subtitle and Discord restrictions.
- Keep source licenses and copied-source provenance.
- Use the existing Arcane website theme and BetterBags addon patterns.
- Use a local bridge for authenticated uploads. Never execute SavedVariables as code.
- Keep local test identities explicit and unavailable in production.
- Configure real Battle.net login when application credentials exist. Fail closed when ownership or guild status lacks verification.
- Do not claim game-client verification. No Forever client is available on this machine.
- Do not deploy, push, open a pull request, or merge.

## Progress

- Recorded a clean starting baseline.
- Delegated the server, website, and addon with separate file ownership and one shared sync contract.
- Website components and fixes committed as `04ce96d`, `efadaae`, and `d6ef931`.
- Addon and bridge committed as `831c283` and `faa6c54`.
- Server implementation committed as `5538ac8`.
- Added the official Node adapter, PostgreSQL client, and established Playwright test tools after dependency research.
- The package audit reported zero published vulnerabilities across 322 resolved dependencies.
- PostgreSQL migration and local fixture setup passed.
- Development now loads the ignored environment file and listens only on loopback through proc-man.
- Browser tests passed for requests, fulfillment, member scope, token sync, revocation, and narrow navigation.
- The actual Python bridge uploaded a temporary SavedVariables fixture through HTTP into PostgreSQL.
- That integration also passed duplicate submission and revoked-token rejection checks without printing credentials.
- Eight bridge tests, addon collector checks, and eight vendored Lua syntax checks passed.
- Desktop and mobile screenshots showed no overflow on roster, bank, profession, and account pages.
- The browser reported no JavaScript errors on those pages.
- The first full-page home screenshot exceeded its time limit. Desktop and mobile viewport captures subsequently passed visual inspection.
- The production server build and addon ZIP generation passed.
- Battle.net application credentials are absent. OAuth currently verifies identity only, with simulated provider checks.
- Live Forever character ownership and guild-owner verification remain disabled until authenticated API evidence exists.
- Initial game tests can use explicitly configured local fixture identities. Those identities confer no production authority.
- Added configurable local main/alt fixture identities in `8a9c126`.
- Added standalone bridge downloads in `8b7990d` and `af14a7a`.
- Local setup now creates private settings without replacing existing values.
- Live Node checks passed 28 checks. The database check ran separately and passed in an isolated schema.
- The bridge package suite passed all nine checks, including exact downloadable source and archive contents.
- Wrote the human test guide and checked local documentation links.
- Corrected the documented pnpm argument syntax after checking the exact command.
- Added a setup regression check. It failed for blank template values before the fix and passed after the fix.
- The setup check also confirms private file permissions, retained custom settings, and stable repeated execution.
- Five browser workflows passed, including copy-token feedback, offered crafts, and multiple profession titles.
- Updated addon identity labels in `1f3e851` so humans can read names and realm values before fixture setup.
- Checkpoint 1 is complete. Root runtime/configuration changes are ready for their scoped commit.
- Checkpoint 2 is complete. Integrated browser checks are ready for their scoped commit.
- Final handoff verification and checkpoint 3 remain pending.
