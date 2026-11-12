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

## Run sheet (on the day): about 6 minutes of game
| When | What you click on the host | What teams see |
|---|---|---|
| 5 min before | Open `/host?key=…` on the projector laptop. | — |
| 0:20 | Show the lobby (QR and URL). | Teams join on one laptop each, then a **1-minute tutorial** runs on their laptops. The lobby counts "N of 7 teams ready". |
| ~1:20 | **Start Round 1 ▶** (3-2-1 countdown) | Odd teams are **Group A** (no payback tag, the control), even teams are **Group B** (payback tag). The projector only says "Group A / B" until the results, so nobody is primed. 3 offers, 40 s each. |
| ~3:20 | **Reveal Round 1 results** | Laptops now show the 👻 ghost manager (perfect play) next to the team's own cash. Talk about H1. |
| ~4:15 | **Start Round 2 ▶** | A 20-second **rule card**, then 3 offers with all 8 nudges. |
| ~6:45 | **Reveal Round 2 results** → **Final leaderboard 🏆** | Bias Mirror, ghost manager comparison and badges on each laptop. |
| After | **Export CSV** | — |

The header chip shows time on the current screen and total game time. It turns orange when a screen runs long.
Use **Finish for slow teams** if one team stalls. Sound is muted on the host by default; teams can mute with the 🔊 button.

**If the Wi-Fi fails:** teams open `…/?offline` (Control) or `…/?offline&cond=tag` (Tag).
The game runs on the laptop alone and shows the Bias Mirror at the end, but nothing appears on the
host screen. Ask teams to call out their final cash.

**If a laptop refreshes or drops out:** reopen the same URL in the same browser. The team is restored
and any choices it made while offline are sent when it reconnects.

**Mistakes:** **◀ Back** returns to the previous phase. Teams keep their decisions.
