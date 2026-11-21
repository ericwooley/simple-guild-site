import { readFile } from 'node:fs/promises';
import { getPool, transaction } from '../src/server/db.mjs';
import { seedFixtures } from '../src/server/fixtures.mjs';
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_TEST_LOGIN !== 'true') throw new Error('Enable local test login outside production before seeding fixtures.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Use --config PATH for a local fixture configuration.');
const config = args.length ? JSON.parse(await readFile(args[1],'utf8')) : {};
if (Object.keys(config).some(k => !['realm','guildName','region','ownerCharacter','memberCharacter','bankCharacters'].includes(k))) throw new Error('Unsupported fixture configuration field.');
for (const key of ['realm','guildName','ownerCharacter','memberCharacter']) if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key].trim() || config[key].length > 120)) throw new Error(`Invalid ${key}.`);
if (config.region && !['us','eu','kr','tw'].includes(config.region)) throw new Error('Invalid region.');
if (config.bankCharacters && (!Array.isArray(config.bankCharacters) || config.bankCharacters.length > 100 || config.bankCharacters.some(n => typeof n !== 'string' || !n.trim() || n.length > 120))) throw new Error('Invalid bank characters.');
try { await transaction(db => seedFixtures(db,config)); console.log('Local fixture accounts and guild data replaced.'); }
finally { await getPool().end(); }
