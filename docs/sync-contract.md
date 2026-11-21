# Initial sync contract

## Transport

The addon stores `HelpingHandDB.token` separately from `HelpingHandDB.outbox`.
The outbox contains one JSON-compatible snapshot table.
The Python bridge parses a strict Lua data subset. It never executes Lua.
The bridge sends only the outbox to `POST /api/sync` with `Authorization: Bearer <token>`.
Use HTTPS, except for explicit loopback development URLs.
The website validates and stores snapshots transactionally.

## Snapshot version 1

```json
{
  "schemaVersion": 1,
  "snapshotId": "unique-capture-identifier",
  "capturedAt": 1795219200,
  "source": {
    "addonVersion": "0.1.0",
    "character": { "name": "Character Name", "realm": "Realm" },
    "guild": { "name": "Band of the Helping Hand", "realm": "Realm", "region": "us" }
  },
  "characters": [
    {
      "name": "Character Name", "realm": "Realm", "guid": "Player-example",
      "level": 30, "className": "Mage",
      "professions": [
        {
          "id": 171, "name": "Alchemy", "rank": 150, "maxRank": 225,
          "recipes": [{ "id": 2330, "name": "Minor Healing Potion", "itemId": 118, "kind": "item" }]
        }
      ]
    }
  ],
  "roster": {
    "complete": false,
    "members": [{ "name": "Character Name", "realm": "Realm", "rankName": "Member", "rankIndex": 5, "level": 30, "className": "Mage" }]
  },
  "banks": [
    {
      "name": "Bank Character", "realm": "Realm", "guildName": "Band of the Helping Hand",
      "viewOnly": false, "complete": false, "observedAt": null,
      "sourceVersion": "upstream-revision",
      "items": [{ "itemId": 118, "suffixId": 0, "enchantId": 0, "count": 20, "name": "Minor Healing Potion", "quality": 1 }]
    }
  ]
}
```

Times use Unix seconds. Missing capture evidence stays unknown.
Member snapshots omit `roster` and `banks`. Only guild tokens can upload these fields.
Member character uploads must match the account's verified character identities.
The source character must belong to the token account for every token scope.
Guild tokens can update existing current-roster directory characters, including unlinked characters.
Those updates never establish character ownership, active membership, or account permissions.
Only server-side verification can establish those properties.
Use case-normalized region, realm, and full character name for scoped lookup.
Neither the source name nor a guild rank in an upload proves account ownership or owner status.
An incomplete bank capture cannot delete previously confirmed items.
Unknown profession or recipe data must preserve previous confirmed records.
Only actual learned-recipe scans include a `recipes` array. An absent array means unknown.
The server deduplicates each account's `snapshotId` and rejects reused identifiers with different contents.
Item identity includes `itemId`, signed `suffixId`, and `enchantId`.
Raw hidden inventory, Battle.net tokens, sync JWTs, and unrelated SavedVariables never enter an upload payload.

## Website interface

`src/server/service.mjs` exports `getPortalData(request)` for server-rendered pages.
It returns `account`, `guild`, `characters`, `roster`, `bank`, `requests`, `professions`, `tokens`, and `syncs`.
It also returns `localTestLogin` and `battleNetConfigured` booleans.
An absent session produces `account: null` and no private guild arrays.

The frontend posts JSON to `/api/actions` using an `action` field.
Responses contain `ok`, `message`, and optional `token` or `redirect` fields.
All cookie-authenticated mutations require a matching request Origin.

| Action | Additional fields |
| --- | --- |
| `local-login` | `persona`: `owner` or `member` |
| `logout` | None |
| `issue-token` | `scope`: `member` or `guild` |
| `revoke-token` | `id` |
| `favorite` | `itemKey` |
| `request-item` | `itemKey`, `quantity`, `characterId` |
| `update-request` | `id`, `status`: `approved`, `declined`, or `fulfilled` |
| `set-main` | `characterId` |
| `set-offer` | `recipeKey`, `offered` |
| `set-title` | `characterId`, `title`, `assigned` |

## Page data fields

- `account`: `id`, `battleTag`, `role` (`owner` or `member`), `testAccount`.
- `guild`: `id`, `name`.
- `characters`: `id`, `name`, `realm`, `level`, `className`, `guildRank`, `isMain`, `verified`, `titles`.
- `roster`: character fields plus optional `updatedAt`.
- `bank`: `itemKey`, `itemId`, `suffixId`, `enchantId`, `name`, `count`, `favorite`, `banks`.
- Each bank source: `name`, `realm`, `count`, `viewOnly`, `observedAt`, `receivedAt`, `complete`.
- `requests`: `id`, `itemKey`, `itemName`, `quantity`, `characterName`, `requesterName`, `status`, `createdAt`.
- `professions`: `characterId`, `characterName`, `name`, `rank`, `maxRank`, `titles`, `recipes`, `updatedAt`.
- Each recipe: `recipeKey`, `id`, `name`, `itemId`, `kind`, `offered`, `canEdit`.
- `tokens`: `id`, `scope`, `createdAt`, `expiresAt`, `revokedAt`, `lastUsedAt`. Never include the JWT.
- `syncs`: `id`, `status`, `capturedAt`, `receivedAt`, `summary`.

Dates in page data use ISO strings or null. Quantities and ranks use numbers.
The service returns safe plain data. Astro escapes user-provided text.
