# Project rules

- Agents are barred from creating subtitles anywhere in this project.
- Do not add taglines, eyebrow text, or secondary title text beneath or above headings.
- Use Astro components and the vendored Fantasy RTS Arcane theme.
- Read `README.md` and `docs/dependencies.md` before changing the project.
- Read `docs/requirements.md` before planning, implementing, or reviewing website or addon features. Treat it as the product requirements.
- Read `docs/addon-reuse.md` and `vendor/addons/manifest.json` before reusing addon code. Preserve source licenses and recorded provenance.
- Read `docs/ultimate-bank-integration.md` before changing bank-character collection, imports, or bank-tab behavior.
- Read `docs/addon-ui-patterns.md` before building or changing the companion addon's interface.
- Keep PostgreSQL access on the server. Never send database credentials to the browser.
- Keep guild data separate from presentation. Do not present sample records as real guild activity.
- Use proc-man for long-running services. Declare the directory, tags, and ports.
