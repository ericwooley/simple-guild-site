# Band of the Helping Hand

A WoW Forever guild site built with Astro and Fantasy RTS UI Themes.

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
   proc-man process register --label helping-hand-web --kind service --cwd "$PWD" --tag project:helping-hand --tag component:astro --tag purpose:development --port http=http://127.0.0.1:4321/ -- pnpm dev
   ```

10. Start the site with `proc-man process start PROCESS_ID`.
11. Open `http://localhost:4321`.

Use the IDs that proc-man returns. Stop services with `proc-man process stop PROCESS_ID`.
The database volume retains local data after the service stops.

## Scope

The first version contains the front page and in-page navigation.
PostgreSQL runs as a separate local service, ready for future server features.
The static front page does not connect to PostgreSQL or change guild data.
Authentication, membership, raid scheduling, and bank transactions require future work.

Execute `pnpm build` to create the static site in `dist/`.
Execute `pnpm db:shell` to inspect the local database.

## Licenses

The Arcane theme uses the MIT license in `licenses/fantasy-rts-ui.txt`.
The site uses original SVG artwork and system fonts.
See `docs/dependencies.md` for dependency evidence.
