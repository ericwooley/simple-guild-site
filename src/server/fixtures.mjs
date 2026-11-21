export function fixtureState(config = {}, now = new Date().toISOString()) {
  const realm = config.realm ?? 'Test Realm';
  const character = (id, name, accountId, rank) => ({id,name,realm,accountId,level:30,className:'Mage',guildRank:rank,isMain:true,verified:true,active:true,titles:[],professions:[{id:171,name:'Alchemy',rank:150,maxRank:225,updatedAt:now,recipes:[{id:2330,name:'Minor Healing Potion',itemId:118,kind:'item',offered:false}]}]});
  const characters = [character('fixture-owner-character',config.ownerCharacter ?? 'Test Owner','fixture-owner','Guild Master'),character('fixture-member-character',config.memberCharacter ?? 'Test Member','fixture-member','Member')];
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
