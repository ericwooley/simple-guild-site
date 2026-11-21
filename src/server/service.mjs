import { randomUUID } from 'node:crypto';
import { getPool, transaction } from './db.mjs';
import { cookies, createSession, getIdentity, hash, localMode, requireOrigin, secureTransport, sessionCookie, signSyncToken, verifySyncToken } from './auth.mjs';
import { authorizeSnapshot, characterKey, InputError, mergeSnapshot, validateSnapshot, visibleBank } from './domain.mjs';
const empty = () => ({account:null,guild:null,characters:[],roster:[],bank:[],requests:[],professions:[],tokens:[],syncs:[]});
export function battleNetConfigured() { return Boolean(process.env.BNET_CLIENT_ID && process.env.BNET_CLIENT_SECRET && process.env.BNET_REDIRECT_URI); }
export async function getPortalData(request) {
  const output = {...empty(),localTestLogin:localMode(request),battleNetConfigured:battleNetConfigured()};
  const identity = await getIdentity(request);
  if (!identity) return output;
  output.account = {id:identity.id,battleTag:identity.battleTag,role:identity.role ?? null,testAccount:identity.testAccount};
  if (!identity.guildId) return output;
  const result = await getPool().query('SELECT * FROM guilds WHERE id=$1',[identity.guildId]);
  const guild = result.rows[0]; if (!guild) return output;
  const state = guild.state;
  output.guild = {id:guild.id,name:guild.name};
  const safeCharacter = c => ({id:c.id,name:c.name,realm:c.realm,level:c.level ?? null,className:c.className ?? null,guildRank:c.guildRank ?? null,isMain:Boolean(c.isMain),verified:Boolean(c.verified),titles:c.titles ?? [],updatedAt:c.updatedAt ?? null});
  output.characters = state.characters.filter(c => c.accountId === identity.id && c.active !== false).map(safeCharacter);
  output.roster = state.roster.map(c => ({...safeCharacter(c),titles:state.characters.find(ch => characterKey(ch) === characterKey(c))?.titles ?? []}));
  output.bank = visibleBank(state,identity.id);
  output.requests = state.requests.filter(r => identity.role === 'owner' || r.accountId === identity.id).map(({accountId,...r})=>r);
  output.professions = state.characters.filter(c => c.active !== false).flatMap(char => (char.professions ?? []).map(prof => ({characterId:char.id,characterName:char.name,name:prof.name,rank:prof.rank,maxRank:prof.maxRank,titles:char.titles ?? [],updatedAt:prof.updatedAt ?? null,recipes:(prof.recipes ?? []).map(recipe => ({...recipe,recipeKey:`${char.id}:${prof.id}:${recipe.id}`,canEdit:char.accountId === identity.id}))})));
  output.tokens = (await getPool().query(`SELECT id,scope,created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt" FROM sync_tokens WHERE account_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 100`,[identity.id,guild.id])).rows.map(r => Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?v.toISOString():v])));
  output.syncs = state.syncs.filter(s => identity.role === 'owner' || s.accountId === identity.id).map(({accountId,...s})=>s);
  return output;
}
export async function readJson(request, limit) {
  const reader = request.body?.getReader(); if (!reader) throw new InputError('Provide a JSON request.');
  const chunks = []; let total = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    total += value.byteLength; if (total > limit) { await reader.cancel(); throw new InputError('The upload exceeds the size limit.',413); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('The request contains invalid JSON.'); }
}
function need(condition,message,status=403) { if (!condition) throw new InputError(message,status); }
export async function handleAction(request, address) {
  requireOrigin(request);
  const body = await readJson(request,16384);
  need(body && typeof body === 'object' && typeof body.action === 'string','Choose an action.',400);
  if (body.action === 'local-login') {
    need(address !== undefined && localMode(request,address),'Local test login requires a loopback development connection.');
    need(['owner','member'].includes(body.persona),'Choose a test account.',400);
    return transaction(async db => {
      const accountId = `fixture-${body.persona}`;
      need((await db.query('SELECT 1 FROM accounts WHERE id=$1 AND test_account=true',[accountId])).rowCount,'Seed the local test accounts before signing in.',409);
      const old = cookies(request).hh_session;
      if (old) await db.query('DELETE FROM sessions WHERE id_hash=$1',[hash(old)]);
      const id = await createSession(db,accountId);
      return {ok:true,message:'Signed in to the local test account.',redirect:'/account',cookie:sessionCookie(id,request)};
    });
  }
  return transaction(async db => {
    const account = await getIdentity(request,db);
    need(account,'Sign in before using this action.',401);
    if (body.action === 'logout') {
      await db.query('DELETE FROM sessions WHERE id_hash=$1',[hash(cookies(request).hh_session)]);
      return {ok:true,message:'Signed out.',redirect:'/',cookie:sessionCookie('',request,0)};
    }
    need(account.guildId,'Verify guild membership before using this action.');
    const member = (await db.query('SELECT role FROM memberships WHERE account_id=$1 AND guild_id=$2 AND active=true FOR SHARE',[account.id,account.guildId])).rows[0];
    need(member,'Your guild access has ended.'); account.role = member.role;
    const guild = (await db.query('SELECT * FROM guilds WHERE id=$1 FOR UPDATE',[account.guildId])).rows[0];
    const state = guild.state;
    const owner = () => need(account.role === 'owner','The guild owner must perform this action.');
    const ownCharacter = id => state.characters.find(c => c.id === id && c.accountId === account.id && c.verified && c.active !== false);
    if (body.action === 'issue-token') {
      need(['member','guild'].includes(body.scope),'Choose a token scope.',400); if (body.scope === 'guild') owner();
      need(state.characters.some(c => c.accountId === account.id && c.verified && c.active !== false),'Verify a character before creating a sync token.');
      const count = await db.query('SELECT count(*) FROM sync_tokens WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>now()',[account.id]);
      need(Number(count.rows[0].count) < 20,'Revoke an unused token before creating another.',409);
      const id = randomUUID(); const now = new Date(); const exp = new Date(now.getTime()+30*86400000);
      const token = signSyncToken({iss:'helping-hand',aud:'helping-hand-sync',sub:account.id,jti:id,guild:guild.id,scope:body.scope,iat:Math.floor(now.getTime()/1000),exp:Math.floor(exp.getTime()/1000)});
      await db.query('INSERT INTO sync_tokens(id,account_id,guild_id,scope,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,account.id,guild.id,body.scope,now,exp]);
      return {ok:true,message:'Copy this token now. This page will not show it again.',token};
    }
    if (body.action === 'revoke-token') {
      need(typeof body.id === 'string','Choose a token.',400);
      const result = await db.query('UPDATE sync_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND account_id=$2 AND guild_id=$3',[body.id,account.id,guild.id]);
      need(result.rowCount,'The token is unavailable.',404); return {ok:true,message:'Token revoked.'};
    }
    const bank = visibleBank(state,account.id);
    if (body.action === 'favorite') {
      need(bank.some(i => i.itemKey === body.itemKey),'The item is unavailable.',404);
      const saved = state.favorites[account.id] ?? [];
      state.favorites[account.id] = saved.includes(body.itemKey) ? saved.filter(k => k !== body.itemKey) : [...saved,body.itemKey];
    } else if (body.action === 'request-item') {
      const item = bank.find(i => i.itemKey === body.itemKey);
      need(item,'The item is unavailable.',404);
      need(Number.isSafeInteger(body.quantity) && body.quantity > 0 && body.quantity <= item.banks.filter(b => !b.viewOnly).reduce((n,b)=>n+b.count,0),'Choose a quantity from requestable stock.',400);
      const char = ownCharacter(body.characterId); need(char,'Choose one of your verified guild characters.');
      need(state.requests.length < 10000,'The guild request limit requires an administrator.',409);
      state.requests.unshift({id:randomUUID(),accountId:account.id,itemKey:item.itemKey,itemName:item.name,quantity:body.quantity,characterName:char.name,requesterName:account.battleTag,status:'pending',createdAt:new Date().toISOString()});
    } else if (body.action === 'update-request') {
      owner(); need(['approved','declined','fulfilled'].includes(body.status),'Choose a request status.',400);
      const target = state.requests.find(r => r.id === body.id); need(target,'The request is unavailable.',404);
      const transitions = {pending:['approved','declined'],approved:['fulfilled','declined']};
      need(transitions[target.status]?.includes(body.status),'This request cannot move to that status.',409); target.status = body.status;
    } else if (body.action === 'set-main') {
      const char = ownCharacter(body.characterId); need(char,'Choose one of your verified guild characters.');
      for (const c of state.characters.filter(c => c.accountId === account.id)) c.isMain = c.id === char.id;
    } else if (body.action === 'set-offer') {
      need(typeof body.offered === 'boolean','Choose an offer status.',400);
      let found = false;
      for (const char of state.characters.filter(c=>c.accountId === account.id && c.verified && c.active !== false)) for (const prof of char.professions ?? []) for (const recipe of prof.recipes ?? []) {
        if (`${char.id}:${prof.id}:${recipe.id}` === body.recipeKey) { recipe.offered = body.offered; state.offers ??= {}; state.offers[body.recipeKey] = body.offered; found = true; }
      }
      need(found,'Choose one of your known recipes.');
    } else if (body.action === 'set-title') {
      owner(); need(typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 80 && !/[\x00-\x1f]/.test(body.title) && typeof body.assigned === 'boolean','Enter a guild profession title.',400);
      const char = state.characters.find(c => c.id === body.characterId && c.active !== false); need(char,'The character is unavailable.',404);
      char.titles ??= []; const title = body.title.trim();
      if (body.assigned) { need(char.titles.length < 30,'The character has too many titles.',400); if (!char.titles.includes(title)) char.titles.push(title); }
      else char.titles = char.titles.filter(t=>t !== title);
    } else throw new InputError('Unknown action.');
    await db.query('UPDATE guilds SET state=$1 WHERE id=$2',[state,guild.id]);
    return {ok:true,message:'Saved.'};
  });
}
export async function handleSync(request, address) {
  secureTransport(request);
  const auth = request.headers.get('authorization');
  need(auth?.startsWith('Bearer '),'Provide a sync token.',401);
  const claims = verifySyncToken(auth.slice(7));
  const value = validateSnapshot(await readJson(request,5*1024*1024));
  const digest = hash(JSON.stringify(value));
  return transaction(async db => {
    const result = await db.query(`SELECT t.*,a.test_account,m.role FROM sync_tokens t JOIN accounts a ON a.id=t.account_id JOIN memberships m ON m.account_id=t.account_id AND m.guild_id=t.guild_id WHERE t.id=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND m.active=true FOR SHARE OF t,m`,[claims.jti]);
    const token = result.rows[0];
    need(token && token.account_id === claims.sub && token.guild_id === claims.guild && token.scope === claims.scope,'The sync token no longer has access.',401);
    need(!token.test_account || (address !== undefined && localMode(request,address)),'Local fixture tokens require a loopback development connection.');
    need(claims.scope !== 'guild' || token.role === 'owner','The account no longer has guild-owner permission.');
    const guild = (await db.query('SELECT * FROM guilds WHERE id=$1 FOR UPDATE',[claims.guild])).rows[0];
    authorizeSnapshot(value,{id:claims.sub},guild,guild.state,claims.scope);
    const existing = (await db.query('SELECT digest FROM sync_uploads WHERE account_id=$1 AND snapshot_id=$2',[claims.sub,value.snapshotId])).rows[0];
    if (existing) { need(existing.digest === digest,'This snapshot ID already contains different data.',409); return {ok:true,message:'This snapshot already synced.',duplicate:true}; }
    const now = new Date().toISOString();
    const merged = mergeSnapshot(guild.state,value,now,claims.sub);
    await db.query('UPDATE guilds SET state=$1 WHERE id=$2',[merged,guild.id]);
    await db.query('INSERT INTO sync_uploads(account_id,snapshot_id,digest) VALUES($1,$2,$3)',[claims.sub,value.snapshotId,digest]);
    await db.query('UPDATE sync_tokens SET last_used_at=$1 WHERE id=$2',[now,claims.jti]);
    return {ok:true,message:'Snapshot synced.'};
  });
}
export function jsonResponse(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store',...extra}});
}
export function errorResponse(error) {
  if (error instanceof InputError) return jsonResponse({ok:false,message:error.message},error.status);
  return jsonResponse({ok:false,message:'The server could not complete this request. Check the server setup.'},503);
}
