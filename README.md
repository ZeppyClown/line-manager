# Line Manager

A live classroom game for BU5644 Group S102 (Presentation 2). Seven teams each run a factory
on their own laptop while the projector shows the host dashboard. The game is built around the
sunk cost bias and the payback tag nudge. Design and numbers are in [SPEC.md](SPEC.md).

## Run locally
```bash
npm install
HOST_KEY=s102 npm start          # http://localhost:3000  (teams)
                                 # http://localhost:3000/host?key=s102  (projector)
```

## Deploy on Render (free)
1. Push this folder to a GitHub repo (it can be private).
2. On Render, choose **New → Blueprint**, pick the repo, and Render reads `render.yaml`.
   When it asks for `HOST_KEY`, enter a password for the host screen.
3. Your link will look like `https://line-manager-xxxx.onrender.com`.
   - Teams open `https://…onrender.com`
   - Projector opens `https://…onrender.com/host?key=YOUR_HOST_KEY`

> **Free plan cold start:** Render puts the service to sleep after 15 minutes without visitors,
> and waking it takes about a minute. **Open the host page 5 minutes before you present.**
> Once the host page is open it keeps the server awake.
> Results only live in memory. Export the CSV at the end of the game.

## Run sheet (on the day)
| When | Who | What |
|---|---|---|
| 5 min before | Presenter | Open `/host?key=…` on the projector laptop. Check it shows the QR code. |
| Slide "How to play" | Presenter | Teams scan the QR or type the URL, one laptop per team, and enter a team name. Odd-numbered teams are Control (no tag), even-numbered teams get the Tag. Click a badge to switch a team. |
| | Presenter | Click **Start Round 1 ▶**. Each team makes 3 decisions, 40 s each. About 2½ minutes. |
| | Presenter | When the table shows every team finished, or time is up, click **Reveal Round 1 results**. Unfinished decisions count as "don't invest". |
| | Presenter | Talk about H1, then click **Start Round 2 ▶**. Every team gets all five nudges. |
| | Presenter | **Reveal Round 2 results**, then **Final leaderboard 🏆**. Teams read their Bias Mirror on their laptops. |
| After | Presenter | Click **Export CSV** to keep the data. Do not press Reset before exporting. |

**If the Wi-Fi fails:** teams open `…/?offline` (Control) or `…/?offline&cond=tag` (Tag).
The game runs on the laptop alone and shows the Bias Mirror at the end, but nothing appears on the
host screen. Ask teams to call out their final cash.

**If a laptop refreshes or drops out:** reopen the same URL in the same browser. The team is restored
and any choices it made while offline are sent when it reconnects.

**Mistakes:** **◀ Back** returns to the previous phase. Teams keep their decisions.
