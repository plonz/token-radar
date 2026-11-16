# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/plonz/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/plonz/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Lumen Radar ranks the protocols in make.fun's sealed DefiLlama snapshot that record no token yet — all 40 watchlist protocols plus every other rankable pre-token protocol the snapshot carries, 198 rows — by an implied token value. The model prices each protocol's TVL at its category's own peer multiple (the median market-cap-to-TVL ratio of the snapshot's live-token protocols in that category, with a global-median fallback for thin categories), then adjusts for 7-day momentum, track record (a saturating age curve) and chain breadth. Wrapped, staked and bridged products of tokens that already trade are set aside by the same exclusions the house watchlist uses. The dashboard is a static page: a sortable, filterable board with a per-protocol detail view showing the model's arithmetic and a six-step farm plan with costs and times, plus the live-token peer set shown apart at the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=plonz&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
