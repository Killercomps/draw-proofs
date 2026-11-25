# KillerComps draw proofs

Every KillerComps main-prize draw is **locked before it is drawn**. This repository is a public, independent copy of those locks and their results, plus a verifier you can run yourself.

## How a draw works

1. **Lock.** When a competition's draw is due, entries close and every eligible entry is frozen, in draw order, into a public list. The draw is tied to a [drand](https://drand.love) round that **has not been published yet**: about two minutes away for a scheduled draw, under a minute for a draw on our live show. The lock file records:
   - the hash of the entry list,
   - the hash of the server seed (published on the competition page since the day it opened),
   - the drand round number.

   The lock is published on the site and copied here straight away.
2. **Draw.** When that drand round comes out, the winner is
   `int(first 15 hex of HMAC-SHA256(key = server_seed, message = drand_randomness), 16) mod entry_count`,
   counting from 0 down the locked list. Nothing else goes in.
3. **Result.** The seed is revealed and the result file is copied here.

Nobody can predict a drand round before it is published, and that includes KillerComps. With the list, the seed and the round all fixed in advance, there is nothing left to choose.

## What is in this repo

```
draws/YYYY/MM/<id>-<competition>/
  lock-<n>.json        the lock, byte for byte as hashed
  lock-<n>.json.ots    OpenTimestamps proof of the lock (Bitcoin)
  result-<n>.json      the result: revealed seed, randomness, winning index and ticket
```

There are no names or personal details here. The repo is permanent, so it only holds hashes and numbers. The entry list, with each entry's ticket number and the short public name shown on the site, is published on the competition's proof page. Its hash is in the lock file here, so you can check that the list on the site is the one that was locked.

A lock can be **voided**, for example when a late entry arrives after it was taken. A voided lock is not deleted. It stays on the proof page with the reason, and a new lock is taken.

## Check a draw yourself

**In a browser:** open `index.html` (or the GitHub Pages copy of it) and paste the competition's proof page link. It runs locally with Web Crypto.

**With Node 18+:**

```
node verify.mjs https://killercomps.com/verify/draw/<competition>
```

or, without trusting the site for anything except the entry list:

```
node verify.mjs --lock draws/…/lock-12.json --result draws/…/result-12.json \
                --entries https://killercomps.com/verify/draw/<competition>/lock-entries/<hash>.json
```

The verifier checks that:

- the lock file's hash matches the one in the result,
- the entry list's hash matches the one in the lock,
- the revealed seed matches the hash committed before the draw,
- the drand randomness, fetched from two separate drand relays, matches,
- the lock was made **before** its drand round was published,
- the HMAC, the winning index and the winning ticket all reproduce.

## Timing evidence

- **GitHub's push log** (this repo's *Activity* tab) records when each lock was pushed, on GitHub's own clock. A push time earlier than the round's publish time shows the lock existed before the randomness did. Commit dates can be set by whoever makes the commit, so rely on the push log, not the commit date.
- **OpenTimestamps.** Drop `lock-<n>.json` and its `.ots` on [opentimestamps.org](https://opentimestamps.org), or run `ots verify`. This proves the lock existed, unchanged, by a given Bitcoin block. A block lands later than a drand round, so this proves the lock was never rewritten afterwards, not that it came first.
