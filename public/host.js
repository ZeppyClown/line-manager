// Line Manager — host / projector dashboard
(() => {
  const $ = (s) => document.querySelector(s);
  const main = $('#main'), controls = $('#controls');
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || sessionStorage.getItem('lm-host-key') || '';
  let ws = null, wsOpen = false, st = null, authed = false, err = '';
  const PHASES = ['lobby', 'r1', 'r1-reveal', 'r2', 'r2-reveal', 'final'];
  const PHASE_LABEL = { lobby: 'Lobby', r1: 'Round 1', 'r1-reveal': 'Round 1 results', r2: 'Round 2', 'r2-reveal': 'Round 2 results', final: 'Final' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { wsOpen = true; conn(); if (key) ws.send(JSON.stringify({ type: 'host', key })); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') { authed = true; err = ''; sessionStorage.setItem('lm-host-key', key); st = m.state; render(); }
      if (m.type === 'error') { authed = false; err = m.message; render(); }
    };
    ws.onclose = () => { wsOpen = false; conn(); setTimeout(connect, 1500); };
  }
  setInterval(() => { if (wsOpen) ws.send('{"type":"ping"}'); }, 25000);
  // Keep Render's free instance awake while the host page is open (it sleeps after 15 min without HTTP requests).
  setInterval(() => { fetch('/healthz', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);
  function conn() { $('#conn').classList.toggle('off', !wsOpen); }
  const cmd = (m) => ws && wsOpen && ws.send(JSON.stringify(m));

  // ---------- helpers ----------
  function pipsFor(t, r) {
    const ch = t.rounds[r].choices;
    const sim = LM.simulate(r, ch);
    return [0, 1, 2].map((i) => {
      const s = sim.steps[i];
      if (!s) return '<span class="pip"></span>';
      const cls = s.invested ? (s.ev.payable ? 'good' : 'bad') : (s.ev.payable ? 'skipgood' : 'skip');
      return `<span class="pip ${cls}" title="${esc(s.ev.offer.title)}: ${s.invested ? 'invested' : 'skipped'}"></span>`;
    }).join('');
  }

  function bars(items, { height = 300 } = {}) {
    const max = 100;
    return `<div class="bars" style="height:${height}px">${items.map((it) => `
        <div class="bar"><div class="val">${it.v == null ? '–' : it.v + '%'}</div>
        <div class="col" style="height:${it.v == null ? 0 : Math.max(1, it.v / max * (height - 70))}px;background:${it.color}"></div></div>`).join('')}</div>
      <div class="barlabels">${items.map((it) => `<div>${esc(it.label)}<small>${esc(it.note || '')}</small></div>`).join('')}</div>`;
  }

  // ---------- screens ----------
  function render() {
    $('#phaseName').textContent = st ? '· ' + PHASE_LABEL[st.phase] : '';
    if (!authed) return renderKey();
    controls.classList.remove('hidden');
    ({ lobby: renderLobby, r1: () => renderLive(0), r2: () => renderLive(1), 'r1-reveal': renderR1Reveal, 'r2-reveal': renderR2Reveal, final: renderFinal })[st.phase]();
    renderControls();
  }

  function renderKey() {
    controls.classList.add('hidden');
    main.innerHTML = `<div class="card keybox"><h2 style="margin-bottom:10px">Host login</h2>
      <form id="kf"><input type="text" id="k" placeholder="Host key" value="${esc(key)}"><button class="btn-primary" style="margin-top:14px;width:100%">Open dashboard</button></form>
      <div class="err" style="color:var(--bad);margin-top:10px">${esc(err)}</div></div>`;
    $('#kf').onsubmit = (e) => { e.preventDefault(); key = $('#k').value.trim(); cmd({ type: 'host', key }); };
  }

  function renderLobby() {
    const url = location.origin;
    main.innerHTML = `
      <div class="lobby">
        <div class="card joinbox">
          <div class="muted" style="font-weight:600">One laptop per team. Join at</div>
          <div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>
          <img src="/qr.svg?u=${encodeURIComponent(url)}" alt="QR code">
        </div>
        <div>
          <h1 class="brand">Line Manager</h1>
          <p class="tagline">Run a factory for one 24-hour shift. Three decisions per round. Highest cash wins.</p>
          <div class="teams">${st.teams.length ? st.teams.map((t) => `
            <div class="card chip pop">
              <div class="num">${t.num}</div>
              <div class="nm">${esc(t.name)}</div>
              <span class="dot ${t.online ? '' : 'off'}"></span>
              <span class="pill ${t.condition}" data-toggle="${t.id}" title="Click to switch Round 1 condition">${t.condition === 'tag' ? 'Tag' : 'Control'}</span>
              <button class="x" data-remove="${t.id}" title="Remove team">×</button>
            </div>`).join('') : '<div class="empty">Waiting for teams to join…</div>'}</div>
          <p class="muted" style="font-size:15px;margin-top:16px">${st.teams.length} team${st.teams.length === 1 ? '' : 's'} joined. Odd teams play Round 1 without the payback tag (Control), even teams with it (Tag). Click a badge to switch.</p>
        </div>
      </div>`;
    main.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => cmd({ type: 'toggleCondition', teamId: b.dataset.toggle }));
    main.querySelectorAll('[data-remove]').forEach((b) => b.onclick = () => { if (confirm('Remove this team?')) cmd({ type: 'removeTeam', teamId: b.dataset.remove }); });
  }

  function renderLive(r) {
    const teams = [...st.teams].sort((a, b) => b.rounds[r].cash - a.rounds[r].cash || a.num - b.num);
    const done = st.teams.filter((t) => t.rounds[r].done).length;
    const s = st.stats[r];
    const chart = r === 0
      ? bars([
        { label: 'Control', note: `no tag · ${s.control.badTaken}/${s.control.badSeen} offers`, v: pct(s.control.badTaken, s.control.badSeen), color: '#a8673c' },
        { label: 'Payback tag', note: `${s.tag.badTaken}/${s.tag.badSeen} offers`, v: pct(s.tag.badTaken, s.tag.badSeen), color: 'var(--orange)' },
      ], { height: 280 })
      : bars([
        { label: 'Round 1', note: `${st.stats[0].all.badTaken}/${st.stats[0].all.badSeen} offers`, v: pct(st.stats[0].all.badTaken, st.stats[0].all.badSeen), color: '#a8673c' },
        { label: 'Round 2', note: `all nudges · ${s.all.badTaken}/${s.all.badSeen}`, v: pct(s.all.badTaken, s.all.badSeen), color: 'var(--orange)' },
      ], { height: 280 });
    main.innerHTML = `
      <div class="live">
        <div class="card board">
          <table><thead><tr><th>#</th><th>Team</th>${r === 0 ? '<th>Group</th>' : ''}<th>Decisions</th><th style="text-align:right">Cash</th></tr></thead>
          <tbody>${teams.map((t) => `<tr>
            <td><span class="dot ${t.online ? '' : 'off'}" style="display:inline-block"></span> ${t.num}</td>
            <td style="font-weight:700;font-size:20px">${esc(t.name)}</td>
            ${r === 0 ? `<td><span class="pill ${t.condition}">${t.condition === 'tag' ? 'Tag' : 'Control'}</span></td>` : ''}
            <td><div class="pips">${pipsFor(t, r)}</div></td>
            <td class="cash">${t.rounds[r].choices.length ? usd(t.rounds[r].cash) : '–'}</td></tr>`).join('')}</tbody></table>
          <p class="muted" style="font-size:14px;margin:12px 0 0">${done} of ${st.teams.length} teams finished · <span class="pip bad" style="display:inline-block;width:12px;height:12px;vertical-align:-1px"></span> bought an upgrade that can't pay back · <span class="pip good" style="display:inline-block;width:12px;height:12px;vertical-align:-1px"></span> bought a good one · <span class="pip skip" style="display:inline-block;width:12px;height:12px;vertical-align:-1px"></span> skipped</p>
        </div>
        <div class="card chart">
          <h3>Upgrades bought that could not pay back</h3>
          <div class="sub">Share of unpayable offers each group paid for (live)</div>
          ${chart}
        </div>
      </div>`;
  }

  function renderR1Reveal() {
    const s = st.stats[0];
    const c = pct(s.control.badTaken, s.control.badSeen), t = pct(s.tag.badTaken, s.tag.badSeen);
    const cg = pct(s.control.goodTaken, s.control.goodSeen), tg = pct(s.tag.goodTaken, s.tag.goodSeen);
    const avg = (g) => g.done ? usd(g.cashSum / g.done) : '–';
    let verdict;
    if (c == null || t == null) verdict = ['🤷', 'Not enough data in one of the groups.'];
    else if (t < c) verdict = ['✅', `H1 supported: with the payback tag, teams bought ${c - t} points fewer unpayable upgrades.`];
    else if (t === c) verdict = ['➖', 'No difference this time: the tag alone did not change choices.'];
    else verdict = ['❌', 'H1 not supported here: tag teams bought more unpayable upgrades.'];
    main.innerHTML = `
      <div class="reveal">
        <h1 class="brand">Round 1: did the payback tag help?</h1>
        <p class="lead">Two of the three offers could never earn their cost back before the shift ended. Both came with money already spent.</p>
        <div class="reveal-grid">
          <div class="card chart pop"><h3>Unpayable upgrades bought</h3><div class="sub">Lower is better</div>
            ${bars([{ label: 'Control', note: `avg cash ${avg(s.control)}`, v: c, color: '#a8673c' }, { label: 'Payback tag', note: `avg cash ${avg(s.tag)}`, v: t, color: 'var(--orange)' }])}</div>
          <div class="card chart pop"><h3>Good upgrade taken</h3><div class="sub">The quick-fix paid back in 3h. Higher is better</div>
            ${bars([{ label: 'Control', v: cg, color: '#a8673c' }, { label: 'Payback tag', v: tg, color: 'var(--orange)' }])}</div>
        </div>
        <div class="card verdict pop"><span class="big">${verdict[0]}</span><span>${esc(verdict[1])}</span></div>
      </div>`;
  }

  function renderR2Reveal() {
    const a = st.stats[0].all, b = st.stats[1].all;
    const ctrlTeams = st.teams.filter((t) => t.condition === 'control');
    const r1c = st.stats[0].control, r2c = st.stats[1].control;
    main.innerHTML = `
      <div class="reveal">
        <h1 class="brand">Round 2: everyone had the nudges</h1>
        <p class="lead">Predict first · payback tag · New Manager check · scrap button · bottleneck glow</p>
        <div class="reveal-grid">
          <div class="card chart pop"><h3>Unpayable upgrades bought</h3><div class="sub">All teams · lower is better</div>
            ${bars([{ label: 'Round 1', v: pct(a.badTaken, a.badSeen), color: '#a8673c' }, { label: 'Round 2', v: pct(b.badTaken, b.badSeen), color: 'var(--orange)' }])}</div>
          <div class="card chart pop"><h3>Did we over-correct?</h3><div class="sub">Good upgrade taken · higher is better</div>
            ${bars([{ label: 'Round 1', v: pct(a.goodTaken, a.goodSeen), color: '#a8673c' }, { label: 'Round 2', v: pct(b.goodTaken, b.goodSeen), note: 'Freezer 3 fast-chill', color: 'var(--good)' }])}</div>
        </div>
        <div class="card verdict pop"><span class="big">🔮</span><span>Predictions right: ${b.predSeen ? `${b.predRight}/${b.predSeen} (${pct(b.predRight, b.predSeen)}%)` : '–'}${ctrlTeams.length ? ` · Teams that had no tag in Round 1: ${pct(r1c.badTaken, r1c.badSeen) ?? '–'}% → ${pct(r2c.badTaken, r2c.badSeen) ?? '–'}% unpayable bought` : ''}</span></div>
      </div>`;
  }

  function renderFinal() {
    const lb = st.leaderboard;
    const top = [lb[1], lb[0], lb[2]];
    const heights = [170, 230, 130], colors = ['#a8673c', 'var(--orange)', '#c99a74'], places = [2, 1, 3];
    main.innerHTML = `
      <div class="reveal" style="text-align:center">
        <h1 class="brand">Final leaderboard</h1>
        <p class="lead">Now look at your laptop: your Bias Mirror shows what each choice cost you.</p>
        <div class="podium">${top.map((t, i) => t ? `
          <div class="pod pop" style="animation-delay:${[.3, .6, 0][i]}s"><div class="nm">${esc(t.name)}</div><div class="cash">${usd(t.total)}</div>
          <div class="block" style="height:${heights[i]}px;background:${colors[i]}">${places[i]}</div></div>` : '<div class="pod"></div>').join('')}</div>
        ${lb.length > 3 ? `<div class="card rest"><ol>${lb.slice(3).map((t, i) => `<li><span>${i + 4}. ${esc(t.name)}</span><span>${usd(t.total)}</span></li>`).join('')}</ol></div>` : ''}
        <p style="font-size:30px;font-weight:800;margin-top:30px">“Sunk money is gone. Look forward.”</p>
      </div>`;
  }

  function renderControls() {
    const i = PHASES.indexOf(st.phase);
    const next = PHASES[i + 1], prev = PHASES[i - 1];
    const nextLabel = { r1: 'Start Round 1 ▶', 'r1-reveal': 'Reveal Round 1 results', r2: 'Start Round 2 ▶', 'r2-reveal': 'Reveal Round 2 results', final: 'Final leaderboard 🏆' }[next];
    const playing = st.phase === 'r1' || st.phase === 'r2';
    const r = st.phase === 'r1' ? 0 : 1;
    const unfinished = playing ? st.teams.filter((t) => !t.rounds[r].done).length : 0;
    controls.innerHTML = `
      <div class="steps">${PHASES.map((p) => `<span class="${p === st.phase ? 'on' : ''}">${PHASE_LABEL[p]}</span>`).join('')}</div>
      <div class="spacer"></div>
      ${prev ? `<button class="btn-ghost" id="back">◀ Back</button>` : ''}
      ${playing ? `<button class="btn-ghost" id="force" ${unfinished ? '' : 'disabled'}>Finish for slow teams (${unfinished})</button>` : ''}
      ${st.phase === 'final' ? `<a href="/export.csv?key=${encodeURIComponent(key)}"><button class="btn-ghost">Export CSV</button></a><button class="btn-ghost" id="reset">Reset game</button>` : ''}
      ${next ? `<button class="btn-orange" id="next" ${st.phase === 'lobby' && !st.teams.length ? 'disabled' : ''}>${nextLabel}</button>` : ''}`;
    const on = (id, f) => { const el = $('#' + id); if (el) el.onclick = f; };
    on('next', () => {
      if (playing && unfinished && !confirm(`${unfinished} team(s) still playing. Their missing decisions will count as "don't invest". Continue?`)) return;
      if (playing && unfinished) cmd({ type: 'forceFinish' });
      cmd({ type: 'setPhase', phase: next });
    });
    on('back', () => { if (confirm(`Go back to ${PHASE_LABEL[prev]}?`)) cmd({ type: 'setPhase', phase: prev }); });
    on('force', () => { if (confirm('Fill missing decisions with "don\'t invest" for teams still playing?')) cmd({ type: 'forceFinish' }); });
    on('reset', () => { if (confirm('Reset the whole game? All teams and results will be deleted.') && confirm('Really reset? Export the CSV first if you need the data.')) cmd({ type: 'reset' }); });
  }

  connect();
  render();
})();
