import { readFile } from 'node:fs/promises';
import { getPool, transaction } from '../src/server/db.mjs';
import { seedFixtures, validateFixtureConfig } from '../src/server/fixtures.mjs';
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LOCAL_TEST_LOGIN !== 'true') throw new Error('Enable local test login outside production before seeding fixtures.');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Use --config PATH for a local fixture configuration.');
const config = args.length ? JSON.parse(await readFile(args[1],'utf8')) : {};
validateFixtureConfig(config);
try { await transaction(db => seedFixtures(db,config)); console.log('Local fixture accounts and guild data replaced.'); }
finally { await getPool().end(); }
