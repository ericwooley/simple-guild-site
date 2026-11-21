# Sync token requirements

## Mode and baseline

- Mode: LQM. Use checks without review agents.
- Starting commit: `790ecab3b1ad25b73cd359608bfaffbd5009afaa`.
- Content-sensitive baseline: `/tmp/helping-hand-sync-token-start.json`.
- Starting index and worktree: clean.
- Read the project rules, product requirements, and Ultimate Bank integration research.
- No architecture decision record applies.

## Checkpoint

1. Record the account token section, member sync permissions, and guild-owner sync permissions.
   Define token expiry, revocation, server permission checks, and credential separation.
   Keep transport selection and implementation outside this requirements task.
   Check document consistency, inspect all changes, and create one scoped commit.

## Progress

- Recorded member and guild-owner JWT workflows, scope limits, revocation, and server validation.
- Linked Ultimate Bank uploads to the token requirements.
- Checked local document links, token requirements, and the existing subtitle rule.
- Inspected the complete documentation changes. `git diff --check` passed.
- No runtime behavior changed. Runtime tests and a build are unnecessary for this task.
- LQM remains active. No review agents ran.
- The checkpoint is complete and ready for its scoped commit.
