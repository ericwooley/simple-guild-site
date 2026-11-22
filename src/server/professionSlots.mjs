const SECONDARY_ORDER = ['Cooking', 'First Aid', 'Fishing'];
const GATHERING_PROFESSIONS = new Set(['Skinning', 'Herbalism', 'Mining']);

const PROFESSION_CAPS = {
  Alchemy: 300,
  Blacksmithing: 300,
  Enchanting: 300,
  Engineering: 300,
  Herbalism: 300,
  Leatherworking: 300,
  Mining: 300,
  Skinning: 300,
  Tailoring: 300,
  Cooking: 300,
  'First Aid': 300,
  Fishing: 300,
  Poisons: 300,
  Lockpicking: 300,
  Riding: 150,
};

export const ALL_PROFESSIONS = [
  'Alchemy',
  'Blacksmithing',
  'Enchanting',
  'Engineering',
  'Herbalism',
  'Leatherworking',
  'Mining',
  'Skinning',
  'Tailoring',
  'Cooking',
  'First Aid',
  'Fishing',
];

export const DEFAULT_HIDDEN_PROFESSIONS = new Set([
  'Skinning',
  'Mining',
  'Cooking',
  'First Aid',
  'Fishing',
]);

export function professionColumnList(extraNames = []) {
  const seen = new Set(ALL_PROFESSIONS);
  const extras = (extraNames ?? [])
    .filter(name => name && !seen.has(name))
    .sort((a, b) => a.localeCompare(b));
  return [...ALL_PROFESSIONS, ...extras];
}

export function professionCap(name, maxRank = null, rank = null) {
  const base = PROFESSION_CAPS[name] ?? 300;
  return Math.max(base, Number(maxRank) || 0, Number(rank) || 0);
}

function formatPrimary(found) {
  return found
    ? { name: found.name, rank: found.rank ?? null, learned: true, cell: `${found.name} (${found.rank ?? 'N/A'})`, label: `${found.name} (${found.rank ?? 'N/A'})` }
    : { name: '', rank: null, learned: false, cell: 'N/A', label: 'N/A' };
}

export function professionSlots(professions = []) {
  const byName = new Map((professions ?? []).map(p => [p.name, p]));
  const secondaries = SECONDARY_ORDER.map(name => {
    const found = byName.get(name);
    return found
      ? { name, rank: found.rank ?? null, learned: true, cell: found.rank !== null && found.rank !== undefined ? String(found.rank) : 'N/A', label: `${name} (${found.rank ?? 'N/A'})` }
      : { name, rank: null, learned: false, cell: 'N/A', label: `${name} (N/A)` };
  });
  const byRankDesc = (a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name);
  const primaries = (professions ?? []).filter(p => !SECONDARY_ORDER.includes(p.name));
  const crafting = primaries.filter(p => !GATHERING_PROFESSIONS.has(p.name)).sort(byRankDesc);
  const gathering = primaries.filter(p => GATHERING_PROFESSIONS.has(p.name)).sort(byRankDesc);

  const ordered = crafting.length === 0 && gathering.length === 1
    ? [null, gathering[0]]
    : [...crafting, ...gathering];

  const primarySlots = [0, 1].map(index => formatPrimary(ordered[index]));
  return [...secondaries, ...primarySlots];
}
