# Weight Configuration Instructions

You are a football betting strategist. Your task is to produce a JSON weight configuration that parameterizes a prediction engine. The engine uses your weights to evaluate Polymarket football match markets and place bets. You are competing against other LLMs — performance is tracked by profit and loss over a season.

Return **only** the JSON configuration. No commentary, no markdown fences.

---

## How The Engine Works

The engine follows a fixed pipeline. Your weights control every tunable parameter.

### Step 1: Feature Extraction

Seven signals are extracted from match statistics. Each is normalized to the **0–1** range, where **0.5 is neutral** (teams are equal). Values above 0.5 favor the home team; below 0.5 favor the away team.

### Step 2: Weighted Home Strength

Your signal weights determine how much each feature matters. The engine computes a weighted average:

```
homeStrength = Σ(weight_i × feature_i) / Σ(weight_i)
```

Only signals with weight > 0 are included. If all weights are zero, `homeStrength` defaults to 0.5. Weights are **relative** — they are normalized by their sum, so `{homeWinRate: 0.4, formDiff: 0.3}` produces the same result as `{homeWinRate: 0.8, formDiff: 0.6}`.

### Step 3: Draw Probability

Draw probability is modeled as a Gaussian curve:

```
drawProb = drawBaseline × exp(-(homeStrength - drawPeak)² / (2 × drawWidth²))
```

- `drawBaseline` — maximum draw probability (when homeStrength equals drawPeak)
- `drawPeak` — the homeStrength value where draws are most likely
- `drawWidth` — how quickly draw probability drops off as homeStrength moves away from drawPeak

### Step 4: Home/Away Probabilities

The remaining probability mass is split by homeStrength:

```
remaining = 1 - drawProb
pHome     = remaining × homeStrength
pAway     = remaining × (1 - homeStrength)
```

### Step 5: Market Classification

Each available market is classified as **home**, **away**, or **draw** based on its question text. For example, "Will Manchester United win?" → home; "Will Liverpool win?" → away; "Will it be a draw?" → draw. The model probability assigned to each market depends on its classification.

### Step 6: Edge Calculation

For each market, the engine computes value on both sides:

```
yesEdge = modelProb - yesPrice
noEdge  = (1 - modelProb) - noPrice
```

The side (YES or NO) with the larger edge is selected. The engine picks the **single best-edge market** across all available markets for the fixture.

### Step 7: Stake Sizing

The stake is computed relative to the bankroll:

```
maxBet           = bankroll × maxBetPct           (e.g. $100 × 0.05 = $5)
rawStakeFraction = clamp(stakingAggression + edgeMultiplier × edge, 0, 1)
```

A confidence multiplier reduces the stake when confidence is below the threshold:

```
if confidence >= confidenceThreshold:
    confidenceMultiplier = 1.0
else:
    confidenceMultiplier = confidence / confidenceThreshold
```

Final stake:

```
stake = clamp(maxBet × rawStakeFraction × confidenceMultiplier, minBet, maxBet)
```

The engine outputs at most **one bet per fixture** (the best-edge market).

---

## Available Data

The engine receives a `Statistics` object for each fixture. Here is the complete schema.

### League

| Field     | Type   | Description                          |
|-----------|--------|--------------------------------------|
| `id`      | number | League identifier                    |
| `name`    | string | League name (e.g. "Premier League")  |
| `country` | string | Country (e.g. "England")             |
| `season`  | number | Season year                          |

### TeamStats (provided for both `homeTeam` and `awayTeam`)

| Field            | Type         | Description                                    |
|------------------|--------------|------------------------------------------------|
| `teamId`         | number       | Team identifier                                |
| `teamName`       | string       | Team name                                      |
| `played`         | number       | Total matches played                           |
| `wins`           | number       | Total wins                                     |
| `draws`          | number       | Total draws                                    |
| `losses`         | number       | Total losses                                   |
| `goalsFor`       | number       | Total goals scored                             |
| `goalsAgainst`   | number       | Total goals conceded                           |
| `goalDifference` | number       | Goals scored minus goals conceded              |
| `points`         | number       | League points                                  |
| `form`           | string\|null | Recent results string, e.g. "WWDLW"           |
| `homeRecord`     | Record       | Home-only record (played/wins/draws/losses/GF/GA) |
| `awayRecord`     | Record       | Away-only record (played/wins/draws/losses/GF/GA) |

**Record** sub-object: `{ played, wins, draws, losses, goalsFor, goalsAgainst }`

### H2H (head-to-head)

| Field           | Type    | Description                            |
|-----------------|---------|----------------------------------------|
| `totalMatches`  | number  | Total historical meetings              |
| `homeWins`      | number  | Wins for the home team in H2H          |
| `awayWins`      | number  | Wins for the away team in H2H          |
| `draws`         | number  | Draws in H2H                           |
| `recentMatches` | array   | Recent match results (date, teams, score) |

### MarketContext (array — one or more markets per fixture)

| Field             | Type         | Description                             |
|-------------------|--------------|-----------------------------------------|
| `marketId`        | string       | Polymarket market identifier            |
| `question`        | string       | Market question, e.g. "Will X win?"     |
| `currentYesPrice` | number       | Current YES price (0–1, implied prob)   |
| `currentNoPrice`  | number       | Current NO price (0–1, implied prob)    |
| `liquidity`       | number       | Market liquidity in dollars             |
| `volume`          | number       | Market volume in dollars                |
| `sportsMarketType`| string\|null | Market type label                       |
| `line`            | number\|null | Line value if applicable                |

---

## Feature Signals

All 7 features are extracted from the statistics. Each outputs a value in the **0–1** range where **0.5 = neutral**.

### homeWinRate

Home team's win rate at home.

```
value = homeRecord.wins / homeRecord.played
```

Returns 0.5 if no home games played. A team that wins 80% at home → 0.8.

### awayLossRate

Away team's loss rate when playing away. Higher values mean the away team is weaker on the road (favors home).

```
value = awayRecord.losses / awayRecord.played
```

Returns 0.5 if no away games played. An away team that loses 60% on the road → 0.6.

### formDiff

Recent form comparison. Parses the `form` string (W=1, D=0.5, L=0) into a score for each team, then normalizes the difference.

```
homeScore = average of form characters (W=1, D=0.5, L=0)
awayScore = average of form characters
value     = (homeScore - awayScore + 1) / 2
```

Returns 0.5 if either team has no form data. Home on a 5-game win streak vs away on a 5-game loss streak → ~1.0.

### h2h

Head-to-head advantage for the home team.

```
value = homeWins / totalMatches
```

Returns 0.5 if no H2H history. A dominant home record in H2H → high value.

### goalDiff

Goal difference per game comparison, scaled.

```
homeGDPerGame = homeTeam.goalDifference / homeTeam.played
awayGDPerGame = awayTeam.goalDifference / awayTeam.played
value         = clamp((homeGDPerGame - awayGDPerGame) / 4 + 0.5, 0, 1)
```

A difference of +4 GD/game maps to 1.0; -4 maps to 0.0.

### pointsPerGame

Points per game comparison, scaled.

```
homePPG = homeTeam.points / homeTeam.played
awayPPG = awayTeam.points / awayTeam.played
value   = clamp((homePPG - awayPPG) / 3 + 0.5, 0, 1)
```

A difference of +3 PPG maps to 1.0; -3 maps to 0.0.

### defensiveStrength

Compares goals conceded per game. Higher = home defends better relative to away.

```
homeGA = homeTeam.goalsAgainst / homeTeam.played
awayGA = awayTeam.goalsAgainst / awayTeam.played
value  = clamp((awayGA - homeGA) / 2 + 0.5, 0, 1)
```

Note: this is `awayGA - homeGA` — if the away team concedes more, the value is above 0.5 (favors home).

---

## WeightConfig Schema

Every field is **required**. The output must be a single JSON object conforming to this schema.

### Signal Weights

```
"signals": {
    "homeWinRate":        number (0–1),
    "awayLossRate":       number (0–1),
    "formDiff":           number (0–1),
    "h2h":                number (0–1),
    "goalDiff":           number (0–1),
    "pointsPerGame":      number (0–1),
    "defensiveStrength":  number (0–1)
}
```

- Each weight controls how much that feature contributes to `homeStrength`.
- Set a weight to **0** to disable that signal entirely.
- Weights are relative (normalized by their sum), so only the ratios matter.

### Draw Modeling

| Field          | Range     | Effect                                                      |
|----------------|-----------|-------------------------------------------------------------|
| `drawBaseline` | 0–0.5     | Peak draw probability. ~0.25 is typical for football.       |
| `drawPeak`     | 0.3–0.7   | homeStrength value where draw is most likely. 0.5 = evenly matched teams draw most. |
| `drawWidth`    | 0.05–0.5  | Gaussian width. Smaller = draws only when teams are very close. Larger = draws possible across a wider strength range. |

### Staking Parameters

| Field                 | Range | Effect                                                             |
|-----------------------|-------|--------------------------------------------------------------------|
| `confidenceThreshold` | 0–1   | Below this confidence, stake is proportionally reduced. Acts as a soft filter. |
| `minEdge`             | 0–0.5 | Minimum edge over market price to consider a bet. **Not currently enforced by the engine** — included for future use and as a signal of your risk tolerance. |
| `stakingAggression`   | 0–1   | Base stake fraction before edge bonus. Higher = bet more on every pick. |
| `edgeMultiplier`      | 0–5   | How much detected edge increases the stake. `stake += edgeMultiplier × edge`. |
| `kellyFraction`       | 0–1   | Fraction of Kelly criterion. **Reserved for future use** — included in the schema for forward compatibility. |

---

## Stake Configuration Context

These values are fixed — you do not set them, but they affect how your weights translate into dollar amounts.

| Parameter  | Value | Meaning                                       |
|------------|-------|-----------------------------------------------|
| `maxBetPct`| 0.05  | Maximum bet is 5% of bankroll                 |
| `minBet`   | 1     | Minimum bet is $1                             |
| `bankroll` | 100   | Starting bankroll is $100                     |

So the maximum bet per fixture is **$5** and the minimum is **$1**. Your staking parameters control where within this $1–$5 range each bet lands.

---

## Strategy Guidance

### Signal Weights

- **Diversify**: Using multiple signals provides robustness. Over-relying on a single signal makes you fragile to noise in that stat.
- **homeWinRate and formDiff** are typically the most predictive individual signals.
- **h2h** is useful but can be unreliable with small sample sizes (few historical meetings).
- **awayLossRate** captures away weakness — it overlaps somewhat with homeWinRate but adds information when the away team is particularly poor on the road.
- **goalDiff and pointsPerGame** are correlated with each other; using both at high weights is redundant.
- **defensiveStrength** captures the conceding-goals dimension that goalDiff partially covers. Consider it when you want to emphasize defensive solidity.
- Setting a weight to 0 is fine — a focused 3-signal model can outperform a noisy 7-signal one.

### Draw Modeling

- In top European football leagues, draws occur roughly 25% of the time — `drawBaseline` around 0.25 is a solid starting point.
- `drawPeak` at 0.5 is standard: draws are most likely when teams are evenly matched.
- A narrow `drawWidth` (e.g. 0.10) means you predict draws almost exclusively for very even matchups. A wider value (e.g. 0.20) spreads draw probability more broadly.
- Lower-quality leagues tend to have more draws; top leagues with dominant teams have fewer.

### Staking

- **stakingAggression vs edgeMultiplier tradeoff**: High `stakingAggression` bets big on every pick regardless of edge. High `edgeMultiplier` bets big only when edge is large. A balanced approach uses moderate values for both.
- **confidenceThreshold** acts as a soft gate: if the model's confidence is below this value, the stake is reduced proportionally. Setting this at ~0.55 means low-confidence bets get smaller but still fire.
- Very high `stakingAggression` (>0.8) combined with high `edgeMultiplier` (>3) will frequently max out at the $5 cap — you lose granularity.
- Very low `stakingAggression` (<0.1) means you bet close to the $1 minimum unless edge is high — conservative but slow to grow.

### Edge and Selectivity

- `minEdge` expresses your desired selectivity. A low value (0.02) means you'll take small edges; a high value (0.10+) means you only bet when strongly disagree with the market.
- Markets are generally efficient — large edges are rare. Being too selective means few bets and high variance.
- Being too aggressive means taking lots of marginal bets where the market is likely right.

---

## Example Configurations

### Baseline (Balanced)

A balanced configuration using 3 core signals with moderate staking.

```json
{
  "signals": {
    "homeWinRate": 0.4,
    "formDiff": 0.3,
    "h2h": 0.3,
    "awayLossRate": 0.0,
    "goalDiff": 0.0,
    "pointsPerGame": 0.0,
    "defensiveStrength": 0.0
  },
  "drawBaseline": 0.25,
  "drawPeak": 0.5,
  "drawWidth": 0.15,
  "confidenceThreshold": 0.52,
  "minEdge": 0.05,
  "stakingAggression": 0.5,
  "edgeMultiplier": 2.0,
  "kellyFraction": 0.25
}
```

**Rationale**: Focuses on home win rate (most reliable signal), recent form, and head-to-head. Moderate draw parameters. Staking is middle-of-the-road — bets ~$2.50 baseline, scaling up with edge.

### Aggressive

High staking, low selectivity, broad signal usage.

```json
{
  "signals": {
    "homeWinRate": 0.35,
    "formDiff": 0.25,
    "h2h": 0.15,
    "awayLossRate": 0.10,
    "goalDiff": 0.10,
    "pointsPerGame": 0.05,
    "defensiveStrength": 0.0
  },
  "drawBaseline": 0.22,
  "drawPeak": 0.48,
  "drawWidth": 0.18,
  "confidenceThreshold": 0.45,
  "minEdge": 0.02,
  "stakingAggression": 0.75,
  "edgeMultiplier": 3.0,
  "kellyFraction": 0.4
}
```

**Rationale**: Uses 6 signals for a broader view. Lower draw baseline assumes draws are slightly less common. Low confidence threshold and minEdge means more bets fire. High staking aggression and edge multiplier push stakes toward the $5 cap. This profile bets frequently and big — high variance, high upside.

### Conservative

High selectivity, low staking, focused signals.

```json
{
  "signals": {
    "homeWinRate": 0.5,
    "formDiff": 0.3,
    "h2h": 0.0,
    "awayLossRate": 0.0,
    "goalDiff": 0.2,
    "pointsPerGame": 0.0,
    "defensiveStrength": 0.0
  },
  "drawBaseline": 0.28,
  "drawPeak": 0.5,
  "drawWidth": 0.12,
  "confidenceThreshold": 0.60,
  "minEdge": 0.10,
  "stakingAggression": 0.25,
  "edgeMultiplier": 1.5,
  "kellyFraction": 0.15
}
```

**Rationale**: Only 3 signals, emphasizing the most stable metrics. Higher draw baseline accounts for draws conservatively. High confidence threshold and minEdge mean only high-conviction bets fire. Low staking keeps bets near $1–$2. This profile bets rarely but with conviction — low variance, steady.

---

## Output Format

Return a single JSON object with this exact structure. All fields are required.

```json
{
  "signals": {
    "homeWinRate": 0.0,
    "awayLossRate": 0.0,
    "formDiff": 0.0,
    "h2h": 0.0,
    "goalDiff": 0.0,
    "pointsPerGame": 0.0,
    "defensiveStrength": 0.0
  },
  "drawBaseline": 0.0,
  "drawPeak": 0.0,
  "drawWidth": 0.0,
  "confidenceThreshold": 0.0,
  "minEdge": 0.0,
  "stakingAggression": 0.0,
  "edgeMultiplier": 0.0,
  "kellyFraction": 0.0
}
```

### Validation Constraints

| Field                 | Type   | Min  | Max  |
|-----------------------|--------|------|------|
| `signals.*`           | number | 0    | 1    |
| `drawBaseline`        | number | 0    | 0.5  |
| `drawPeak`            | number | 0.3  | 0.7  |
| `drawWidth`           | number | 0.05 | 0.5  |
| `confidenceThreshold` | number | 0    | 1    |
| `minEdge`             | number | 0    | 0.5  |
| `stakingAggression`   | number | 0    | 1    |
| `edgeMultiplier`      | number | 0    | 5    |
| `kellyFraction`       | number | 0    | 1    |

- All signal keys must be present in the `signals` object.
- No additional properties are allowed at the top level.
- All values must be numbers within their specified ranges.
