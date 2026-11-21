export function validateFixtureConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Use a fixture configuration object.');
  if (Object.keys(config).some(k => !['realm','guildName','region','ownerCharacter','memberCharacter','ownerAlts','memberAlts','bankCharacters'].includes(k))) throw new Error('Unsupported fixture configuration field.');
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 120 && name === name.trim() && !/[\x00-\x1f]/.test(name);
  for (const key of ['realm','guildName','ownerCharacter','memberCharacter']) if (config[key] !== undefined && !validName(config[key])) throw new Error(`Invalid ${key}.`);
  if (config.region !== undefined && !['us','eu','kr','tw'].includes(config.region)) throw new Error('Invalid region.');
  for (const [key,maximum] of [['ownerAlts',20],['memberAlts',20],['bankCharacters',100]]) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].length > maximum || config[key].some(n => !validName(n)))) throw new Error(`Invalid ${key}.`);
  }
  const names = [config.ownerCharacter ?? 'Test Owner',config.memberCharacter ?? 'Test Member',...(config.ownerAlts ?? []),...(config.memberAlts ?? []),...(config.bankCharacters ?? ['Test Bank'])].map(n => n.toLocaleLowerCase('en-US'));
  if (new Set(names).size !== names.length) throw new Error('Use distinct character names across fixture accounts and banks.');
  return config;
}
export function fixtureState(config = {}, now = new Date().toISOString()) {
  validateFixtureConfig(config);
  const realm = config.realm ?? 'Test Realm';
  const character = (id, name, accountId, rank) => ({id,name,realm,accountId,level:30,className:'Mage',guildRank:rank,isMain:true,verified:true,active:true,titles:[],professions:[{id:171,name:'Alchemy',rank:150,maxRank:225,updatedAt:now,recipes:[{id:2330,name:'Minor Healing Potion',itemId:118,kind:'item',offered:false}]}]});
  const characters = [character('fixture-owner-character',config.ownerCharacter ?? 'Test Owner','fixture-owner','Guild Master'),character('fixture-member-character',config.memberCharacter ?? 'Test Member','fixture-member','Member')];
  for (const role of ['owner','member']) for (const [index,name] of (config[`${role}Alts`] ?? []).entries()) {
    characters.push({...character(`fixture-${role}-alt-${index+1}`,name,`fixture-${role}`,'Member'),isMain:false});
  }
  const designatedBanks = (config.bankCharacters ?? ['Test Bank']).map(name => ({name,realm}));
  return {
    characters, designatedBanks, roster:characters.map(({accountId,professions,...c})=>c), requests:[],favorites:{},syncs:[],
    banks:designatedBanks.map(b => ({...b, guildName:config.guildName ?? 'Band of the Helping Hand',viewOnly:false,complete:true,observedAt:null,receivedAt:now,items:[{itemId:118,suffixId:0,enchantId:0,count:20,name:'Minor Healing Potion',quality:1}]}))
  };
}
export async function seedFixtures(db, config = {}) {
  const state = fixtureState(config);
  await db.query(`INSERT INTO guilds(id,name,realm,region,state) VALUES('fixture-guild',$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,realm=excluded.realm,region=excluded.region,state=excluded.state`, [config.guildName ?? 'Band of the Helping Hand',config.realm ?? 'Test Realm',config.region ?? 'us',state]);
  for (const role of ['owner','member']) {
    await db.query(`INSERT INTO accounts(id,battle_tag,test_account) VALUES($1,$2,true) ON CONFLICT(id) DO UPDATE SET battle_tag=excluded.battle_tag,test_account=true`, [`fixture-${role}`,`Test ${role === 'owner' ? 'Owner' : 'Member'} (fixture)`]);
    await db.query(`INSERT INTO memberships(account_id,guild_id,role,active) VALUES($1,'fixture-guild',$2,true) ON CONFLICT(account_id,guild_id) DO UPDATE SET role=excluded.role,active=true`, [`fixture-${role}`,role]);
  }
}
