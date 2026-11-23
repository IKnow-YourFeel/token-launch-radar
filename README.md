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

The model (radar-2, in `lib/model.ts`) scores all 197 protocols that pass the house's exclusion rules — the 40 watchlist slugs plus every other rankable pre-token protocol. Implied value is TVL times a category multiple derived from the snapshot's own live-token protocols (median market-cap / TVL per category, shrunk toward the overall live median with a prior of 20, clamped to 0.12–0.35), times a growth multiplier (7-day change clamped to -50..80%), a maturity multiplier (age since first listed, up to 3 years), and a chain-breadth multiplier. No protocol name is special-cased. Live-token protocols are set aside with their market caps shown, never mixed into the ranking.

The dashboard (`dashboard/`) is a static page with no network: a sortable, filterable board (search, category, chain, watchlist-only, growing-only), a top-three spotlight, a detail view for every protocol with the model's full breakdown, and a seven-step farm plan with costs and times.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
