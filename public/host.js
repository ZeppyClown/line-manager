// Line Manager — host / projector dashboard
(() => {
  const $ = (s) => document.querySelector(s);
  const main = $('#main'), controls = $('#controls');
  const params = new URLSearchParams(location.search);
  let key = params.get('key') || sessionStorage.getItem('lm-host-key') || '';
  let ws = null, wsOpen = false, st = null, authed = false, err = '';
  const PHASES = ['lobby', 'r1', 'r1-reveal', 'r2', 'r2-reveal', 'final'];
  const PHASE_LABEL = { lobby: 'Lobby', r1: 'Round 1', 'r1-reveal': 'Round 1 results', r2: 'Round 2', 'r2-reveal': 'Round 2 results', final: 'Final' };
  // Rough time budget per screen (seconds), used only to tint the timer chip when a phase runs long.
  const PHASE_TARGET = { lobby: 90, r1: 150, 'r1-reveal': 40, r2: 160, 'r2-reveal': 40, final: 45 };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- optional effects (fx.js may be missing; never let it break the host) ----------
  function fx(name, ...args) {
    try {
      const F = window.FX;
      if (F && typeof F[name] === 'function') return F[name](...args);
    } catch (e) { console.warn('FX.' + name + ' failed', e); }
    return undefined;
  }
  fx('init', { defaultMuted: true });
  (() => {
    const btn = fx('muteButton');
    if (btn instanceof Element) { btn.classList.add('mute-slot'); $('#muteSlot').appendChild(btn); }
  })();

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { wsOpen = true; conn(); if (key) ws.send(JSON.stringify({ type: 'host', key })); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') { authed = true; err = ''; sessionStorage.setItem('lm-host-key', key); st = m.state; onState(); render(); }
      if (m.type === 'error') { authed = false; err = m.message; render(); }
    };
    ws.onclose = () => { wsOpen = false; conn(); setTimeout(connect, 1500); };
  }
  setInterval(() => { if (wsOpen) ws.send('{"type":"ping"}'); }, 25000);
  // Keep Render's free instance awake while the host page is open (it sleeps after 15 min without HTTP requests).
  setInterval(() => { fetch('/healthz', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);
  function conn() { $('#conn').classList.toggle('off', !wsOpen); }
  const cmd = (m) => ws && wsOpen && ws.send(JSON.stringify(m));

  // ---------- phase timer (client-side; survives a page reload via sessionStorage) ----------
  let timer = (() => { try { return JSON.parse(sessionStorage.getItem('lm-host-timer')) || {}; } catch (_) { return {}; } })();
  function trackPhase(phase) {
    if (timer.phase === phase) return;
    const now = Date.now();
    timer.phase = phase; timer.start = now;
    if (phase === 'lobby') timer.game = null;
    else if (phase === 'r1' && !timer.game) timer.game = now;
    sessionStorage.setItem('lm-host-timer', JSON.stringify(timer));
  }
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tickTimer() {
    const el = $('#timer');
    if (!st || !authed || !timer.start) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const now = Date.now(), el1 = now - timer.start;
    const over = el1 / 1000 > (PHASE_TARGET[st.phase] || 120);
    el.classList.toggle('over', over);
    el.innerHTML = `<span class="tl">${esc(PHASE_LABEL[st.phase])}</span><b>${mmss(el1)}</b>${timer.game && st.phase !== 'lobby' ? `<span class="tg">game ${mmss(now - timer.game)}</span>` : ''}`;
    el.title = `Time on this screen (aim for about ${mmss((PHASE_TARGET[st.phase] || 120) * 1000)})${timer.game ? ' · time since Round 1 started' : ''}`;
  }
  setInterval(tickTimer, 1000);

  // ---------- change tracking (for one-off animations and sounds) ----------
  let renderedPhase = null;     // phase of the last render: a different phase means "fresh" screen
  let seenTeams = new Set();    // lobby: which chips already popped in
  let prevReady = {};           // lobby: team id -> ready
  let prevCounts = {};          // live: team id -> decisions made this round
  let flashIds = new Set();     // live: rows to light up on this render
  let lastRing = 0;             // live: ring fraction on the previous render
  let counting = false;         // round-start countdown is running

  function onState() {
    trackPhase(st.phase);
    const playing = st.phase === 'r1' || st.phase === 'r2';
    const r = st.phase === 'r2' ? 1 : 0;
    flashIds = new Set();
    if (playing) {
      const fresh = renderedPhase !== st.phase;
      let any = false;
      for (const t of st.teams) {
        const n = t.rounds[r].choices.length;
        if (!fresh && prevCounts[t.id] != null && n > prevCounts[t.id]) { flashIds.add(t.id); any = true; }
        prevCounts[t.id] = n;
      }
      if (any) fx('sound', 'click');
    } else prevCounts = {};
    if (st.phase === 'lobby') {
      let joined = false, readied = false;
      for (const t of st.teams) {
        if (renderedPhase === 'lobby' && !(t.id in prevReady)) joined = true;
        else if (renderedPhase === 'lobby' && t.ready && !prevReady[t.id]) readied = true;
      }
      if (readied) fx('sound', 'coin'); else if (joined) fx('sound', 'click');
    }
  }

  // ---------- helpers ----------
  function pipsFor(t, r) {
    const n = t.rounds[r].choices.length;
    return [0, 1, 2].map((i) => `<span class="pip ${i < n ? 'done' : ''} ${i === n - 1 && flashIds.has(t.id) ? 'newpip' : ''}"></span>`).join('');
  }

  // Vertical bars. When `anim` is true the columns start at 0 and grow in (see growIn()).
  function bars(items, { height = Math.max(150, Math.min(300, H() - 560)), anim = false } = {}) {
    const max = 100;
    return `<div class="bars" style="height:${height}px">${items.map((it, i) => {
      const h = it.v == null ? 0 : Math.max(1, it.v / max * (height - 70));
      return `
        <div class="bar"><div class="val" ${anim && it.v != null ? `data-count="${it.v}" data-suffix="%"` : ''}>${it.v == null ? '–' : (anim ? 0 : it.v) + '%'}</div>
        <div class="col" style="height:${anim ? 0 : h}px;background:${it.color};transition-delay:${anim ? 0.15 + i * 0.25 : 0}s" ${anim ? `data-h="${h}px"` : ''}></div></div>`;
    }).join('')}</div>
      <div class="barlabels">${items.map((it) => `<div>${esc(it.label)}<small>${esc(it.note || '')}</small></div>`).join('')}</div>`;
  }

  // Animate freshly rendered bars and numbers up from zero.
  function growIn(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h; });
      root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w; });
      root.querySelectorAll('[data-count]').forEach((el, i) => countUp(el, +el.dataset.count, el.dataset.suffix || '', 0.15 + (i % 2) * 0.25));
    }));
  }
  function countUp(el, to, suffix, delay) {
    if (reduceMotion) { el.textContent = to + suffix; return; }
    const dur = 900, t0 = performance.now() + delay * 1000;
    const step = (now) => {
      if (!el.isConnected) return;
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- screens ----------
  function render() {
    $('#phaseName').textContent = st && authed ? '· ' + PHASE_LABEL[st.phase] : '';
    if (!authed) { renderKey(); tickTimer(); return; }
    controls.classList.remove('hidden');
    const fresh = renderedPhase !== st.phase;
    const screens = { lobby: renderLobby, r1: () => renderLive(0, fresh), r2: () => renderLive(1, fresh), 'r1-reveal': renderR1Reveal, 'r2-reveal': renderR2Reveal, final: renderFinal };
    (screens[st.phase] || renderLobby)(fresh);
    renderedPhase = st.phase;
    renderControls();
    tickTimer();
  }

  function renderKey() {
    controls.classList.add('hidden');
    main.innerHTML = `<div class="card keybox"><h2 style="margin-bottom:10px">Host login</h2>
      <form id="kf"><input type="text" id="k" placeholder="Host key" value="${esc(key)}"><button class="btn-primary" style="margin-top:14px;width:100%">Open dashboard</button></form>
      <div class="err" style="color:var(--bad);margin-top:10px">${esc(err)}</div></div>`;
    $('#kf').onsubmit = (e) => { e.preventDefault(); key = $('#k').value.trim(); cmd({ type: 'host', key }); };
  }

  // If the host page is opened via localhost, show the laptop's network address instead (students can't reach localhost).
  let joinUrl = location.origin;
  fetch('/info').then((r) => r.json()).then((i) => {
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    if (i.publicUrl) joinUrl = i.publicUrl; else if (local && i.lanUrl) joinUrl = i.lanUrl;
    if (st && st.phase === 'lobby') render();
  }).catch(() => {});
  const H = () => window.innerHeight;

  function renderLobby() {
    const url = joinUrl;
    const n = st.teams.length, ready = st.teams.filter((t) => t.ready).length;
    const allReady = n > 0 && ready === n;
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
          <div class="readybar ${allReady ? 'all' : ''}">
            <div class="rcount"><b>${ready}</b> of <b>${n}</b> team${n === 1 ? '' : 's'} ready</div>
            <div class="rtrack"><div style="width:${n ? ready / n * 100 : 0}%"></div></div>
            <div class="rnote">${!n ? 'Scan the code to join' : allReady ? 'Everyone is ready. Start when you are!' : 'Teams are playing the practice tutorial'}</div>
          </div>
          <div class="teams">${n ? st.teams.map((t) => {
            const isNew = !seenTeams.has(t.id), justReady = t.ready && prevReady[t.id] === false;
            return `
            <div class="card chip ${isNew ? 'pop' : ''} ${t.ready ? 'is-ready' : ''}">
              <div class="num">${t.num}</div>
              <div class="mid">
                <div class="nm">${esc(t.name)}</div>
                <span class="status ${t.ready ? 'ok' : ''} ${justReady ? 'flip' : ''}">${t.ready ? 'Ready ✓' : '<i></i>Learning…'}</span>
              </div>
              <span class="dot ${t.online ? '' : 'off'}" title="${t.online ? 'Online' : 'Offline'}"></span>
              <span class="pill ${t.condition}" data-toggle="${t.id}" title="Click to switch Round 1 condition">${t.condition === 'tag' ? 'Tag' : 'Control'}</span>
              <button class="x" data-remove="${t.id}" title="Remove team">×</button>
            </div>`;
          }).join('') : '<div class="empty">Waiting for teams to join…</div>'}</div>
          <p class="muted lobbynote">${n} team${n === 1 ? '' : 's'} joined. Odd teams play Round 1 without the payback tag (Control), even teams with it (Tag). Click a badge to switch.</p>
        </div>
      </div>`;
    seenTeams = new Set(st.teams.map((t) => t.id));
    prevReady = Object.fromEntries(st.teams.map((t) => [t.id, !!t.ready]));
    main.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => cmd({ type: 'toggleCondition', teamId: b.dataset.toggle }));
    main.querySelectorAll('[data-remove]').forEach((b) => b.onclick = () => { if (confirm('Remove this team?')) cmd({ type: 'removeTeam', teamId: b.dataset.remove }); });
  }

  function renderLive(r, fresh) {
    const teams = [...st.teams].sort((a, b) => b.rounds[r].cash - a.rounds[r].cash || a.num - b.num);
    const n = st.teams.length;
    const done = st.teams.filter((t) => t.rounds[r].done).length;
    const decided = st.teams.reduce((s, t) => s + t.rounds[r].choices.length, 0);
    const possible = n * 3;
    const frac = possible ? decided / possible : 0;
    const rulesSet = st.teams.filter((t) => t.rule).length;
    const C = 2 * Math.PI * 86;
    const from = fresh ? 0 : lastRing;
    main.innerHTML = `
      <div class="live">
        <div class="card board">
          <table><thead><tr><th>#</th><th>Team</th>${r === 0 ? '<th>Group</th>' : '<th>Rule card</th>'}<th>Decisions</th><th style="text-align:right">Cash</th></tr></thead>
          <tbody>${teams.map((t) => `<tr class="${flashIds.has(t.id) ? 'flash' : ''}">
            <td><span class="dot ${t.online ? '' : 'off'}" style="display:inline-block"></span> ${t.num}</td>
            <td class="tname">${esc(t.name)}</td>
            ${r === 0 ? `<td><span class="pill ${t.condition}">${t.condition === 'tag' ? 'Tag' : 'Control'}</span></td>`
              : `<td>${t.rule ? '<span class="rset ok">Set ✓</span>' : '<span class="rset">Choosing…</span>'}</td>`}
            <td><div class="pips">${pipsFor(t, r)}${t.rounds[r].done ? '<span class="donetag">done</span>' : ''}</div></td>
            <td class="cash">${t.rounds[r].choices.length ? usd(t.rounds[r].cash) : '–'}</td></tr>`).join('')}</tbody></table>
          <p class="muted boardnote">${done} of ${n} teams finished · which choices were right stays hidden until the reveal</p>
        </div>
        <div class="card chart livecard">
          <h3>${r === 0 ? 'Round 1 in progress' : 'Round 2 in progress'}</h3>
          <div class="sub">${r === 0 ? 'Odd teams: no tag · Even teams: payback tag' : 'Every team has all the nudges'}</div>
          <div class="ring ${frac >= 1 ? 'full' : ''}">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="86" class="track"/>
              <circle cx="100" cy="100" r="86" class="prog" id="ringProg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - from)}"/>
            </svg>
            <div class="ringlabel"><div class="rn">${decided}<span>/${possible}</span></div><div class="rl">decisions made</div></div>
          </div>
          <div class="livestats">
            <div><b>${done}</b><span>of ${n} teams finished</span></div>
            ${r === 1 ? `<div class="${n && rulesSet === n ? 'allset' : ''}"><b>${rulesSet}/${n}</b><span>Rules set</span></div>` : ''}
          </div>
        </div>
      </div>`;
    lastRing = frac;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const p = $('#ringProg'); if (p) p.style.strokeDashoffset = C * (1 - frac);
    }));
  }

  function renderR1Reveal(fresh) {
    const s = st.stats[0];
    const c = pct(s.control.badTaken, s.control.badSeen), t = pct(s.tag.badTaken, s.tag.badSeen);
    const cg = pct(s.control.goodTaken, s.control.goodSeen), tg = pct(s.tag.goodTaken, s.tag.goodSeen);
    const avg = (g) => g.done ? usd(g.cashSum / g.done) : '–';
    let verdict, means;
    if (c == null || t == null) {
      verdict = ['🤷', 'Not enough data in one of the groups.'];
      means = 'One group has no answered decisions, so there is nothing to compare yet.';
    } else if (t < c) {
      verdict = ['✅', `H1 supported: with the payback tag, teams bought ${c - t} percentage points fewer unpayable upgrades.`];
      means = 'Seeing how long an upgrade takes to pay back made it easier to walk away from money already spent.';
    } else if (t === c) {
      verdict = ['➖', 'No difference this time: the tag alone did not change choices.'];
      means = 'Both groups bought the unpayable upgrades at the same rate, so in this room the tag made no difference either way.';
    } else {
      verdict = ['❌', 'H1 not supported here: tag teams bought more unpayable upgrades.'];
      means = 'Knowing the payback time was not enough here: money already spent still pulled teams into finishing the job.';
    }
    const nTeams = (g) => st.teams.filter((x) => x.condition === g && x.rounds[0].choices.length).length;
    const sample = c != null && t != null ? ` Based on ${nTeams('control')} control and ${nTeams('tag')} tag teams, so treat it as a classroom demo, not proof.` : '';
    main.innerHTML = `
      <div class="reveal">
        <h1 class="brand">Round 1: did the payback tag help?</h1>
        <p class="lead">Two of the three offers could never earn their cost back before the shift ended. Both came with money already spent.</p>
        <div class="reveal-grid">
          <div class="card chart ${fresh ? 'pop' : ''}"><h3>Unpayable upgrades bought</h3><div class="sub">Lower is better</div>
            ${bars([{ label: 'Control', note: `avg cash ${avg(s.control)}`, v: c, color: '#a8673c' }, { label: 'Payback tag', note: `avg cash ${avg(s.tag)}`, v: t, color: 'var(--orange)' }], { anim: fresh })}</div>
          <div class="card chart ${fresh ? 'pop' : ''}" style="animation-delay:.1s"><h3>Good upgrade taken</h3><div class="sub">The quick-fix paid back in 3h. Higher is better</div>
            ${bars([{ label: 'Control', v: cg, color: '#a8673c' }, { label: 'Payback tag', v: tg, color: 'var(--orange)' }], { anim: fresh })}</div>
        </div>
        <div class="card verdict ${fresh ? 'pop late' : ''}"><span class="big">${verdict[0]}</span>
          <span><span>${esc(verdict[1])}${s.all.forced ? ` <small class="muted">(${s.all.forced} unanswered decision${s.all.forced === 1 ? '' : 's'} filled in by the host and left out of these numbers)</small>` : ''}</span>
          <span class="means">What this means: ${esc(means + sample)}</span></span></div>
      </div>`;
    if (fresh) growIn(main);
  }

  // Count rule cards and how each rule's teams did on the unpayable offers in Round 2.
  function ruleRows() {
    const rules = (window.LM && LM.RULES) || [];
    const counts = (st.stats && st.stats.rules) || {};
    const rows = rules.map((ru) => ({ id: ru.id, label: ru.short || ru.label, n: counts[ru.id] || 0, bad: 0, badSeen: 0 }));
    const unset = { id: null, label: 'No card chosen', n: 0, bad: 0, badSeen: 0 };
    for (const t of st.teams) {
      const rr = t.rounds[1];
      if (!rr.choices.length && !t.rule) continue;
      let row = rows.find((x) => x.id === t.rule);
      if (!row) { if (t.rule) continue; row = unset; row.n++; }
      for (const s of LM.simulate(1, rr.choices).steps) {
        if ((rr.forced && rr.forced[s.idx]) || s.ev.payable) continue;
        row.badSeen++; if (s.invested) row.bad++;
      }
    }
    if (unset.n) rows.push(unset);
    return rows;
  }

  function renderR2Reveal(fresh) {
    const a = st.stats[0].all, b = st.stats[1].all;
    const ctrlTeams = st.teams.filter((t) => t.condition === 'control');
    const r1c = st.stats[0].control, r2c = st.stats[1].control;
    const rows = ruleRows();
    const maxN = Math.max(1, ...rows.map((x) => x.n));
    const totalRules = rows.reduce((s, x) => s + x.n, 0);
    const h = Math.max(140, Math.min(290, H() - 580));
    main.innerHTML = `
      <div class="reveal">
        <h1 class="brand">Round 2: everyone had the nudges</h1>
        <p class="lead">Rule card · predict first · payback tag · money translation · New Manager check · scrap button · bottleneck glow</p>
        <div class="reveal-grid r2grid">
          <div class="card chart ${fresh ? 'pop' : ''}"><h3>Unpayable upgrades bought</h3><div class="sub">All teams · lower is better</div>
            ${bars([{ label: 'Round 1', v: pct(a.badTaken, a.badSeen), color: '#a8673c' }, { label: 'Round 2', v: pct(b.badTaken, b.badSeen), color: 'var(--orange)' }], { anim: fresh, height: h })}</div>
          <div class="card chart ${fresh ? 'pop' : ''}" style="animation-delay:.1s"><h3>Did we over-correct?</h3><div class="sub">Good upgrade taken · higher is better</div>
            ${bars([{ label: 'Round 1', v: pct(a.goodTaken, a.goodSeen), color: '#a8673c' }, { label: 'Round 2', v: pct(b.goodTaken, b.goodSeen), note: 'Freezer 3 fast-chill', color: 'var(--good)' }], { anim: fresh, height: h })}</div>
          <div class="card chart rules ${fresh ? 'pop' : ''}" style="animation-delay:.2s"><h3>Rules teams chose</h3><div class="sub">The rule card each team committed to before Round 2</div>
            ${totalRules ? `<div class="hbars">${rows.map((x, i) => {
              const w = x.n / maxN * 100;
              return `<div class="hrow ${x.id === 'payback' ? 'pb' : ''}">
                <div class="hl">${esc(x.label)}<small>${x.badSeen ? `bought ${x.bad} of ${x.badSeen} unpayable` : x.n ? 'no answered unpayable offers' : '&nbsp;'}</small></div>
                <div class="ht"><div class="hf" style="width:${fresh ? 0 : w}%;transition-delay:${fresh ? 0.2 + i * 0.12 : 0}s" ${fresh ? `data-w="${w}%"` : ''}></div></div>
                <div class="hn">${x.n}</div></div>`;
            }).join('')}</div>` : '<div class="empty" style="font-size:16px;padding:18px">No rule cards were chosen.</div>'}
          </div>
        </div>
        <div class="card verdict ${fresh ? 'pop late' : ''}"><span class="big">🔮</span><span>Predictions right: ${b.predSeen ? `${b.predRight}/${b.predSeen} (${pct(b.predRight, b.predSeen)}%)` : '–'}${ctrlTeams.length ? ` · Teams that had no tag in Round 1: ${pct(r1c.badTaken, r1c.badSeen) ?? '–'}% → ${pct(r2c.badTaken, r2c.badSeen) ?? '–'}% unpayable bought` : ''}${b.forced ? ` <small class="muted">· ${b.forced} host-filled decision${b.forced === 1 ? '' : 's'} excluded</small>` : ''}</span></div>
      </div>`;
    if (fresh) growIn(main);
  }

  function renderFinal(fresh) {
    const lb = st.leaderboard;
    const top = [lb[1], lb[0], lb[2]];
    const k = H() < 820 ? 0.55 : 1;
    const heights = [170 * k, 230 * k, 130 * k], colors = ['#a8673c', 'var(--orange)', '#c99a74'], places = top.map((t) => t && t.rank);
    const delay = [0.45, 0.9, 0]; // 3rd rises first, then 2nd, then 1st
    main.innerHTML = `
      <div class="reveal" style="text-align:center">
        <h1 class="brand">Final leaderboard</h1>
        <p class="lead">Now look at your laptop: your Bias Mirror shows what each choice cost you.</p>
        <div class="podium ${fresh ? 'rise' : ''}" id="podium">${top.map((t, i) => t ? `
          <div class="pod" style="--d:${delay[i]}s"><div class="nm">${esc(t.name)}</div><div class="cash">${usd(t.total)}</div>
          <div class="block" style="height:${heights[i]}px;background:${colors[i]}"><span>${places[i]}</span></div></div>` : '<div class="pod"></div>').join('')}</div>
        ${lb.length > 3 ? `<div class="card rest ${fresh ? 'pop late2' : ''}"><ol>${lb.slice(3).map((t) => `<li><span>${t.rank}. ${esc(t.name)}</span><span>${usd(t.total)}</span></li>`).join('')}</ol></div>` : ''}
        <p class="motto ${fresh ? 'pop late2' : ''}">“Sunk money is gone. Look forward.”</p>
      </div>`;
    if (fresh && lb.length) {
      setTimeout(() => {
        if (!st || st.phase !== 'final') return;
        const pods = main.querySelectorAll('.pod .block');
        const first = pods[1] || pods[0];
        const r = first ? first.getBoundingClientRect() : null;
        fx('confetti', { x: r ? r.left + r.width / 2 : innerWidth / 2, y: r ? r.top : innerHeight / 2, count: 160 });
        fx('sound', 'complete');
      }, reduceMotion ? 100 : 1500);
    }
  }

  // Projector countdown, then run `go`. Falls back to running `go` straight away without fx.js.
  function countdownThen(go) {
    let fired = false;
    const finish = () => { if (fired) return; fired = true; counting = false; go(); if (st) renderControls(); };
    if (!window.FX || typeof FX.countdown !== 'function') return finish();
    counting = true; renderControls();
    setTimeout(finish, 9000); // safety net if the overlay never reports back
    try {
      const p = FX.countdown(['3', '2', '1', 'Go!'], { onDone: finish });
      if (p && typeof p.then === 'function') p.then(finish, finish);
    } catch (e) { console.warn('countdown failed', e); finish(); }
  }

  function renderControls() {
    const i = PHASES.indexOf(st.phase);
    const next = PHASES[i + 1], prev = PHASES[i - 1];
    const nextLabel = { r1: 'Start Round 1 ▶', 'r1-reveal': 'Reveal Round 1 results', r2: 'Start Round 2 ▶', 'r2-reveal': 'Reveal Round 2 results', final: 'Final leaderboard 🏆' }[next];
    const playing = st.phase === 'r1' || st.phase === 'r2';
    const r = st.phase === 'r1' ? 0 : 1;
    const unfinished = playing ? st.teams.filter((t) => !t.rounds[r].done).length : 0;
    const allReady = st.phase === 'lobby' && st.teams.length > 0 && st.teams.every((t) => t.ready);
    controls.innerHTML = `
      <div class="steps">${PHASES.map((p) => `<span class="${p === st.phase ? 'on' : ''}">${PHASE_LABEL[p]}</span>`).join('')}</div>
      <div class="spacer"></div>
      ${prev ? `<button class="btn-ghost" id="back" ${counting ? 'disabled' : ''}>◀ Back</button>` : ''}
      ${playing ? `<button class="btn-ghost" id="force" ${unfinished ? '' : 'disabled'}>Finish for slow teams (${unfinished})</button>` : ''}
      ${st.phase === 'final' ? `<a href="/export.csv?key=${encodeURIComponent(key)}"><button class="btn-ghost">Export CSV</button></a>` : ''}
      <button class="btn-ghost" id="reset" title="Delete all teams and results" ${counting ? 'disabled' : ''}>Reset</button>
      ${next ? `<button class="btn-orange ${allReady && !counting ? 'glow' : ''}" id="next" ${(st.phase === 'lobby' && !st.teams.length) || counting ? 'disabled' : ''}>${counting ? 'Get ready…' : nextLabel}</button>` : ''}`;
    const on = (id, f) => { const el = $('#' + id); if (el) el.onclick = f; };
    on('next', () => {
      if (counting) return;
      if (playing && unfinished && !confirm(`${unfinished} team(s) still playing. Their missing decisions will count as "don't invest". Continue?`)) return;
      if (st.phase === 'lobby') {
        const learning = st.teams.filter((t) => !t.ready).length;
        if (learning && !confirm(`${learning} team${learning === 1 ? ' is' : 's are'} still in the tutorial. Start Round 1 anyway?`)) return;
      }
      if (playing && unfinished) cmd({ type: 'forceFinish' });
      if (next === 'r1' || next === 'r2') countdownThen(() => cmd({ type: 'setPhase', phase: next }));
      else cmd({ type: 'setPhase', phase: next });
    });
    on('back', () => { if (confirm(`Go back to ${PHASE_LABEL[prev]}?`)) cmd({ type: 'setPhase', phase: prev }); });
    on('force', () => { if (confirm('Fill missing decisions with "don\'t invest" for teams still playing?')) cmd({ type: 'forceFinish' }); });
    on('reset', () => { if (confirm('Reset the whole game? All teams and results will be deleted.') && confirm('Really reset? Export the CSV first if you need the data.')) cmd({ type: 'reset' }); });
  }

  connect();
  render();
})();
