import test from 'node:test';
import assert from 'node:assert/strict';
import { localMode, requireOrigin, secureTransport, signSyncToken, verifySyncToken } from '../src/server/auth.mjs';
import { readJson } from '../src/server/service.mjs';
const secretBefore = process.env.SYNC_JWT_SECRET;
process.env.SYNC_JWT_SECRET = 'test-only-signing-secret-of-at-least-thirty-two-bytes';
const now = Date.now();
const claims = {iss:'helping-hand',aud:'helping-hand-sync',sub:'account',guild:'guild',jti:'token-id',scope:'member',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+100};
test('sync JWT checks signatures, explicit claims, scope, expiry, issuer, and audience',()=>{
  const token = signSyncToken(claims); assert.deepEqual(verifySyncToken(token,now),claims);
  assert.throws(()=>verifySyncToken(`${token.slice(0,-8)}tampered`,now));
  assert.throws(()=>verifySyncToken(token,now+101000));
  for (const changed of [{...claims,iss:'other'},{...claims,aud:'web-login'},{...claims,scope:'owner'},{...claims,exp:claims.iat+31*86400},{...claims,extra:true}]) assert.throws(()=>verifySyncToken(signSyncToken(changed),now));
});
test('local test login requires explicit development mode and loopback hosts and addresses',()=>{
  const original = {enabled:process.env.ENABLE_LOCAL_TEST_LOGIN,node:process.env.NODE_ENV};
  process.env.ENABLE_LOCAL_TEST_LOGIN = 'true'; process.env.NODE_ENV = 'development';
  assert.equal(localMode(new Request('http://localhost:4321'),'127.0.0.1'),true);
  assert.equal(localMode(new Request('http://localhost:4321'),'192.0.2.1'),false);
  assert.equal(localMode(new Request('https://example.com'),'127.0.0.1'),false);
  for (const mode of ['production','test',undefined]) {
    mode === undefined ? delete process.env.NODE_ENV : process.env.NODE_ENV = mode;
    assert.equal(localMode(new Request('http://localhost:4321'),'127.0.0.1'),false);
  }
  for (const [key,value] of [['ENABLE_LOCAL_TEST_LOGIN',original.enabled],['NODE_ENV',original.node]]) value === undefined ? delete process.env[key] : process.env[key] = value;
});
test('cookie actions reject missing or foreign origins and plaintext external access',()=>{
  const old = process.env.APP_ORIGIN; process.env.APP_ORIGIN = 'http://localhost:4321';
  assert.doesNotThrow(()=>requireOrigin(new Request('http://localhost:4321/api/actions',{headers:{origin:'http://localhost:4321'}})));
  assert.throws(()=>requireOrigin(new Request('http://localhost:4321/api/actions')));
  assert.throws(()=>requireOrigin(new Request('http://localhost:4321/api/actions',{headers:{origin:'https://evil.example'}})));
  assert.throws(()=>secureTransport(new Request('http://example.com/api/sync')));
  old === undefined ? delete process.env.APP_ORIGIN : process.env.APP_ORIGIN = old;
});
test('JSON input enforces the byte limit before parsing',async()=>{
  await assert.rejects(()=>readJson(new Request('http://localhost',{method:'POST',body:'x'.repeat(100)}),30));
  await assert.rejects(()=>readJson(new Request('http://localhost',{method:'POST',body:'invalid'}),100));
  assert.deepEqual(await readJson(new Request('http://localhost',{method:'POST',body:'{"ok":true}'}),100),{ok:true});
});
test.after(()=>{ secretBefore === undefined ? delete process.env.SYNC_JWT_SECRET : process.env.SYNC_JWT_SECRET = secretBefore; });
test('Battle.net login entry exists and reports missing credentials',async()=>{
  const original = process.env.BNET_CLIENT_ID;
  delete process.env.BNET_CLIENT_ID;
  const { beginBattleNet } = await import('../src/server/battlenet.mjs');
  await assert.rejects(()=>beginBattleNet(new Request('http://localhost:4321/auth/battlenet')),error=>error.status === 503);
  original === undefined ? delete process.env.BNET_CLIENT_ID : process.env.BNET_CLIENT_ID = original;
});
