# Dependency evidence

Checked on 2026-11-20.

## Astro

- Exact package: `astro@7.4.13`.
- Owner: the Astro project, published by its trusted GitHub Actions publisher.
- Source: https://github.com/withastro/astro
- Registry: https://registry.npmjs.org/astro/latest
- License: MIT, with notices for incorporated code.
- Release history: https://github.com/withastro/astro/releases
- Maintenance: the registry reports a release on 2026-11-18.
- Adoption: the npm downloads API reports 49,772,245 downloads for 2026-10-21 through 2026-11-19.
  Source: https://api.npmjs.org/downloads/point/last-month/astro
- Security policy: https://github.com/withastro/astro/security/policy
- Security advisories: https://github.com/withastro/astro/security/advisories
- Astro provides the requested compiler, routing, and static rendering.
  Implementing a web framework directly would exceed this project scope.
- Transitive dependencies include Vite, the Astro compiler, Markdown tools, and image tools.
  Commit the lockfile and inspect the package audit before delivery.
- Installation audit: `pnpm audit --json` reports no known vulnerabilities across 285 resolved dependencies.
  This checks published advisories. It does not guarantee that dependencies contain no defects.

## PostgreSQL

- Exact image family: `postgres:18-alpine`, from the Docker Official Image.
- Installed version: PostgreSQL 18.7. Compose pins the pulled image digest.
- Image source: https://github.com/docker-library/postgres
- Upstream: https://www.postgresql.org/
- License: https://www.postgresql.org/about/licence/
- Security policy and supported releases: https://www.postgresql.org/support/security/
- PostgreSQL provides the requested relational database and transaction engine.
  A direct implementation would require building a database engine.
- The image includes Alpine and PostgreSQL runtime libraries.
  Bind the port to loopback. Keep credentials in the ignored `.env` file.
- The frontend adds no database driver until a server feature needs one.
- The npm audit does not assess operating-system packages in the database image.

## Fantasy RTS UI Themes

- Owner: blacklogos. License copyright holder: Tri Vo.
- Source: https://github.com/blacklogos/wrap-fantasy-themes
- Theme: `themes/arcane.css`.
- License: MIT. Preserve the notice in `licenses/fantasy-rts-ui.txt`.
- This is vendored CSS, not an installed JavaScript dependency.
- The project overrides the theme locally. Keep upstream code separate.
- Use system fonts. The site does not load Google Fonts or Blizzard assets.
- The small theme repository has no published security policy or package release guarantee.
  Review future updates before replacing the vendored file.
- Source SHA-256: `13553c2be94219746a68e4e7720904903200773f20399643dda3ae4c105accf4`.
- The local copy removes trailing spaces. It otherwise matches the source.

## Addon source snapshots

Read `docs/addon-reuse.md` for the source selection, licenses, adoption evidence, and integration boundaries.
The copied source in `vendor/addons/` adds no active website or addon runtime dependency.
