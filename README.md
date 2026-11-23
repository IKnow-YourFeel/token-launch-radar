# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/IKnow-YourFeel/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/IKnow-YourFeel/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every rankable pre-token protocol by implied value, with a seven-step farm plan for each. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

## How it works

The model (radar-3, in `lib/model.ts` and `lib/validation.ts`) scores all 197 protocols that pass the house's exclusion rules — the 40 watchlist slugs plus every other rankable pre-token protocol. Implied value is a size curve fitted on the snapshot's own live-token protocols — log(market cap) = 6.965 + 0.522 × log(TVL) by least squares on the 128 live comps — times a growth multiplier (7-day change clamped to -50..80%), a maturity multiplier (age since first listed, up to 3 years), and a chain-breadth multiplier. The curve is tested held-out two ways: walk-forward x3.01 and leave-one-out x3.40, against x4.33 and x4.77 for one flat overall multiple. A per-category intercept was tested the same way and did not beat the curve, so no category term prices the board. No protocol name is special-cased. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.

Every row also carries fitted token launch odds (from the peers' record, by age and TVL tier), an expected value (implied value × odds), a launch-readiness assessment (`lib/launch-readiness.ts`), and a costed farm verdict (farm / thin / skip, with gas, active hours, cost per hour and break-even). The audit accounts for all 758 snapshot protocols: 197 ranked, 416 live-token set aside, 145 excluded by a named rule.

The dashboard (`dashboard/`) is a static page with no network: a sortable, filterable board (search, category, chain, watchlist-only, growing-only), an integrity strip that recomputes the board's own checks live, an audit ledger for all 758 protocols, a top-three spotlight, a detail view for every protocol with the model's full breakdown, token odds, expected value and farm verdict, and a seven-step farm plan with costs and times.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
