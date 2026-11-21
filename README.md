# Band of the Helping Hand

## Requirements

- Node.js 22.23.4 or newer
- pnpm 11.20.0
- Docker with Compose
- proc-man

## Local setup

1. Execute `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Set `POSTGRES_PASSWORD` in `.env`.
4. Set the matching password in `DATABASE_URL`.
5. Execute `proc-man daemon install --now`.
6. List services with `proc-man process list --directory "$PWD"`.
7. Register the database service:

   ```sh
   proc-man process register --label helping-hand-db --kind service --cwd "$PWD" --tag project:helping-hand --tag component:postgres --tag purpose:development --port tcp=tcp://127.0.0.1:5438 -- docker compose up --abort-on-container-exit postgres
   ```

8. Start the database with `proc-man process start PROCESS_ID`.
9. Register the site service:

   ```sh
   proc-man process register --label helping-hand-web --kind service --cwd "$PWD" --tag project:helping-hand --tag component:astro --tag purpose:development --port http=http://127.0.0.1:4321/ -- "$(command -v node)" node_modules/astro/bin/astro.mjs dev --host 0.0.0.0 --port 4321
   ```

10. Start the site with `proc-man process start PROCESS_ID`.
11. Open `http://localhost:4321`.

Use the IDs that proc-man returns. Stop services with `proc-man process stop PROCESS_ID`.
The database volume retains local data after the service stops.
The site service uses the absolute Node.js path because the daemon has a separate command search path.

## Scope

Read `docs/requirements.md` for the agreed website and addon requirements.

The first version contains the front page and in-page navigation.
PostgreSQL runs as a separate local service, ready for future server features.
The static front page does not connect to PostgreSQL or change guild data.
Battle.net accounts, roster sync, bank requests, and profession sync require future work.

Execute `pnpm build` to create the static site in `dist/`.
Execute `pnpm test` after the build to check the generated page and asset links.
Execute `pnpm db:shell` to inspect the local database.

## Licenses

The Arcane theme uses the MIT license in `licenses/fantasy-rts-ui.txt`.
The site uses original SVG artwork and system fonts.
See `docs/dependencies.md` for dependency evidence.
