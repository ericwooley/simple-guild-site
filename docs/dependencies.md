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

## Initial server dependencies

Checked on 2026-11-20 before installation.

| Package | Source and ownership | Release and adoption |
| --- | --- | --- |
| `@astrojs/node@11.1.14` | [Astro's official Node adapter](https://github.com/withastro/astro/tree/main/packages/integrations/node), maintained by withastro, MIT | Registry release 2026-11-18. 6,120,130 downloads during 2026-10-21 through 2026-11-19. Astro repository: 64,098 stars. |
| `pg@8.23.1` | [node-postgres](https://github.com/brianc/node-postgres/tree/master/packages/pg), maintained by brianc, MIT | Registry release 2026-09-30. 418,197,613 downloads during the same period. Repository: 13,240 stars. |

The exact registry names, repository owners, package licenses, versions, and release timestamps match their established projects.
Both repositories remain unarchived and have recent source updates.
Registry evidence: [Node adapter](https://registry.npmjs.org/@astrojs%2fnode), [PostgreSQL client](https://registry.npmjs.org/pg).
Adoption evidence: [Node adapter downloads](https://api.npmjs.org/downloads/point/last-month/@astrojs%2fnode),
[PostgreSQL client downloads](https://api.npmjs.org/downloads/point/last-month/pg).

The adapter supports the installed Astro 7 release and supplies the Node server runtime.
The PostgreSQL client supplies parameterized queries, connections, and transactions.
Direct implementations would require replacing a framework runtime adapter and a database wire protocol.
Neither package exists only to save a small helper function.

The adapter brings `send`, `server-destroy`, and Astro's internal helpers.
The PostgreSQL client brings its pool, connection-string parser, protocol, types, and password-file helpers.
The project does not install the optional native PostgreSQL client.
Commit the exact lockfile and check published advisories after installation.
Read the [Astro security policy](https://github.com/withastro/astro/security/policy)
and [node-postgres security page](https://github.com/brianc/node-postgres/security/policy) before future updates.
The PostgreSQL repository has no GitHub latest-release object. The npm registry supplies current release evidence.
JWTs, sessions, the bridge parser, and addon controls add no additional package dependencies.

## Browser checks

- Exact development package: `@playwright/test@1.65.1`, published 2026-11-13.
- Owner and source: [Microsoft Playwright](https://github.com/microsoft/playwright), Apache-2.0 license.
- Registry: https://registry.npmjs.org/@playwright%2ftest
- Adoption: 516,309,555 downloads during 2026-10-21 through 2026-11-19.
- Download evidence: https://api.npmjs.org/downloads/point/last-month/@playwright%2ftest
- The unarchived repository had 100,689 stars and recent updates when checked.
- Releases: https://github.com/microsoft/playwright/releases
- Security policy: https://github.com/microsoft/playwright/blob/main/SECURITY.md
- The exact package depends on the matching `playwright` and `playwright-core` versions.
- It controls a disposable browser for login, forms, navigation, and narrow-screen checks.
  Direct implementation would require a browser automation protocol and test runner.
- Use isolated test sessions rather than personal browser profiles.
- The package adds no browser code to the shipped website.
- Check the resolved lockfile and published advisories after installation.

The resolved initial test build contains 322 dependencies, including optional and development dependencies.
`pnpm audit --json` reported zero published vulnerabilities after installation.
The node-postgres security page reports no published security policy.
This advisory check does not prove that a package contains no defects.
