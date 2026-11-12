# Line Manager — live classroom game (BU5644 Group S102, Presentation 2)

Original factory-optimisation game. 7 teams, one laptop each, compete live while the
projector shows a host dashboard. Target: 5–8 minutes of play inside a 10-minute talk.
Main bias: **sunk cost**. Main nudge: **payback tag**. Hypothesis H1: the payback tag
lowers the share of unpayable upgrades chosen.

## Economy (deterministic, so payback maths is exact)
- A production line of 4 machines. Output per hour = min(machine rates). Revenue = output × price.
- Some upgrades instead give a flat running-cost saving ($/hr).
- Shift = 24 hours. Decision checkpoints at hour 0, 8, 16 (24h, 16h, 8h left).
- Between checkpoints, the 8 hours are simulated with a short animation (~5 s).
- Every team starts each round with $500 cash. Score = cash at end of shift. Leaderboard = total over both rounds.
- Each decision: **A = invest** (pay cost now, effect applies from that checkpoint on) or **B = don't invest / scrap**.
- Decision timer 40 s. On timeout the default is B (status quo: nothing bought). Logged as `timeout`.
- Payback hours = cost ÷ extra $/hr (∞ if gain is 0). "Unpayable" = payback > hours left.

### Round 1 — "Plant A" (Cutter, Welder, Painter, Boxer); price $10/unit
Base rates: Cutter 9, Welder 6, Painter 9, Boxer 12 → 6/hr = $60/hr.

| # | Hour (left) | Offer | Sunk shown | Cost | Effect | Gain | Payback | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 (24h) | Welder retrofit — finish it | $300 already spent | $360 | Welder +1/hr | +$10/hr | 36h | Unpayable → B |
| 2 | 8 (16h) | Painter overhaul | $400 already spent | $200 | Painter +4/hr | $0 (not bottleneck) | never | Unpayable → B |
| 3 | 16 (8h) | Welder quick-fix | none | $60 | Welder +2/hr | +$20/hr | 3h | Good → A |

Optimal R1 final cash = 500 + 1440 + 160 − 60 = **$2,040**. Buy-everything = 500 + 1840 − 620 = **$1,720**.

Conditions in Round 1 (alternating by join order, host can flip a team before start):
- **Control** (odd teams 1,3,5,7): offer card shows cost, sunk spend, machine effect. No tag.
- **Tag** (even teams 2,4,6): same card + **payback tag**: `Pays back in 36h · 24h left ✗` (or `Never pays back · 16h left ✗`, `Pays back in 3h · 8h left ✓`).
Button labels identical in both conditions ("Invest $X" / "Don't invest").

### Round 2 — "Plant B" (Mixer 1, Press 2, Freezer 3, Packer 4); price $12/unit
Base rates: Mixer 10, Press 10, Freezer 7, Packer 12 → 7/hr = $84/hr.

| # | Hour (left) | Offer | Sunk shown | Cost | Effect | Gain | Payback | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 (24h) | Mixer 1 energy retrofit — finish it | $500 already spent | $360 | saves $12/hr running cost | +$12/hr | 30h | Unpayable → B |
| 2 | 8 (16h) | Press 2 turbo kit | $350 already spent | $180 | Press +4/hr | $0 (Freezer is bottleneck) | never | Unpayable → B |
| 3 | 16 (8h) | Freezer 3 fast-chill | none | $96 | Freezer +2/hr | +$24/hr | 4h | Good → A |

Optimal R2 = 500 + 2016 + 192 − 96 = **$2,612**. Buy-everything = 500 + 2016 + 288 + 192 − 636 = **$2,360**.

Round 2 — ALL teams get every nudge, in this order on each decision:
1. **Predict first**: "Will this pay back before the shift ends?" Yes / No (must answer; logged, scored for accuracy).
2. Reveal **payback tag**.
3. **New Manager reframe** card: "A new manager walks in today with no history. The $500 already spent is gone either way. Would they buy this?" (only on offers with sunk spend).
4. **Scrap button** replaces "Don't invest" on sunk offers: "Scrap it — write off the $500" (one click).
5. **Bottleneck glow**: slowest machine pulses on the line diagram during the whole round.

## Flow
Host: Lobby (QR + URL + join code, teams appear) → Start R1 → live progress → Reveal R1 (control vs tag chart)
→ Start R2 → Reveal R2 → Bias Mirror + final leaderboard → Export CSV.
Teams self-pace within a round (timer per decision). Host dashboard live: per-team progress, cash, upgrades bought.

## Biases the game provokes (for slides)
Sunk cost fallacy; escalation of commitment; loss aversion (scrapping = realising a loss); bottleneck
neglect / salience of the shiny machine; horizon (time-left) neglect; competitive arousal & risk-seeking
when behind on the live leaderboard (prospect theory, losses domain); first-speaker anchoring inside
teams (link to P1 Mafia); default/status-quo effect (timeout = don't buy).
Avoid: bandwagon, generic social pressure, discounts/sales.

## Bias Mirror (end, on each team laptop)
Per decision: what you chose, $ effect vs best choice, which bias it matches, e.g.
"You paid $360 to finish the Welder because $300 was already in it. It earned back $240. Sunk cost: −$120."
Plus: R1 vs R2 change, prediction accuracy, rank.

## Data export (CSV)
team, condition_r1, round, decision, choice, prediction, timed_out, decide_ms, cash_after_round.
