# Project rules

- Agents are barred from creating subtitles anywhere in this project.
- Do not add taglines, eyebrow text, or secondary title text beneath or above headings.
- Use Astro components and the vendored Fantasy RTS Arcane theme.
- Read `README.md` and `docs/dependencies.md` before changing the project.
- Read `docs/code-guidelines.md` before building or changing UI lists, layouts, or filters. Prefer compact expandable lists over card grids for long collections.
- Read `docs/requirements.md` before planning, implementing, or reviewing website or addon features. Treat it as the product requirements.
- Read `docs/addon-reuse.md` and `vendor/addons/manifest.json` before reusing addon code. Preserve source licenses and recorded provenance.
- Read `docs/ultimate-bank-integration.md` before changing bank-character collection, imports, or bank-tab behavior.
- Read `docs/addon-ui-patterns.md` before building or changing the companion addon's interface.
- Keep PostgreSQL access on the server. Never send database credentials to the browser.
- Keep guild data separate from presentation. Do not present sample records as real guild activity.
- Store timestamps in UTC in PostgreSQL, but always display dates and times in the user's local browser timezone (using `<LocalTime />` / browser-local `toLocaleString()`). Never hardcode `timeZone: 'UTC'` in user-facing UI.
- Filter forms (`form.filter-bar`, `form[data-auto-filter]`) must auto-apply immediately when options change (no manual Filter/Search button click required).
- Send all emails via SMTP as `multipart/alternative` with an HTML version styled to match the site's Fantasy RTS Arcane theme and a plain-text fallback.
