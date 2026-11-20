# Gas report

What the governance contract's unbounded loops cost, measured on 19 November
2026 to decide whether to cap the number of a TI's keys and cosigners
(Slither's `calls-loop` findings). The contracts were not changed for this
report: it measures them as they are.

The EBSI PILOT charges no gas. These figures matter only on a network that
does, where a call that grows with the configuration could become expensive,
or too large for a block.

## How it was measured

[`test/gas/WorstCase.t.sol`](../test/gas/WorstCase.t.sol), run with

```bash
forge test --match-path "test/gas/*" -vv
```

- **Registries:** the EBSI mock DID Registry and Trusted Issuers Registry
  (`local/ebsi-mock`), wired as in [`test/EbsiTrustChain.t.sol`](../test/EbsiTrustChain.t.sol),
  not the stubs. The real EBSI registries may cost more or less per call.
- **Cold state:** every contract a call touches (the proxies, beacons and
  implementations of both contracts and both registries) is marked cold with
  `vm.cool` before the call, so each figure is that of the first call of its
  own transaction.
- **Transaction cost:** each figure includes the 21,000 gas every transaction
  pays. Calldata gas is not included; it is small next to these figures.
- **Build:** Forge 1.8.5, solc 0.8.26, via-IR, as deployed.
- **TI:** one TI with *keys* own keys (roles A and B in turn) and *cosigners*
  cosigner DIDs (role C, each with one key), under the pilot's policies: 2 of
  3, any role vetoes, no timelock.

## Where the cost grows

| Loop | Over | Calls in each step |
|---|---|---|
| `roleOf` | the TI's cosigners | `checkController` in the DID Registry |
| `_rolesSigned` (the quorum, in `sign` and `execute`) | the proposal's signatures | `roleOf`, and so every cosigner again |
| `_rolesPresent` | keys and cosigners | none (storage only) |
| `_dropSigner` | keys | none (storage only) |
| `isActiveTi` (`propose`, `execute`, `registerCertificate`) | the trust chain, at most `MAX_TRUST_CHAIN_DEPTH` (32) | `getLatestRevisionAttribute` in the Trusted Issuers Registry |

Nothing caps the number of keys (`proposeAddSigner`) or cosigners
(`setCosigners`). A proposal keeps the signatures of keys that have since lost
their role, and they still count in the loop.

## Keys and cosigners

Gas per call. *Last signature* is the last of every key and every cosigner
signing one proposal: the costliest signature. *removeSigner* is the signature
that completes the quorum of a rule change removing the last key, which then
applies it. A dash means the case has no such call.

| Keys | Cosigners | `roleOf` (not a signer) | `proposeAction` | Last signature | `execute` | `registerCertificate` | removeSigner | `setCosigners` |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 0 | 39,863 | 479,576 | – | 331,040 | 319,545 | 398,329 | 133,305 |
| 3 | 3 | 89,567 | 462,476 | 388,562 | 472,728 | 319,545 | 406,561 | 185,586 |
| 3 | 10 | 189,200 | 462,476 | 991,664 | 1,016,588 | 319,533 | 424,397 | 324,558 |
| 3 | 30 | 473,876 | 462,464 | 4,402,272 | 4,257,433 | 319,545 | 475,357 | 917,282 |
| 10 | 0 | 39,859 | 479,576 | – | 524,057 | 319,545 | 438,586 | 169,810 |
| 10 | 3 | 89,567 | 462,476 | 581,572 | 665,746 | 319,545 | 446,818 | 222,091 |
| 10 | 10 | 189,200 | 462,476 | 1,184,689 | 1,209,618 | 319,533 | 464,654 | 361,063 |
| 10 | 30 | 473,876 | 462,464 | 4,595,408 | 4,450,564 | 319,545 | 515,614 | 953,787 |
| 30 | 0 | 39,859 | 479,576 | – | 1,075,543 | 319,545 | 553,606 | 274,110 |
| 30 | 3 | 89,567 | 462,476 | 1,133,038 | 1,217,236 | 319,545 | 561,838 | 326,391 |
| 30 | 10 | 189,200 | 462,476 | 1,736,199 | 1,761,142 | 319,533 | 579,674 | 465,363 |
| 30 | 30 | 473,876 | 462,464 | 5,147,235 | 5,002,376 | 319,545 | 630,634 | 1,058,087 |
| 100 | 0 | 39,859 | 479,576 | – | 3,005,852 | 319,545 | 956,176 | 639,160 |
| 100 | 3 | 89,567 | 462,476 | 3,063,281 | 3,147,561 | 319,545 | 964,408 | 691,441 |
| 100 | 10 | 189,200 | 462,476 | 3,666,597 | 3,691,587 | 319,533 | 982,244 | 830,413 |
| 100 | 30 | 473,876 | 479,576 | 7,078,740 | 6,933,830 | 319,545 | 1,033,204 | 1,423,137 |

The first `proposeAction` of each test run costs about 17,000 more than the
rest: storage the earlier cases had already written.

## Trust chain

The TI accredited by a TAO at the end of a chain of *TAOs* from the RootTAO;
`isActiveTi` reads one attribute more than there are TAOs. Three keys, no
cosigners.

| TAOs above the TI | `proposeAction` | `execute` | `registerCertificate` |
|---:|---:|---:|---:|
| 1 | 479,576 | 303,467 | 319,545 |
| 2 | 513,658 | 337,549 | 353,624 |
| 4 | 581,837 | 405,729 | 421,786 |
| 8 | 718,243 | 542,149 | 558,207 |
| 16 | 991,335 | 815,232 | 831,255 |
| 31 | 1,504,232 | 1,328,136 | 1,344,129 |

Each TAO adds about 34,000 gas to every call that checks the TI. The chain is
already capped: `MAX_TRUST_CHAIN_DEPTH` is 32.

## What the figures show

- **The pilot's configuration is cheap.** Three keys and one cosigner (NBÚ)
  cost about 0.4M gas to execute.
- **Keys grow linearly.** `execute` costs about 27,600 gas more per signature,
  and removing a key about 5,600 more per key.
- **Cosigners grow quadratically in a quorum.** Each signature asks `roleOf`,
  and `roleOf` asks the DID Registry once per cosigner. With three keys,
  `execute` fits `331k + 38k × cosigners + 3.0k × cosigners²` within a few
  percent of every measured case.
- **`roleOf` alone** costs about 15,000 more per cosigner for a key that is
  not a signer, since it walks all of them.
- **`registerCertificate` does not grow** with keys or cosigners.
- **No measured case comes near a block.** The worst, 100 keys and 30
  cosigners, executes for 6.9M gas. For comparison, that is under a quarter
  of a 30M-gas block. EBSI's production gas limit is not known here.

### Beyond the measured range

From the fit above, extrapolated, not measured:

| Cosigners (3 keys) | `execute` (estimate) |
|---:|---:|
| 60 | ≈ 13.5M |
| 80 | ≈ 22.9M |
| 100 | ≈ 34M |

A TI would need roughly a hundred cosigners, all signing one proposal, before
`execute` no longer fits a 30M-gas block.

## If limits are introduced

Worst-case `execute` under some candidate caps, estimated from the same fit
(about 250k + 27.6k per key + 38k per cosigner + 3.0k per cosigner squared,
which also matches the 100 keys and 30 cosigners case):

| `MAX_SIGNERS` | `MAX_COSIGNERS` | Worst-case `execute` (estimate) |
|---:|---:|---:|
| 10 | 5 | ≈ 0.8M |
| 20 | 10 | ≈ 1.5M |
| 50 | 16 | ≈ 3.0M |
| 100 | 30 | 6.9M (measured) |

No limit has been chosen; this report is the input for that decision. A cap
on cosigners matters more than one on keys, since cosigners grow the quorum's
cost quadratically.
