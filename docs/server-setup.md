# Server setup and test boundaries

## Local setup

The website stores guild data in PostgreSQL.
The Astro server reads database credentials from its environment.
The browser receives no database credentials or Battle.net access tokens.

1. Configure `DATABASE_URL` in the ignored `.env` file.
2. Set `APP_ORIGIN=http://localhost:4321` for local tests.
3. Set `ENABLE_LOCAL_TEST_LOGIN=true` for local fixture accounts.
4. Set `SYNC_JWT_SECRET` to a random secret with at least 32 bytes.
5. Execute `node --env-file=.env scripts/db-migrate.mjs`.
6. Execute `node --env-file=.env scripts/db-seed.mjs`.
7. Start the website through its registered proc-man service.
8. Open `http://localhost:4321/login`.
9. Select the local owner or member fixture account.

Bind the local website to `127.0.0.1`.
The local account action checks the request hostname and connection address.
Production mode disables fixture accounts and fixture sync tokens.
Use HTTPS for external access.
Do not expose the local fixture build as a production website.

The fixture seed replaces the fixture guild state.
It does not replace real account records or other guilds.
It provides test stock, characters, professions, and recipes.
The account names mark these records as fixtures.
The local owner can issue guild tokens and manage requests and titles.
The local member can issue member tokens and manage personal data.

## Tests with game character names

Create a local JSON file with the identity fields below.
Use full character names, including surnames where the client supplies them.
Use the exact realm value that the companion addon captures.
The realm field preserves the initial export contract.
It does not establish a verified Forever realm identity.

```json
{
  "guildName": "Band of the Helping Hand",
  "realm": "Test Realm",
  "region": "us",
  "ownerCharacter": "Test Owner",
  "memberCharacter": "Test Member",
  "bankCharacters": ["Test Bank", "Another Bank"]
}
```

1. Replace the values with your test character and bank names.
2. Execute `node --env-file=.env scripts/db-seed.mjs --config /absolute/path/local-test-config.json`.
3. Sign in to the local fixture account.
4. Generate a token in Addon Sync.
5. Paste the token into the companion addon.
6. Capture a snapshot in the game.
7. Save the addon data through logout or the supported client save action.
8. Use the bridge instructions to upload the snapshot.
9. Check the bank, roster, professions, and sync status.

These names remain local fixtures.
The test does not prove Battle.net ownership or real guild-owner status.
The designated bank list limits uploaded bank characters.
The server rejects banks outside that list, even with a guild token.
No website action grants owner permission from uploaded ranks.

## Battle.net login

Configure these server-only values:

- `BNET_CLIENT_ID`
- `BNET_CLIENT_SECRET`
- `BNET_REDIRECT_URI`, with the full `/auth/callback` URL
- `APP_ORIGIN`, matching the public website origin

Register the callback URL in the Battle.net application.
Start login at `/auth/battlenet`.
The `/auth/start` route provides the same entry.
The server uses a one-use, expiring state value bound to an HttpOnly cookie.
The server exchanges the authorization code directly with Battle.net.
It reads account identity from the official userinfo endpoint.
It keeps the access token only during that request.
It never stores the token or sends it to the browser.
An opaque HttpOnly cookie identifies the website session.
The database stores only the hash of that session secret.
Sessions expire after 24 hours.

Battle.net login currently establishes identity only.
It grants no guild membership, linked characters, or sync token permission.
The server does not assign the first account as owner.
Real owner bootstrap remains disabled until server-side character and guild verification works.
This restriction preserves the requirements for verified ownership and guild status.

## API evidence and verification gap

Checked on 2026-11-20.
The official [OpenID discovery endpoint](https://oauth.battle.net/.well-known/openid-configuration)
returned these endpoints during implementation:

- `https://oauth.battle.net/authorize`
- `https://oauth.battle.net/token`
- `https://oauth.battle.net/userinfo`

The official [authorization-code documentation](https://develop.battle.net/documentation/guides/using-oauth/authorization-code-flow)
redirected to the developer community documentation.
The research tool could not read the redirected page.
The official [Classic profile documentation](https://develop.battle.net/documentation/world-of-warcraft-classic/profile-apis)
and [namespace documentation](https://develop.battle.net/documentation/world-of-warcraft-classic/guides/namespaces)
had the same access limit.

A [developer report on Blizzard's forum](https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334)
describes an undocumented `profile-forever` namespace, full-name character identities, and rulesets instead of realms.
This report does not constitute a Blizzard-supported contract.
An [official API clarification request](https://us.forums.blizzard.com/en/blizzard/t/official-read-only-profile-api-for-wow-forever/60565)
also asks Blizzard to confirm supported ownership and profile reads.
No authenticated game account or application credentials were available for live verification.
Therefore, this build does not infer ownership from a public profile or an addon upload.
Test Forever account summaries, stable identities, guild membership, and owner verification before enabling real guild access.

## Sync and storage behavior

Sync tokens use HS256 with an explicit algorithm, issuer, audience, subject, token ID, guild, scope, issue time, and expiry.
Tokens expire after 30 days.
Every upload checks the stored token, revocation, current active membership, and required owner permission.
The server stores token metadata rather than raw JWTs.
Tokens authorize uploads only.
They cannot create website sessions or approve bank requests.

The server validates the complete upload before it changes data.
Unknown fields and private inventory structures cause rejection.
The server limits JSON uploads to five MiB.
The server serializes each guild update within a database transaction.
It deduplicates snapshot IDs per account.
It rejects repeated IDs with changed payloads.
A repeat with identical content changes no stock.
Older captures cannot replace newer bank data.
Incomplete bank views preserve missing items.
Complete visible bank views replace stock, including items that became hidden.
Complete views do not prove fresh physical container scans.
The website retains unknown source age as unknown.

Member tokens update only their verified characters.
Guild tokens can update existing current-roster directory characters.
Those directory updates never link an account or grant membership.
The upload source character must belong to the token account.
Unknown recipe scans preserve earlier recipe data.
Recipe refreshes preserve offered-craft preferences, including recipes that disappear and later return.
Roster refreshes preserve profession titles and stable directory IDs.
Request approval never changes confirmed stock.
View-only sources contribute no requestable quantity.

The database stores each guild's presentation records in a transaction-locked JSON document.
Relational tables store accounts, memberships, sessions, token grants, and snapshot receipts.
This initial model supports a small guild test.
Large guild datasets require further load and retention work.

## Available checks

Execute the pure and authentication tests:

```sh
node --test tests/domain-sync.test.mjs tests/server-auth.test.mjs
```

Execute the PostgreSQL integration test:

```sh
RUN_DB_TESTS=1 node --env-file=.env --test tests/server-integration.test.mjs
```

The integration test creates an isolated temporary PostgreSQL schema.
It removes that schema after the test.
It checks sessions, scoped tokens, repeated uploads, revocation, permission loss, requests, favorites, titles, and offered recipes.
It also checks the OAuth flow with an injected test response.
That response does not establish a successful live Battle.net login.
