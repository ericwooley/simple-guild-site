import { createSession, hash, opaque, secureTransport, sessionCookie } from './auth.mjs';
import { getPool, transaction } from './db.mjs';
import { InputError } from './domain.mjs';
function configuration(request) {
  secureTransport(request);
  const {BNET_CLIENT_ID:clientId,BNET_CLIENT_SECRET:clientSecret,BNET_REDIRECT_URI:redirectUri} = process.env;
  if (!clientId || !clientSecret || !redirectUri) throw new InputError('Configure Battle.net credentials before signing in.',503);
  const redirect = new URL(redirectUri);
  if (redirect.origin !== (process.env.APP_ORIGIN || new URL(request.url).origin) || redirect.pathname !== '/auth/callback') throw new InputError('Correct the Battle.net callback address in the server setup.',503);
  return {clientId,clientSecret,redirectUri};
}
function stateCookie(value,request,seconds=600) {
  return `hh_oauth=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function beginBattleNet(request) {
  const config = configuration(request);
  const state = opaque();
  await getPool().query('DELETE FROM oauth_states WHERE expires_at<now()');
  await getPool().query('INSERT INTO oauth_states(id_hash,expires_at) VALUES($1,$2)',[hash(state),new Date(Date.now()+600000)]);
  const url = new URL('https://oauth.battle.net/authorize');
  url.search = new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid wow.profile',state}).toString();
  return new Response(null,{status:302,headers:{location:url.href,'set-cookie':stateCookie(state,request),'cache-control':'no-store'}});
}
export async function finishBattleNet(request, fetcher = fetch) {
  const config = configuration(request);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const saved = (request.headers.get('cookie') ?? '').split(';').map(v=>v.trim()).find(v=>v.startsWith('hh_oauth='))?.slice('hh_oauth='.length);
  if (!state || !saved || state !== saved || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new InputError('Battle.net login expired. Start again.',403);
  const result = await getPool().query('DELETE FROM oauth_states WHERE id_hash=$1 AND expires_at>now() RETURNING id_hash',[hash(state)]);
  if (!result.rowCount) throw new InputError('Battle.net login expired. Start again.',403);
  const code = url.searchParams.get('code');
  if (!code || code.length>2048 || url.searchParams.has('error')) throw new InputError('Battle.net did not authorize this login.',403);
  const response = await fetcher('https://oauth.battle.net/token',{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri}),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new InputError('Battle.net could not complete this login. Start again.',502);
  const token = await response.json();
  if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') throw new InputError('Battle.net returned an invalid login response.',502);
  const profileResponse = await fetcher('https://oauth.battle.net/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  if (!profileResponse.ok) throw new InputError('Battle.net could not verify this identity.',502);
  const profile = await profileResponse.json();
  const subject = profile.sub ?? profile.id;
  if (!/^\d+$/.test(String(subject)) || typeof profile.battletag !== 'string' || profile.battletag.length > 200) throw new InputError('Battle.net returned an invalid identity.',502);
  const accountId = `bnet:${subject}`;
  const session = await transaction(async db => {
    await db.query('INSERT INTO accounts(id,battle_tag,test_account) VALUES($1,$2,false) ON CONFLICT(id) DO UPDATE SET battle_tag=excluded.battle_tag',[accountId,profile.battletag]);
    // Identity login does not establish Forever character ownership or guild membership.
    return createSession(db,accountId);
  });
  const headers = new Headers({location:'/account','cache-control':'no-store'});
  headers.append('set-cookie',sessionCookie(session,request));
  headers.append('set-cookie',stateCookie('',request,0));
  return new Response(null,{status:302,headers});
}
