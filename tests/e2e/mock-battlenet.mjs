import http from 'node:http';

export function createMockBattleNetServer() {
  let currentPersona = 'gm';

  const PERSONAS = {
    gm: {
      sub: '900101',
      battletag: 'E2EGM#1001',
      characters: [
        {
          id: 9101,
          name: 'Grommash',
          surname: 'Leader',
          slug: 'grommash-leader',
          level: 60,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Warrior' },
          playable_race: { name: 'Orc' },
          faction: { type: 'HORDE', name: 'Horde' },
          guild: { id: 9901, name: 'E2E Test Guild', slug: 'e2e-test-guild', rank: 0 },
          professions: {
            primaries: [
              { profession: { id: 171, name: 'Alchemy' }, tiers: [{ skill_points: 300, max_skill_points: 300, known_recipes: [{ id: 11477, name: 'Elixir of Mongoose' }] }] },
              { profession: { id: 182, name: 'Herbalism' }, tiers: [{ skill_points: 202, max_skill_points: 225, known_recipes: [] }] },
            ],
            secondaries: [
              { profession: { id: 185, name: 'Cooking' }, tiers: [{ skill_points: 296, max_skill_points: 300, known_recipes: [] }] },
            ],
          },
        },
        {
          id: 9102,
          name: 'Grommash',
          surname: 'Bank',
          slug: 'grommash-bank',
          level: 12,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Rogue' },
          playable_race: { name: 'Orc' },
          faction: { type: 'HORDE', name: 'Horde' },
          guild: { id: 9901, name: 'E2E Test Guild', slug: 'e2e-test-guild', rank: 2 },
          professions: { primaries: [], secondaries: [] },
        },
      ],
    },
    member: {
      sub: '900102',
      battletag: 'E2EMember#1002',
      characters: [
        {
          id: 9201,
          name: 'Lyra',
          surname: 'Crafter',
          slug: 'lyra-crafter',
          level: 45,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Mage' },
          playable_race: { name: 'Undead' },
          faction: { type: 'HORDE', name: 'Horde' },
          guild: { id: 9901, name: 'E2E Test Guild', slug: 'e2e-test-guild', rank: 2 },
          professions: {
            primaries: [
              { profession: { id: 197, name: 'Tailoring' }, tiers: [{ skill_points: 240, max_skill_points: 300, known_recipes: [{ id: 12078, name: 'Mageweave Bag' }] }] },
              { profession: { id: 333, name: 'Enchanting' }, tiers: [{ skill_points: 160, max_skill_points: 225, known_recipes: [] }] },
            ],
            secondaries: [],
          },
        },
        {
          id: 9202,
          name: 'Lyra',
          surname: 'Alt',
          slug: 'lyra-alt',
          level: 18,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Hunter' },
          playable_race: { name: 'Troll' },
          faction: { type: 'HORDE', name: 'Horde' },
          guild: { id: 9901, name: 'E2E Test Guild', slug: 'e2e-test-guild', rank: 2 },
          professions: { primaries: [], secondaries: [] },
        },
      ],
    },
    outsider: {
      sub: '900103',
      battletag: 'E2EOutsider#1003',
      characters: [
        {
          id: 9301,
          name: 'Wandering',
          surname: 'Stranger',
          slug: 'wandering-stranger',
          level: 30,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Paladin' },
          playable_race: { name: 'Human' },
          faction: { type: 'ALLIANCE', name: 'Alliance' },
          guild: { id: 9999, name: 'Other Guild', slug: 'other-guild', rank: 0 },
          professions: { primaries: [], secondaries: [] },
        },
        {
          id: 9302,
          name: 'Tiny',
          surname: 'Newbie',
          slug: 'tiny-newbie',
          level: 5,
          ruleset: { name: 'Roleplay PvP', slug: 'rp-pvp' },
          playable_class: { name: 'Priest' },
          playable_race: { name: 'Human' },
          faction: { type: 'ALLIANCE', name: 'Alliance' },
          guild: { id: 9999, name: 'Other Guild', slug: 'other-guild', rank: 2 },
          professions: { primaries: [], secondaries: [] },
        },
      ],
    },
  };

  const ITEMS = {
    4338: { id: 4338, name: 'Mageweave Cloth', sell_price: 250, quality: { name: 'Common' }, item_class: { name: 'Trade Goods' }, item_subclass: { name: 'Cloth' }, inventory_type: { name: 'Non-equippable' }, level: 40, required_level: 0 },
    13446: { id: 13446, name: 'Major Healing Potion', sell_price: 500, quality: { name: 'Common' }, item_class: { name: 'Consumable' }, item_subclass: { name: 'Potion' }, inventory_type: { name: 'Non-equippable' }, level: 55, required_level: 45 },
  };

  const allChars = Object.values(PERSONAS).flatMap(p => p.characters);
  const guildRosterMembers = [
    ...PERSONAS.gm.characters,
    ...PERSONAS.member.characters,
  ].map(c => ({
    rank: c.guild.rank,
    character: {
      id: c.id,
      name: c.name,
      surname: c.surname,
      slug: c.slug,
      level: c.level,
      ruleset: c.ruleset,
      playable_class: c.playable_class,
      playable_race: c.playable_race,
      faction: c.faction,
    },
  }));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const code = `mock-code-${currentPersona}`;
      const dest = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`;
      res.writeHead(302, { Location: dest });
      res.end();
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const code = body.get('code') || '';
        const persona = code.startsWith('mock-code-') ? code.slice('mock-code-'.length) : 'client';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: `mock-token-${persona}`, token_type: 'bearer', expires_in: 3600 }));
      });
      return;
    }

    const auth = req.headers.authorization || '';
    const tokenPersona = auth.startsWith('Bearer mock-token-') ? auth.slice('Bearer mock-token-'.length) : currentPersona;
    const persona = PERSONAS[tokenPersona] || PERSONAS.gm;

    if (url.pathname === '/userinfo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sub: persona.sub, battletag: persona.battletag }));
      return;
    }

    if (url.pathname === '/profile/user/wow') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wow_accounts: [{ id: 1, characters: persona.characters }] }));
      return;
    }

    const charProfMatch = url.pathname.match(/^\/profile\/wow\/character\/(?:[^/]+\/)?([^/]+)\/professions$/);
    if (charProfMatch) {
      const slug = decodeURIComponent(charProfMatch[1]);
      const found = allChars.find(c => c.slug === slug);
      res.writeHead(found ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(found ? { character: { id: found.id, name: found.name }, ...found.professions } : {}));
      return;
    }

    const charMatch = url.pathname.match(/^\/profile\/wow\/character\/(?:[^/]+\/)?([^/]+)$/);
    if (charMatch) {
      const slug = decodeURIComponent(charMatch[1]);
      const found = allChars.find(c => c.slug === slug);
      if (!found) { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: found.id,
        name: found.name,
        surname: found.surname,
        slug: found.slug,
        level: found.level,
        ruleset: found.ruleset,
        guild: found.guild,
        character_class: found.playable_class,
        race: found.playable_race,
        faction: found.faction,
        equipped_item_level: 50,
        average_item_level: 48,
        last_login_timestamp: Date.now() - 3600_000,
      }));
      return;
    }

    const rosterMatch = url.pathname.match(/^\/data\/wow\/guild\/(?:[^/]+\/)?([^/]+)\/roster$/);
    if (rosterMatch) {
      const slug = decodeURIComponent(rosterMatch[1]);
      if (slug === 'e2e-test-guild') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ guild: { id: 9901, name: 'E2E Test Guild' }, members: guildRosterMembers }));
        return;
      }
      if (slug === 'other-guild') {
        const otherMembers = PERSONAS.outsider.characters.map(c => ({
          rank: c.guild.rank,
          character: {
            id: c.id, name: c.name, surname: c.surname, slug: c.slug, level: c.level,
            ruleset: c.ruleset, playable_class: c.playable_class, playable_race: c.playable_race, faction: c.faction,
          },
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ guild: { id: 9999, name: 'Other Guild' }, members: otherMembers }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
      return;
    }

    const itemMatch = url.pathname.match(/^\/data\/wow\/item\/(\d+)$/);
    if (itemMatch) {
      const item = ITEMS[Number(itemMatch[1])];
      res.writeHead(item ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item || {}));
      return;
    }

    res.writeHead(404);
    res.end('{}');
  });

  return {
    async start() {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      return `http://127.0.0.1:${addr.port}`;
    },
    setPersona(name) { currentPersona = name; },
    async stop() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}
