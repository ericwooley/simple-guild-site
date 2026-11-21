import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeSnapshot, mergeSnapshot, validateSnapshot, visibleBank } from '../src/server/domain.mjs';
import { fixtureState } from '../src/server/fixtures.mjs';
const now = Date.now();
function snapshot(extra = {}) { return {schemaVersion:1,snapshotId:'capture-1',capturedAt:Math.floor(now/1000),source:{addonVersion:'0.1.0',character:{name:'Test Owner',realm:'Test Realm'},guild:{name:'Band of the Helping Hand',realm:'Test Realm',region:'us'}},characters:[{name:'Test Owner',realm:'Test Realm'}],...extra}; }
const guild = {name:'Band of the Helping Hand',realm:'Test Realm',region:'us'};
test('snapshot validation rejects private data, invalid counts, duplicates, and unsupported versions',()=>{
  assert.equal(validateSnapshot(snapshot(),now).schemaVersion,1);
  for (const modified of [snapshot({hidden:[]}),snapshot({schemaVersion:2}),snapshot({characters:[{name:'Test Owner',realm:'Test Realm',token:'secret'}]})]) assert.throws(()=>validateSnapshot(modified,now));
  const bank = {name:'Test Bank',realm:'Test Realm',guildName:guild.name,viewOnly:false,complete:true,observedAt:null,items:[{itemId:118,count:-1}]};
  assert.throws(()=>validateSnapshot(snapshot({banks:[bank]}),now));
  bank.items = [{itemId:118,count:1},{itemId:118,count:2}]; assert.throws(()=>validateSnapshot(snapshot({banks:[bank]}),now));
  bank.items = [{itemId:118,count:1,suffixId:-42}]; assert.doesNotThrow(()=>validateSnapshot(snapshot({banks:[bank]}),now));
});
test('member uploads require verified account characters and cannot contain guild data',()=>{
  const state = fixtureState();
  assert.throws(()=>authorizeSnapshot(snapshot(),{id:'fixture-member'},guild,state,'member'));
  assert.doesNotThrow(()=>authorizeSnapshot(snapshot(),{id:'fixture-owner'},guild,state,'member'));
  assert.throws(()=>authorizeSnapshot(snapshot({banks:[]}),{id:'fixture-owner'},guild,state,'member'));
  assert.throws(()=>authorizeSnapshot(snapshot({banks:[{name:'Sister Bank',realm:'Test Realm',guildName:guild.name}]}),{id:'fixture-owner'},guild,state,'guild'));
  const changed = snapshot(); changed.source.guild.name = 'Another Guild'; assert.throws(()=>authorizeSnapshot(changed,{id:'fixture-owner'},guild,state,'guild'));
});
test('partial bank snapshots preserve missing items while complete snapshots remove absent visible stock',()=>{
  const state = fixtureState();
  const bank = {...state.banks[0],items:[],complete:false}; delete bank.receivedAt;
  const partial = mergeSnapshot(state,snapshot({banks:[bank]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(partial.banks[0].items.length,1);
  bank.complete = true;
  const complete = mergeSnapshot(partial,snapshot({banks:[bank]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(complete.banks[0].items.length,0);
  assert.equal(complete.banks[0].observedAt,null);
});
test('unknown recipes preserve confirmed recipes and refreshed recipes preserve manual offers',()=>{
  const state = fixtureState(); state.characters[0].professions[0].recipes[0].offered = true;
  const char = {name:'Test Owner',realm:'Test Realm',professions:[{id:171,name:'Alchemy',rank:155,maxRank:225}]};
  const next = mergeSnapshot(state,snapshot({characters:[char]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(next.characters[0].professions[0].recipes[0].offered,true);
  char.professions[0].recipes = [{id:2330,name:'Updated Potion',itemId:118,kind:'item'}];
  const refreshed = mergeSnapshot(next,snapshot({characters:[char]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(refreshed.characters[0].professions[0].recipes[0].offered,true);
  assert.equal(state.characters[0].professions[0].rank,150);
});
test('item totals preserve signed suffix identity and personal favorites',()=>{
  const state = fixtureState(); state.banks[0].items.push({itemId:118,count:2,suffixId:-42,enchantId:0}); state.favorites['fixture-member'] = ['118:-42:0'];
  const rows = visibleBank(state,'fixture-member');
  assert.equal(rows.length,2); assert.equal(rows.find(r=>r.suffixId === -42).favorite,true);
  assert.equal(visibleBank(state,'fixture-owner').every(r=>!r.favorite),true);
});
test('older bank snapshots cannot replace newer captures',()=>{
  const state = fixtureState(); state.banks[0].capturedAt = Math.floor(now/1000)+20;
  const bank = {...state.banks[0],items:[],complete:true};
  const next = mergeSnapshot(state,snapshot({banks:[bank]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(next.banks[0].items[0].count,20);
});
test('roster refresh creates stable title targets and preserves titles without granting ownership',()=>{
  const state = fixtureState();
  const capture = snapshot({roster:{complete:true,members:[{name:'New Crafter',realm:'Test Realm',level:35,className:'Mage',rankName:'Member',rankIndex:5}]}});
  const first = mergeSnapshot(state,capture,new Date(now).toISOString(),'fixture-owner');
  const crafter = first.characters.find(c=>c.name === 'New Crafter');
  assert.ok(crafter?.id);
  assert.equal(crafter.verified,false);
  assert.equal(crafter.accountId,null);
  crafter.titles = ['Guild Alchemist','Guild Enchanter'];
  const second = mergeSnapshot(first,capture,new Date(now).toISOString(),'fixture-owner');
  const refreshed = second.characters.find(c=>c.name === 'New Crafter');
  assert.equal(refreshed.id,crafter.id);
  assert.deepEqual(refreshed.titles,['Guild Alchemist','Guild Enchanter']);
  assert.equal(second.roster[0].id,crafter.id);
});
test('guild tokens update current roster directory recipes without claiming character ownership',()=>{
  const state = fixtureState();
  state.characters.push({id:'unlinked',name:'New Crafter',realm:'Test Realm',accountId:null,verified:false,active:true,titles:[],professions:[]});
  state.roster.push({name:'New Crafter',realm:'Test Realm'});
  const capture = snapshot({characters:[{name:'New Crafter',realm:'Test Realm',professions:[{id:171,name:'Alchemy',rank:150,maxRank:225}]}]});
  assert.doesNotThrow(()=>authorizeSnapshot(capture,{id:'fixture-owner'},guild,state,'guild'));
  const changed = structuredClone(capture); changed.source.character.name = 'Test Member';
  assert.throws(()=>authorizeSnapshot(changed,{id:'fixture-owner'},guild,state,'guild'));
  const outsider = structuredClone(capture); outsider.characters[0].name = 'Outsider';
  assert.throws(()=>authorizeSnapshot(outsider,{id:'fixture-owner'},guild,state,'guild'));
  assert.throws(()=>authorizeSnapshot(capture,{id:'fixture-owner'},guild,state,'member'));
  const merged = mergeSnapshot(state,capture,new Date(now).toISOString(),'fixture-owner');
  assert.equal(merged.characters.find(c=>c.id === 'unlinked').verified,false);
  assert.equal(merged.characters.find(c=>c.id === 'unlinked').accountId,null);
});
test('offer preferences survive a recipe disappearing and later returning',()=>{
  const state = fixtureState(); state.characters[0].professions[0].recipes[0].offered = true;
  const char = {name:'Test Owner',realm:'Test Realm',professions:[{id:171,name:'Alchemy',rank:150,maxRank:225,recipes:[]}]};
  const absent = mergeSnapshot(state,snapshot({characters:[char]}),new Date(now).toISOString(),'fixture-owner');
  char.professions[0].recipes = [{id:2330,name:'Minor Healing Potion',itemId:118,kind:'item'}];
  const returned = mergeSnapshot(absent,snapshot({characters:[char]}),new Date(now).toISOString(),'fixture-owner');
  assert.equal(returned.characters[0].professions[0].recipes[0].offered,true);
});
test('fixture configuration rejects duplicate character identities across accounts and banks',()=>{
  assert.throws(()=>fixtureState({ownerCharacter:'Test Member'}));
  assert.throws(()=>fixtureState({bankCharacters:['TEST MEMBER']}));
  assert.throws(()=>fixtureState({memberAlts:['Test Member']}));
  assert.throws(()=>fixtureState({ownerAlts:['Same Name'],memberAlts:['same name']}));
});
test('fixture alts remain verified local account characters with one initial main',()=>{
  const state = fixtureState({ownerAlts:['Owner Alt'],memberAlts:['Member Alt']});
  assert.equal(state.characters.length,4);
  const member = state.characters.filter(c=>c.accountId === 'fixture-member');
  assert.equal(member.length,2);
  assert.equal(member.filter(c=>c.isMain).length,1);
  assert.ok(member.every(c=>c.verified));
  assert.equal(member.find(c=>c.name === 'Member Alt').id,'fixture-member-alt-1');
  for (const config of [{memberAlts:Array(21).fill('Name')},{ownerAlts:[null]},{memberAlts:['Bad\nName']},{bankCharacters:[' ']},{realm:''},null]) assert.throws(()=>fixtureState(config));
});
