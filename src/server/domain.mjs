export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const normalize = value => String(value).trim().toLocaleLowerCase('en-US');
export const characterKey = (character) => `${normalize(character.realm)}:${normalize(character.name)}`;
export const itemKey = item => `${item.itemId}:${item.suffixId ?? 0}:${item.enchantId ?? 0}`;
function assert(condition, message) { if (!condition) throw new InputError(message); }
function object(value) { assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.'); }
function fields(value, allowed) { object(value); assert(Object.keys(value).every(k => allowed.includes(k)), 'The snapshot contains an unsupported field.'); }
function text(value, label, max = 120) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value), `Invalid ${label}.`); }
function integer(value, label, min = 0, max = 2147483647) { assert(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${label}.`); }
function array(value, max, label) { assert(Array.isArray(value) && value.length <= max, `Invalid ${label}.`); }
function identity(value) { text(value.name, 'character name'); text(value.realm, 'realm'); }
function optionalText(value, label) { if (value !== undefined && value !== null) text(value, label, 500); }
export function validateSnapshot(value, now = Date.now()) {
  fields(value, ['schemaVersion','snapshotId','capturedAt','source','characters','roster','banks','bankLog','guildMeta']);
  assert(value.schemaVersion === 1, 'Unsupported snapshot version.');
  text(value.snapshotId, 'snapshot ID', 160);
  integer(value.capturedAt, 'capture time', 1, Math.floor(now / 1000) + 300);
  fields(value.source, ['addonVersion','character','guild']);
  text(value.source.addonVersion, 'addon version');
  fields(value.source.character, ['name','realm']); identity(value.source.character);
  fields(value.source.guild, ['name','realm','region']); identity(value.source.guild);
  assert(['us','eu','kr','tw'].includes(value.source.guild.region), 'Invalid region.');
  array(value.characters, 100, 'characters');
  const chars = new Set();
  let totalRecipes = 0;
  for (const char of value.characters) {
    fields(char, ['name','realm','guid','level','className','professions']); identity(char);
    assert(!chars.has(characterKey(char)), 'Duplicate character.'); chars.add(characterKey(char));
    optionalText(char.guid, 'character GUID'); optionalText(char.className, 'class');
    if (char.level !== undefined) integer(char.level, 'level', 1, 200);
    if (char.professions !== undefined) {
      array(char.professions, 20, 'professions'); const professions = new Set();
      for (const prof of char.professions) {
        fields(prof, ['id','name','rank','maxRank','recipes']); integer(prof.id, 'profession ID', 1); text(prof.name, 'profession name');
        assert(!professions.has(prof.id), 'Duplicate profession.'); professions.add(prof.id);
        integer(prof.rank, 'profession rank'); integer(prof.maxRank, 'maximum rank'); assert(prof.rank <= prof.maxRank, 'Invalid profession rank.');
        if (prof.recipes !== undefined) {
          array(prof.recipes, 2500, 'recipes'); const recipes = new Set();
          totalRecipes += prof.recipes.length;
          assert(totalRecipes <= 2500, 'Too many recipes in one snapshot.');
          for (const recipe of prof.recipes) {
            fields(recipe, ['id','name','itemId','kind']); integer(recipe.id, 'recipe ID', 1); text(recipe.name, 'recipe name');
            if (recipe.itemId !== undefined && recipe.itemId !== null) integer(recipe.itemId, 'crafted item ID', 1);
            assert(['item','enchant','spell'].includes(recipe.kind), 'Invalid recipe kind.');
            assert(!recipes.has(recipe.id), 'Duplicate recipe.'); recipes.add(recipe.id);
          }
        }
      }
    }
  }
  if (value.roster !== undefined) {
    fields(value.roster, ['complete','members']); assert(typeof value.roster.complete === 'boolean', 'Invalid roster coverage.'); array(value.roster.members, 2000, 'roster');
    const members = new Set();
    for (const member of value.roster.members) {
      fields(member, ['name','realm','rankName','rankIndex','level','className','online','zone']); identity(member);
      assert(!members.has(characterKey(member)), 'Duplicate roster character.'); members.add(characterKey(member));
      optionalText(member.rankName, 'guild rank'); if (member.rankIndex !== undefined) integer(member.rankIndex, 'guild rank');
      if (member.level !== undefined) integer(member.level, 'level', 1, 200); optionalText(member.className, 'class');
      if (member.online !== undefined) assert(typeof member.online === 'boolean', 'Invalid online status.');
      optionalText(member.zone, 'zone');
    }
  }
  if (value.banks !== undefined) {
    array(value.banks, 100, 'banks'); const banks = new Set();
    for (const bank of value.banks) {
      fields(bank, ['name','realm','guildName','viewOnly','complete','observedAt','sourceVersion','sourceKind','itemsKnown','items']); identity(bank); text(bank.guildName, 'bank guild');
      assert(!banks.has(characterKey(bank)), 'Duplicate bank.'); banks.add(characterKey(bank));
      assert(typeof bank.viewOnly === 'boolean' && typeof bank.complete === 'boolean', 'Invalid bank coverage.');
      if (bank.observedAt !== null && bank.observedAt !== undefined) integer(bank.observedAt, 'bank scan time', 1, value.capturedAt + 300);
      optionalText(bank.sourceVersion, 'source version');
      if (bank.sourceKind !== undefined && bank.sourceKind !== null) assert(['ultimate-bank', 'native'].includes(bank.sourceKind), 'Invalid bank source kind.');
      if (bank.itemsKnown !== undefined) assert(typeof bank.itemsKnown === 'boolean', 'Invalid bank itemsKnown flag.');
      array(bank.items, 20000, 'bank items'); const keys = new Set();
      for (const item of bank.items) {
        fields(item, ['itemId','suffixId','enchantId','count','name','quality','vendorPrice']); integer(item.itemId, 'item ID', 1);
        integer(item.suffixId ?? 0, 'suffix ID', -2147483647); integer(item.enchantId ?? 0, 'enchant ID'); integer(item.count, 'item count', 1, 1000000000);
        optionalText(item.name, 'item name'); if (item.quality !== undefined) integer(item.quality, 'item quality', 0, 8);
        if (item.vendorPrice !== undefined && item.vendorPrice !== null) integer(item.vendorPrice, 'vendor price', 0, 2147483647);
        assert(!keys.has(itemKey(item)), 'Duplicate bank item.'); keys.add(itemKey(item));
      }
    }
  }
  if (value.bankLog !== undefined) {
    array(value.bankLog, 2000, 'bank log');
    const validTypes = new Set(['deposit','withdraw','money-deposit','money-withdraw','requested','mailed','handed','cancelled','reopened']);
    for (const entry of value.bankLog) {
      fields(entry, ['type','ts','name','bankName','from','to','actorName','itemId','itemID','suffixId','suffixID','item','itemName','count','quantity','money','moneyCopper','vendorPrice','requestId','note']);
      assert(typeof entry.type === 'string' && validTypes.has(entry.type), 'Invalid bank log entry type.');
      integer(entry.ts, 'bank log timestamp', 1, value.capturedAt + 300);
      text(entry.bankName ?? entry.name, 'bank log character');
      optionalText(entry.from, 'bank log donor');
      optionalText(entry.to, 'bank log recipient');
      optionalText(entry.actorName, 'bank log actor');
      if (entry.itemId !== undefined && entry.itemId !== null) integer(entry.itemId, 'bank log item ID', 1);
      if (entry.itemID !== undefined && entry.itemID !== null) integer(entry.itemID, 'bank log item ID', 1);
      if (entry.suffixId !== undefined && entry.suffixId !== null) integer(entry.suffixId, 'bank log suffix ID', -2147483647);
      if (entry.suffixID !== undefined && entry.suffixID !== null) integer(entry.suffixID, 'bank log suffix ID', -2147483647);
      optionalText(entry.item ?? entry.itemName, 'bank log item name');
      if (entry.count !== undefined && entry.count !== null) integer(entry.count, 'bank log count', 0, 1000000000);
      if (entry.quantity !== undefined && entry.quantity !== null) integer(entry.quantity, 'bank log quantity', 0, 1000000000);
      if (entry.money !== undefined && entry.money !== null) integer(entry.money, 'bank log money', 0, 2147483647);
      if (entry.moneyCopper !== undefined && entry.moneyCopper !== null) integer(entry.moneyCopper, 'bank log money', 0, 2147483647);
      if (entry.vendorPrice !== undefined && entry.vendorPrice !== null) integer(entry.vendorPrice, 'bank log vendor price', 0, 2147483647);
      optionalText(entry.requestId, 'bank log request ID');
      if (entry.note !== undefined && entry.note !== null) assert(typeof entry.note === 'string' && entry.note.length <= 300 && !/[\x00-\x1f]/.test(entry.note), 'Invalid bank log note.');
    }
  }
  if (value.guildMeta !== undefined) {
    fields(value.guildMeta, ['motd','infoText']);
    if (value.guildMeta.motd !== undefined && value.guildMeta.motd !== null) {
      assert(typeof value.guildMeta.motd === 'string' && value.guildMeta.motd.length <= 500 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.guildMeta.motd), 'Invalid guild message of the day.');
    }
    if (value.guildMeta.infoText !== undefined && value.guildMeta.infoText !== null) {
      assert(typeof value.guildMeta.infoText === 'string' && value.guildMeta.infoText.length <= 2000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.guildMeta.infoText), 'Invalid guild info text.');
    }
  }
  return value;
}
export function authorizeSnapshot(snapshot, account, guild, state, scope) {
  const realmless = typeof guild.id === 'string' && guild.id.startsWith('bnet:');
  const matchKey = c => realmless ? normalize(c.name) : characterKey(c);
  assert(
    normalize(snapshot.source.guild.name) === normalize(guild.name) &&
    (realmless || normalize(snapshot.source.guild.realm) === normalize(guild.realm)) &&
    snapshot.source.guild.region === guild.region,
    'The snapshot belongs to another guild.'
  );
  if (scope !== 'guild') assert(snapshot.roster === undefined && snapshot.banks === undefined && snapshot.bankLog === undefined && snapshot.guildMeta === undefined, 'A guild token must authorize roster, bank, and guild info uploads.');
  const owned = state.characters.filter(c => c.verified && c.active !== false && c.accountId === account.id);
  const ownedKeys = new Set(owned.map(matchKey));
  assert(ownedKeys.has(matchKey(snapshot.source.character)), 'Verify the source character before syncing.');
  const rosterKeys = new Set(state.roster.map(matchKey));
  const permittedKeys = new Set(state.characters.filter(c => c.active !== false && (ownedKeys.has(matchKey(c)) || (scope === 'guild' && rosterKeys.has(matchKey(c))))).map(matchKey));
  for (const char of snapshot.characters) assert(permittedKeys.has(matchKey(char)), 'Verify each character or use a guild token for current roster data.');
  const designated = new Set((state.designatedBanks ?? []).map(matchKey));
  for (const bank of snapshot.banks ?? []) assert(designated.has(matchKey(bank)) && normalize(bank.guildName) === normalize(guild.name), 'The guild has not designated this bank character.');
}
export function mergeSnapshot(previous, snapshot, receivedAt, accountId) {
  const state = structuredClone(previous);
  state.offers ??= {};
  const findChar = target => state.characters.find(c => characterKey(c) === characterKey(target)) ?? state.characters.find(c => typeof c.id === 'string' && c.id.startsWith('bnet:') && normalize(c.name) === normalize(target.name));
  for (const char of state.characters) for (const prof of char.professions ?? []) for (const recipe of prof.recipes ?? []) {
    state.offers[`${char.id}:${prof.id}:${recipe.id}`] = recipe.offered ?? false;
  }
  for (const incoming of snapshot.characters) {
    const char = findChar(incoming);
    if (!char) continue;
    if (char.capturedAt && char.capturedAt > snapshot.capturedAt) continue;
    for (const field of ['level','className','guid']) if (incoming[field] !== undefined) char[field] = incoming[field];
    char.updatedAt = receivedAt; char.capturedAt = snapshot.capturedAt;
    if (incoming.professions !== undefined) {
      char.professions ??= [];
      const incomingObsMs = snapshot.capturedAt * 1000;
      const incomingObsIso = new Date(incomingObsMs).toISOString();
      const completeObsMs = Date.parse(char.professionsCompleteObservedAt || '') || 0;
      for (const profession of incoming.professions) {
        const old = char.professions.find(p => p.id === profession.id);
        const oldObsMs = old ? (Date.parse(old.observedAt || old.updatedAt || '') || 0) : 0;
        if (Math.max(oldObsMs, completeObsMs) > incomingObsMs) continue;
        const recipes = profession.recipes === undefined ? old?.recipes : profession.recipes.map(recipe => ({ ...recipe, offered: state.offers[`${char.id}:${profession.id}:${recipe.id}`] ?? false }));
        const merged = { ...profession, recipes, recipesKnown: profession.recipes !== undefined, updatedAt: receivedAt, observedAt: incomingObsIso };
        char.professions = [...char.professions.filter(p => p.id !== profession.id), merged];
      }
      assert(char.professions.length <= 20, 'Too many stored professions for one character.');
      const totalStoredRecipes = char.professions.reduce((sum, p) => sum + (Array.isArray(p.recipes) ? p.recipes.length : 0), 0);
      assert(totalStoredRecipes <= 2500, 'Too many stored recipes for one character.');
    }
  }
  if (snapshot.roster && (!state.rosterCapturedAt || snapshot.capturedAt >= state.rosterCapturedAt)) {
    state.rankConfig ??= {};
    const rows = snapshot.roster.members.map(c => {
      if (Number.isSafeInteger(c.rankIndex) && c.rankName) {
        const k = String(c.rankIndex);
        if (!state.rankConfig[k]) state.rankConfig[k] = { name: c.rankName, permissions: {} };
        else if (!state.rankConfig[k].name || state.rankConfig[k].name === `Rank ${c.rankIndex}`) state.rankConfig[k].name = c.rankName;
      }
      let char = findChar(c);
      if (!char) {
        char = {id:`roster:${characterKey(c)}`,name:c.name,realm:c.realm,accountId:null,verified:false,active:true,isMain:false,titles:[],professions:[]};
        state.characters.push(char);
      }
      char.guildRank = c.rankName ?? char.guildRank ?? null;
      if (Number.isSafeInteger(c.rankIndex)) char.guildRankIndex = c.rankIndex;
      if (typeof c.online === 'boolean') char.online = c.online;
      if (c.zone !== undefined) char.zone = c.zone;
      return {...c,id:char.id,guildRank:c.rankName ?? char.guildRank ?? null,guildRankIndex:c.rankIndex ?? char.guildRankIndex ?? null,online:Boolean(c.online),zone:c.zone ?? null,verified:char.verified,updatedAt:receivedAt};
    });
    state.roster = snapshot.roster.complete ? rows : [...state.roster.filter(c => !rows.some(r => characterKey(c) === characterKey(r) || normalize(c.name) === normalize(r.name))), ...rows];
    state.rosterCapturedAt = snapshot.capturedAt;
    // Uploaded ranks never change account permissions or verified membership.
  }
  const bankStockSignature = (items = []) => {
    return (items ?? [])
      .map(i => `${itemKey(i)}=${i.count}`)
      .sort()
      .join('|');
  };
  const parseUbVersion = (value) => {
    if (typeof value !== 'string') return null;
    const match = /^(\d*):(\d*)$/.exec(value.trim());
    if (!match || (!match[1] && !match[2])) return null;
    const version = match[1] ? Number(match[1]) : null;
    const updatedAt = match[2] ? Number(match[2]) : null;
    if (version !== null && (!Number.isSafeInteger(version) || version < 0 || version > 2147483647)) return null;
    if (updatedAt !== null && (!Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > 4102444800)) return null;
    return { version, updatedAt };
  };
  const isOlderUbVersion = (incomingVer, oldVer) => {
    const a = parseUbVersion(incomingVer);
    const b = parseUbVersion(oldVer);
    if (!a || !b) return false;
    if (a.version !== null && b.version !== null && a.version !== b.version) return a.version < b.version;
    if (a.updatedAt !== null && b.updatedAt !== null && a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt;
    return false;
  };
  for (const incoming of snapshot.banks ?? []) {
    const sameBank = b => characterKey(b) === characterKey(incoming) || normalize(b.name) === normalize(incoming.name);
    const old = state.banks.find(sameBank);
    const oldIsExplicitUB = old?.sourceKind === 'ultimate-bank';
    const oldIsUB = Boolean(old && (
      oldIsExplicitUB
      || (old.sourceKind == null && old.observedAt === null && (old.complete === false || old.viewOnly === true))
    ));
    const nextViewOnlyCapturedAt = incoming.viewOnly
      ? Math.max(old?.viewOnlyCapturedAt ?? (old?.viewOnly ? (old?.capturedAt ?? 0) : 0), snapshot.capturedAt)
      : (old?.viewOnlyCapturedAt ?? (old?.viewOnly ? (old?.capturedAt ?? null) : null));
    const effectiveViewOnlyAt = old?.viewOnlyCapturedAt ?? (old?.viewOnly ? (old?.capturedAt ?? null) : null);
    // Strictly greater than: a same-second unrestricted capture can never clear a viewOnly restriction (including migrated rows).
    const canClearViewOnly = !effectiveViewOnlyAt || snapshot.capturedAt > effectiveViewOnlyAt;

    // Delayed transition from native/legacy -> Ultimate Bank must still clear potentially private stock immediately.
    if (old?.capturedAt > snapshot.capturedAt) {
      if (incoming.sourceKind === 'ultimate-bank' && !oldIsExplicitUB) {
        const isItemsKnown = incoming.itemsKnown === true;
        const parsedVer = parseUbVersion(incoming.sourceVersion);
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...incoming,
          complete: false,
          observedAt: null,
          viewOnly: isItemsKnown ? (incoming.viewOnly ? true : (canClearViewOnly ? false : Boolean(old.viewOnly))) : true,
          viewOnlyCapturedAt: isItemsKnown ? nextViewOnlyCapturedAt : Math.max(effectiveViewOnlyAt ?? 0, snapshot.capturedAt),
          sourceKind: 'ultimate-bank',
          sourceVersion: isItemsKnown ? (incoming.sourceVersion ?? null) : null,
          items: isItemsKnown ? incoming.items : [],
          receivedAt,
          capturedAt: isItemsKnown ? snapshot.capturedAt : null,
          stockChangedAt: isItemsKnown ? (parsedVer?.updatedAt ?? null) : null
        }];
        continue;
      }
      // Even on a delayed upload (native or UB), tighten viewOnly=true and record viewOnlyCapturedAt without replacing stock.
      if (incoming.viewOnly) {
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...old,
          viewOnly: true,
          viewOnlyCapturedAt: nextViewOnlyCapturedAt,
          receivedAt
        }];
      }
      continue;
    }
    if (incoming.sourceKind === 'ultimate-bank') {
      // Ultimate Bank is the authoritative public visibility view (hidden items excluded, viewOnly enforced).
      // Require explicit itemsKnown === true before replacing stock (omitted or false never erases confirmed UB stock).
      // Only preserve prior stock if it was explicitly Ultimate Bank stock (never legacy/native stock).
      if (incoming.itemsKnown !== true) {
        const items = oldIsExplicitUB ? (old?.items ?? []) : [];
        const viewOnly = oldIsExplicitUB ? Boolean(old?.viewOnly || incoming.viewOnly) : true;
        const effectiveCapturedAt = oldIsExplicitUB ? (old?.capturedAt ?? null) : null;
        const effectiveStockChangedAt = oldIsExplicitUB ? (old?.stockChangedAt ?? null) : null;
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...incoming,
          complete: false,
          observedAt: null,
          viewOnly,
          viewOnlyCapturedAt: viewOnly ? Math.max(effectiveViewOnlyAt ?? 0, snapshot.capturedAt) : effectiveViewOnlyAt,
          sourceKind: 'ultimate-bank',
          sourceVersion: oldIsExplicitUB ? (old?.sourceVersion ?? null) : null,
          items,
          receivedAt,
          capturedAt: effectiveCapturedAt,
          stockChangedAt: effectiveStockChangedAt
        }];
        continue;
      }
      // Never let a malformed/partial/unversioned/older UB snapshot overwrite stock from a known revision.
      const parsedInVer = parseUbVersion(incoming.sourceVersion);
      const parsedOldVer = parseUbVersion(old?.sourceVersion);
      if (oldIsExplicitUB && parsedOldVer) {
        const missingOrInvalidInVer = !parsedInVer
          || (parsedOldVer.version !== null && parsedInVer.version === null)
          || (parsedOldVer.updatedAt !== null && parsedInVer.updatedAt === null);
        if (missingOrInvalidInVer || isOlderUbVersion(incoming.sourceVersion, old.sourceVersion)) {
          if (incoming.viewOnly) {
            state.banks = [...state.banks.filter(b => !sameBank(b)), {
              ...old,
              viewOnly: true,
              viewOnlyCapturedAt: nextViewOnlyCapturedAt,
              receivedAt
            }];
          }
          continue;
        }
      }
      const stockChanged = !oldIsExplicitUB || bankStockSignature(old?.items) !== bankStockSignature(incoming.items);
      // Use Ultimate Bank's publication timestamp (inventoryUpdatedAt) whenever present (including on migrated rows
      // whose stockChangedAt was NULL). When no publication timestamp is available, only advance stockChangedAt if
      // observed item quantities actually changed from a prior CONFIRMED explicit UB view (not an itemsKnown=false placeholder).
      let effectiveStockChangedAt = old?.stockChangedAt ?? null;
      if (parsedInVer?.updatedAt && parsedInVer.updatedAt > 0) {
        effectiveStockChangedAt = Math.max(effectiveStockChangedAt ?? 0, parsedInVer.updatedAt);
      } else if (oldIsExplicitUB && old?.capturedAt !== null && old?.capturedAt !== undefined && stockChanged) {
        effectiveStockChangedAt = snapshot.capturedAt;
      }
      const effectiveViewOnly = incoming.viewOnly ? true : (canClearViewOnly ? false : Boolean(old?.viewOnly));
      state.banks = [...state.banks.filter(b => !sameBank(b)), {
        ...incoming,
        complete: false,
        observedAt: null,
        viewOnly: effectiveViewOnly,
        viewOnlyCapturedAt: nextViewOnlyCapturedAt,
        sourceKind: 'ultimate-bank',
        sourceVersion: parsedInVer ? incoming.sourceVersion : (old?.sourceVersion ?? null),
        items: incoming.items,
        receivedAt,
        // Always advance capturedAt on confirmed itemsKnown=true UB views so older delayed captures cannot replace newer confirmed views.
        capturedAt: snapshot.capturedAt,
        stockChangedAt: effectiveStockChangedAt
      }];
      continue;
    }
    // Once a bank is managed by Ultimate Bank (including legacy pre-027 rows), a native upload must never
    // replace its public view, weaken viewOnly, or advance capturedAt/stockChangedAt.
    if (oldIsUB) {
      if (incoming.viewOnly) {
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...old,
          viewOnly: true,
          viewOnlyCapturedAt: nextViewOnlyCapturedAt,
          receivedAt
        }];
      }
      continue;
    }
    // If incoming inventory scan is older than stored scan, preserve stored stock/observedAt/capturedAt,
    // but still enforce/refresh a viewOnly=true restriction and its timestamp.
    if (incoming.observedAt && old?.observedAt && incoming.observedAt < old.observedAt) {
      if (incoming.viewOnly) {
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...old,
          viewOnly: true,
          viewOnlyCapturedAt: nextViewOnlyCapturedAt,
          receivedAt
        }];
      }
      continue;
    }
    // Metadata-only native upload (incomplete, undated, no items): tighten viewOnly without advancing capturedAt
    // so it cannot block an earlier complete stock scan captured before the metadata update.
    if (!incoming.complete && !incoming.observedAt && !(incoming.items ?? []).length) {
      if (old) {
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...old,
          viewOnly: Boolean(old.viewOnly || incoming.viewOnly),
          viewOnlyCapturedAt: nextViewOnlyCapturedAt,
          receivedAt
        }];
      } else {
        state.banks = [...state.banks.filter(b => !sameBank(b)), {
          ...incoming,
          complete: false,
          observedAt: null,
          viewOnly: Boolean(incoming.viewOnly),
          viewOnlyCapturedAt: nextViewOnlyCapturedAt,
          sourceKind: incoming.sourceKind ?? 'native',
          items: [],
          receivedAt,
          capturedAt: null,
          stockChangedAt: null
        }];
      }
      continue;
    }
    // If a partial capture arrives for a bank with a confirmed complete scan, or an undated non-UB capture
    // arrives for a bank with a dated scan, never overwrite confirmed stock or advance observedAt/capturedAt;
    // still enforce a stricter viewOnly restriction.
    if ((old?.complete && !incoming.complete) || (old?.observedAt && !incoming.observedAt)) {
      state.banks = [...state.banks.filter(b => !sameBank(b)), {
        ...old,
        viewOnly: Boolean(old.viewOnly || incoming.viewOnly),
        viewOnlyCapturedAt: nextViewOnlyCapturedAt,
        receivedAt
      }];
      continue;
    }
    const effectiveComplete = Boolean(incoming.complete && (incoming.observedAt || !old?.observedAt));
    const items = effectiveComplete
      ? incoming.items
      : [...(old?.items ?? []).filter(i => !incoming.items.some(n => itemKey(n) === itemKey(i))), ...incoming.items];
    // Only record observedAt on confirmed complete scans so partial captures never advance confirmed scan timestamps.
    const effectiveObservedAt = effectiveComplete ? (incoming.observedAt ?? null) : (old?.observedAt ?? null);
    const effectiveViewOnly = incoming.viewOnly
      ? true
      : (effectiveComplete && canClearViewOnly ? false : Boolean(old?.viewOnly));
    state.banks = [...state.banks.filter(b => !sameBank(b)), {
      ...incoming,
      complete: effectiveComplete,
      observedAt: effectiveObservedAt,
      viewOnly: effectiveViewOnly,
      viewOnlyCapturedAt: nextViewOnlyCapturedAt,
      sourceKind: incoming.sourceKind ?? old?.sourceKind ?? 'native',
      sourceVersion: incoming.sourceVersion ?? old?.sourceVersion ?? null,
      items,
      receivedAt,
      // Only advance capturedAt on confirmed complete native scans so partial native scans never block complete scans.
      capturedAt: effectiveComplete ? snapshot.capturedAt : (old?.capturedAt ?? null),
      stockChangedAt: old?.stockChangedAt ?? null
    }];
  }
  if (snapshot.guildMeta && (!state.guildMetaCapturedAt || snapshot.capturedAt >= state.guildMetaCapturedAt)) {
    if (typeof snapshot.guildMeta.motd === 'string') {
      const text = snapshot.guildMeta.motd.trim();
      state.motd = text ? {text,updatedAt:receivedAt,updatedBy:snapshot.source.character.name} : null;
    }
    if (typeof snapshot.guildMeta.infoText === 'string') {
      const text = snapshot.guildMeta.infoText.trim();
      state.guildInfo = text ? {text,updatedAt:receivedAt,updatedBy:snapshot.source.character.name} : null;
    }
    state.guildMetaCapturedAt = snapshot.capturedAt;
  }
  state.syncs = [{id:`${accountId}:${snapshot.snapshotId}`, accountId, status:'success', capturedAt:new Date(snapshot.capturedAt * 1000).toISOString(), receivedAt, summary:`${snapshot.characters.length} characters, ${snapshot.banks?.length ?? 0} banks`}, ...state.syncs].slice(0, 100);
  return state;
}
export function visibleBank(state, accountId) {
  const grouped = new Map();
  const designatedNames = Array.isArray(state.designatedBanks)
    ? new Set(state.designatedBanks.map(b => normalize(b.name)))
    : null;
  for (const source of state.banks) {
    if (designatedNames && !designatedNames.has(normalize(source.name))) continue;
    for (const item of source.items) {
      const key = itemKey(item);
      const row = grouped.get(key) ?? {...item, itemKey:key, name:item.name ?? `Item ${item.itemId}`, count:0, favorite:(state.favorites[accountId] ?? []).includes(key), banks:[]};
      row.count += item.count;
      row.banks.push({name:source.name, realm:source.realm, count:item.count, viewOnly:source.viewOnly, observedAt:source.observedAt ? new Date(source.observedAt * 1000).toISOString() : null, receivedAt:source.receivedAt, complete:source.complete});
      grouped.set(key,row);
    }
  }
  return [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name));
}
