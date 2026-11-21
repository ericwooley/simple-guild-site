# Requirements and addon reuse

## Mode and baseline

- Mode: LQM. Use checks without review agents.
- Starting commit: `aa67a1c12b8bf35fb8735653349e2957802e2840`.
- Content-sensitive baseline: `/tmp/helping-hand-requirements-start.json`.
- Starting index and worktree: clean.
- Read the project instructions, setup documentation, and dependency evidence before planning.
- No existing architecture decision records apply to the new addon work.

## Checkpoints

1. Record the agreed product requirements in `docs/requirements.md`.
   Reference that document from `AGENTS.md` and the README.
   Distinguish confirmed requirements from implementation decisions that still need evidence.
   Inspect the documentation changes and create a scoped commit.
2. Find relevant open-source addons with Forever support and at least 2,000 project downloads.
   Verify published support, source ownership, releases, license terms, and relevant code paths.
   Copy useful source modules with their licenses and exact revision evidence.
   Record each copied file and its purpose. Preserve permissive licensing.
   Check source integrity and relevant behavior where the available environment permits it.
   Document verification limits, inspect the complete changes, and create a scoped commit.

## Boundaries

- This task records requirements and imports addon source foundations.
- Do not implement Battle.net authentication, website data workflows, or a complete addon in this task.
- Do not copy code from projects with fewer than 2,000 downloads or missing reuse permission.
- Treat project download totals separately from downloads of one release or one supported game version.
- Keep third-party source separate from first-party code. Preserve copyright and license notices.
- Do not execute downloaded release scripts or install addons into a game client.
- Do not publish, push, or open a pull request.

## Progress

- Checkpoint 1 complete. Recorded accounts, characters, roster, bank requests, favorites, profession titles, recipes, and sync requirements.
- Preserved the Discord exclusion and subtitle ban. Recorded open decisions and acceptance criteria.
- Verified that both `AGENTS.md` and `README.md` reference the requirements file.
- Inspected the documentation changes. `git diff --check` passed.
- Candidate research found MIT addons above the project-download threshold for bank capture and guild data.
- Checkpoint 2 is in progress.
