#!/usr/bin/env node
// KillerComps draw verifier — independent, zero dependencies, Node 18+.
//
//   node verify.mjs https://killercomps.com/verify/draw/<competition>
//   node verify.mjs --lock lock.json --entries entries.json --result result.json
//
// Every check is done HERE, from the raw files, with Node's own crypto and the
// public drand network. Nothing is taken on trust from KillerComps except the
// files themselves — and their hashes are checked against each other.
//
// Paths and URLs can be mixed: take lock.json and result.json from the public
// GitHub repo, and the entry list (which has names, so it is not on GitHub)
// from the site.

import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const RELAYS = ['https://api.drand.sh', 'https://drand.cloudflare.com'];

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`${src} -> HTTP ${r.status}`);
    return await r.text();
  }
  return await readFile(src, 'utf8');
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out.page = argv[i];
  }
  return out;
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const a = args(process.argv.slice(2));

  // From a proof page: its report.json names the lock, entry list and result.
  if (a.page) {
    const page = a.page.replace(/\/+$/, '').replace(/\/report\.json$/, '');
    const report = JSON.parse(await load(page + '/report.json'));
    if (!report.lock) throw new Error('This draw did not go through a lock (drawn before locks existed), so there is no lock to verify.');
    a.lock ??= report.lock.lock_url;
    a.entries ??= report.lock.entries_url;
    a.result ??= report.lock.result_url;
  }
  if (!a.lock || !a.entries || !a.result) {
    console.error('Usage: node verify.mjs <proof page URL>\n   or: node verify.mjs --lock <file|url> --entries <file|url> --result <file|url>');
    process.exit(2);
  }

  const lockText = await load(a.lock);
  const entriesText = await load(a.entries);
  const result = JSON.parse(await load(a.result));
  const lock = JSON.parse(lockText);

  console.log(`\n${lock.title}  (competition ${lock.competition_id})`);
  console.log(`locked ${lock.locked_at}, ${lock.entry_count} entries, drand round ${lock.drand_round}\n`);

  // 1. The lock file is the one the result was drawn from.
  const lockHash = sha256(lockText);
  check('Lock file hash matches the result', lockHash === result.commitment_hash, lockHash);
  const urlHash = (String(a.lock).match(/[0-9a-f]{64}/) || [])[0];
  if (urlHash) check('Lock file hash matches its URL', lockHash === urlHash);

  // 2. The entry list is the one locked.
  const entriesHash = sha256(entriesText);
  const entries = JSON.parse(entriesText);
  check('Entry list hash matches the lock', entriesHash === lock.entries_hash, entriesHash);
  check('Entry count matches the lock', entries.length === lock.entry_count, `${entries.length}`);

  // 3. The seed revealed after the draw is the one committed before it.
  check('Server seed matches the hash committed before the draw', sha256(result.server_seed) === lock.server_seed_hash);

  // 4. The randomness is drand's, for the round named in the lock — asked of two relays.
  const chain = lock.drand_chain_hash;
  let randomness = null;
  for (const relay of RELAYS) {
    try {
      const b = await (await fetch(`${relay}/${chain}/public/${lock.drand_round}`)).json();
      check(`drand round ${lock.drand_round} from ${new URL(relay).host}`, b.randomness === result.drand_randomness);
      randomness ??= b.randomness;
    } catch (e) {
      console.log(`SKIP  ${relay} unreachable (${e.message})`);
    }
  }
  if (!randomness) check('drand reachable', false, 'no relay answered');

  // 5. The lock came before the round existed.
  try {
    const info = await (await fetch(`${RELAYS[0]}/${chain}/info`)).json();
    const roundAt = (info.genesis_time + (lock.drand_round - 1) * info.period) * 1000;
    const lockedAt = Date.parse(lock.locked_at);
    check('Lock was made before its round was published', lockedAt < roundAt,
      `locked ${new Date(lockedAt).toISOString()}, round ${new Date(roundAt).toISOString()}`);
  } catch (e) {
    console.log(`SKIP  round time (${e.message})`);
  }

  // 6. Reproduce the winner from nothing but the above.
  const hmac = createHmac('sha256', result.server_seed).update(randomness ?? result.drand_randomness, 'utf8').digest('hex');
  check('HMAC-SHA256(seed, randomness) matches', hmac === result.final_hmac);
  const index = Number(BigInt('0x' + hmac.slice(0, 15)) % BigInt(entries.length));
  check('Winning index reproduced', index === result.winner_index, `${index}`);
  check('Winning ticket is that entry on the locked list', entries[index]?.[0] === result.winning_ticket,
    `#${entries[index]?.[0]} ${entries[index]?.[1] ?? ''}`);

  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed. The winner is reproduced from the lock and public randomness.');
  if (String(a.lock).startsWith('http')) {
    console.log(`\nBitcoin timestamp of the lock: download ${a.lock}.ots and drop it, with the lock file, on https://opentimestamps.org`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('ERROR ' + e.message); process.exit(2); });
