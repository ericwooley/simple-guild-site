# Band of the Helping Hand

## Requirements

- Node.js 22.23.4 or newer
- pnpm 11.20.0
- Docker with Compose
- Python 3

## Local setup

1. Execute `pnpm install`.
2. Execute `pnpm setup:local` to create private local settings.
3. Start PostgreSQL with `docker compose up -d postgres` (or `pnpm db:dev`).
4. Execute `pnpm db:migrate`.
5. Execute `pnpm db:seed` to create the local test records.
6. Execute `pnpm addon:package` to prepare the downloads.
7. Start the site with `pnpm dev`.
8. Open `http://localhost:4321/login`.

The database volume retains local data after the container stops.

## Scope

Read `docs/requirements.md` for the agreed website and addon requirements.

The initial test build includes the guild hall, roster, bank, professions, and account pages.
PostgreSQL stores sessions, sync grants, guild records, requests, favorites, titles, and craft preferences.
The installable Forever addon captures supported game records. The Python bridge sends authorized uploads.
Read [the human test guide](docs/human-testing.md) before testing website and addon workflows.
Read [the server setup boundaries](docs/server-setup.md) before configuring Battle.net.
Battle.net login currently establishes account identity only. Live character and guild verification remain disabled.
Explicit local fixture accounts support initial human tests. Production rejects those accounts and their tokens.

Execute `pnpm build` to package downloads and create the Node server in `dist/`.
The website footer and `X-Web-Release` response header show the build's Git commit ID.
The image workflow embeds this ID at build time. Local builds show `dev` unless you set `PUBLIC_WEB_RELEASE`.
The desktop app shows its separate release version in Desktop Settings.
Execute `TEST_BASE_URL=http://localhost:4321 pnpm test` to check logic, authentication, provenance, and live website routes.
Execute `pnpm test:db` to check database workflows in a temporary schema.
Execute `pnpm test:e2e` to check browser workflows against the running local test website.
Install its test browser with `pnpm exec playwright install chromium` when necessary.
Execute `pnpm test:addon` to check the imported addon readers with the system Lua 5.4 library.
Execute `pnpm test:addon:app` to check the companion addon with simulated game APIs.
Execute `pnpm test:bridge` to check the bridge parser and package integrity.
Execute `pnpm db:shell` to inspect the local database.

The browser checks use the default local fixture names and change fixture records.
Do not execute them against a website with human test data that you want to retain.
The database checks create and remove only their isolated test schema.

## Licenses

The Arcane theme uses the MIT license in `licenses/fantasy-rts-ui.txt`.
The site uses original SVG artwork and system fonts.
See `docs/dependencies.md` for dependency evidence.
See `docs/addon-reuse.md` for the selected addon sources and their integration limits.
