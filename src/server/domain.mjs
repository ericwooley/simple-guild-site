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
  fields(value, ['schemaVersion','snapshotId','capturedAt','source','characters','roster','banks']);
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
          array(prof.recipes, 10000, 'recipes'); const recipes = new Set();
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
      fields(member, ['name','realm','rankName','rankIndex','level','className']); identity(member);
      assert(!members.has(characterKey(member)), 'Duplicate roster character.'); members.add(characterKey(member));
      optionalText(member.rankName, 'guild rank'); if (member.rankIndex !== undefined) integer(member.rankIndex, 'guild rank');
      if (member.level !== undefined) integer(member.level, 'level', 1, 200); optionalText(member.className, 'class');
    }
  }
  if (value.banks !== undefined) {
    array(value.banks, 100, 'banks'); const banks = new Set();
    for (const bank of value.banks) {
      fields(bank, ['name','realm','guildName','viewOnly','complete','observedAt','sourceVersion','items']); identity(bank); text(bank.guildName, 'bank guild');
      assert(!banks.has(characterKey(bank)), 'Duplicate bank.'); banks.add(characterKey(bank));
      assert(typeof bank.viewOnly === 'boolean' && typeof bank.complete === 'boolean', 'Invalid bank coverage.');
      if (bank.observedAt !== null && bank.observedAt !== undefined) integer(bank.observedAt, 'bank scan time', 1, value.capturedAt + 300);
      optionalText(bank.sourceVersion, 'source version'); array(bank.items, 20000, 'bank items'); const keys = new Set();
      for (const item of bank.items) {
        fields(item, ['itemId','suffixId','enchantId','count','name','quality']); integer(item.itemId, 'item ID', 1);
        integer(item.suffixId ?? 0, 'suffix ID', -2147483647); integer(item.enchantId ?? 0, 'enchant ID'); integer(item.count, 'item count', 1, 1000000000);
        optionalText(item.name, 'item name'); if (item.quality !== undefined) integer(item.quality, 'item quality', 0, 8);
        assert(!keys.has(itemKey(item)), 'Duplicate bank item.'); keys.add(itemKey(item));
      }
    }
  }
  return value;
}
export function authorizeSnapshot(snapshot, account, guild, state, scope) {
  assert(normalize(snapshot.source.guild.name) === normalize(guild.name) && normalize(snapshot.source.guild.realm) === normalize(guild.realm) && snapshot.source.guild.region === guild.region, 'The snapshot belongs to another guild.');
  if (scope !== 'guild') assert(snapshot.roster === undefined && snapshot.banks === undefined, 'A guild token must authorize roster and bank uploads.');
  const owned = state.characters.filter(c => c.verified && c.active !== false && c.accountId === account.id);
  const ownedKeys = new Set(owned.map(characterKey));
  assert(ownedKeys.has(characterKey(snapshot.source.character)), 'Verify the source character before syncing.');
  const rosterKeys = new Set(state.roster.map(characterKey));
  const permittedKeys = new Set(state.characters.filter(c => c.active !== false && (ownedKeys.has(characterKey(c)) || (scope === 'guild' && rosterKeys.has(characterKey(c))))).map(characterKey));
  for (const char of snapshot.characters) assert(permittedKeys.has(characterKey(char)), 'Verify each character or use a guild token for current roster data.');
  const designated = new Set((state.designatedBanks ?? []).map(characterKey));
  for (const bank of snapshot.banks ?? []) assert(designated.has(characterKey(bank)) && normalize(bank.guildName) === normalize(guild.name), 'The guild has not designated this bank character.');
}
export function mergeSnapshot(previous, snapshot, receivedAt, accountId) {
  const state = structuredClone(previous);
  state.offers ??= {};
  for (const char of state.characters) for (const prof of char.professions ?? []) for (const recipe of prof.recipes ?? []) {
    state.offers[`${char.id}:${prof.id}:${recipe.id}`] = recipe.offered ?? false;
  }
  for (const incoming of snapshot.characters) {
    const char = state.characters.find(c => characterKey(c) === characterKey(incoming));
    if (char.capturedAt && char.capturedAt > snapshot.capturedAt) continue;
    for (const field of ['level','className','guid']) if (incoming[field] !== undefined) char[field] = incoming[field];
    char.updatedAt = receivedAt; char.capturedAt = snapshot.capturedAt;
    if (incoming.professions !== undefined) {
      char.professions ??= [];
      for (const profession of incoming.professions) {
        const old = char.professions.find(p => p.id === profession.id);
        const recipes = profession.recipes === undefined ? old?.recipes : profession.recipes.map(recipe => ({ ...recipe, offered: state.offers[`${char.id}:${profession.id}:${recipe.id}`] ?? false }));
        const merged = { ...profession, recipes, updatedAt: receivedAt };
        char.professions = [...char.professions.filter(p => p.id !== profession.id), merged];
      }
    }
  }
  if (snapshot.roster && (!state.rosterCapturedAt || snapshot.capturedAt >= state.rosterCapturedAt)) {
    const rows = snapshot.roster.members.map(c => {
      let char = state.characters.find(ch => characterKey(ch) === characterKey(c));
      if (!char) {
        char = {id:`roster:${characterKey(c)}`,name:c.name,realm:c.realm,accountId:null,verified:false,active:true,isMain:false,titles:[],professions:[]};
        state.characters.push(char);
      }
      char.guildRank = c.rankName ?? char.guildRank ?? null;
      return {...c,id:char.id,verified:char.verified,updatedAt:receivedAt};
    });
    state.roster = snapshot.roster.complete ? rows : [...state.roster.filter(c => !rows.some(r => characterKey(c) === characterKey(r))), ...rows];
    state.rosterCapturedAt = snapshot.capturedAt;
    // Uploaded ranks never change account permissions or verified membership.
  }
  for (const incoming of snapshot.banks ?? []) {
    const old = state.banks.find(b => characterKey(b) === characterKey(incoming));
    if (old?.capturedAt > snapshot.capturedAt || (incoming.observedAt && old?.observedAt && incoming.observedAt < old.observedAt)) continue;
    const items = incoming.complete ? incoming.items : [...(old?.items ?? []).filter(i => !incoming.items.some(n => itemKey(n) === itemKey(i))), ...incoming.items];
    state.banks = [...state.banks.filter(b => characterKey(b) !== characterKey(incoming)), {...incoming, items, receivedAt, capturedAt:snapshot.capturedAt}];
  }
  state.syncs = [{id:snapshot.snapshotId, accountId, status:'success', capturedAt:new Date(snapshot.capturedAt * 1000).toISOString(), receivedAt, summary:`${snapshot.characters.length} characters, ${snapshot.banks?.length ?? 0} banks`}, ...state.syncs].slice(0, 100);
  return state;
}
export function visibleBank(state, accountId) {
  const grouped = new Map();
  for (const source of state.banks) for (const item of source.items) {
    const key = itemKey(item);
    const row = grouped.get(key) ?? {...item, itemKey:key, name:item.name ?? `Item ${item.itemId}`, count:0, favorite:(state.favorites[accountId] ?? []).includes(key), banks:[]};
    row.count += item.count;
    row.banks.push({name:source.name, realm:source.realm, count:item.count, viewOnly:source.viewOnly, observedAt:source.observedAt ? new Date(source.observedAt * 1000).toISOString() : null, receivedAt:source.receivedAt, complete:source.complete});
    grouped.set(key,row);
  }
  return [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name));
}
