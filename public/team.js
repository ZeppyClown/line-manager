// Line Manager — team laptop client
(() => {
  const $ = (s) => document.querySelector(s);
  const main = $('#main');
  const params = new URLSearchParams(location.search);
  let OFFLINE = params.has('offline');
  const LS_KEY = 'lm-team-id';
  const { ROUNDS, CHECKPOINTS, SHIFT_HOURS, START_CASH, DECISION_SECONDS } = LM;

  let srv = null;            // last state from server (or local emulation offline)
  let ws = null, wsOpen = false, joined = false, backoff = 1000;
  let pending = [];          // decide messages not yet confirmed by the server
  let localChoices = [[], []];
  let dec = null;            // { round, idx, stage: 'predict'|'choose', prediction, startedAt }
  let sim = null;            // { round, idx, t0, dur, from, to, step }
  let screenKey = '';
  let joinError = '';
  let busyJoin = false;
  let simTimer = null, simSeq = 0;
  const PLAY_PHASE = ['r1', 'r2'];
  const PHASE_ORDER = ['lobby', 'r1', 'r1-reveal', 'r2', 'r2-reveal', 'final'];
  const LOCAL_KEY = 'lm-team-local';
  const OFFLINE_KEY = 'lm-offline-game';
  let notice = '';           // shown on the done screen if the server overrode a click
  let inactive = false;      // another tab took over this team
  let lastMsgAt = Date.now();
  const tabId = Math.random().toString(36).slice(2);
  const tabs = 'BroadcastChannel' in window ? new BroadcastChannel('lm-tabs') : null;

  // Persist in-flight work so a refresh mid-decision keeps the clock, prediction and unsent choices.
  function persist() {
    if (inactive) return;
    if (OFFLINE) { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify({ srv, dec })); } catch (_) {} return; }
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ teamId: localStorage.getItem(LS_KEY), pending, localChoices, dec })); } catch (_) {}
  }
  function restore() {
    if (OFFLINE) {
      try { const d = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null'); if (d && d.srv && d.srv.you) { srv = d.srv; dec = d.dec || null; } } catch (_) {}
      return;
    }
    try {
      const d = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (!d || !d.teamId || d.teamId !== localStorage.getItem(LS_KEY)) return;
      pending = Array.isArray(d.pending) ? d.pending : [];
      localChoices = Array.isArray(d.localChoices) && d.localChoices.length === 2 ? d.localChoices : [[], []];
      dec = d.dec && typeof d.dec.startedAt === 'number' ? d.dec : null;
    } catch (_) {}
  }
  function joinKey() {
    let k = localStorage.getItem('lm-join-key');
    if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('lm-join-key', k); }
    return k;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

  // ---------- networking ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      wsOpen = true; backoff = 1000; updateConn();
      const id = localStorage.getItem(LS_KEY);
      if (id) ws.send(JSON.stringify({ type: 'join', teamId: id }));
      else if (localStorage.getItem('lm-join-pending')) ws.send(JSON.stringify({ type: 'join', joinKey: joinKey() }));
    };
    ws.onmessage = (e) => { lastMsgAt = Date.now(); try { onMsg(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = onClosed;
  }
  function onClosed() {
    wsOpen = false; joined = false; updateConn();
    if (busyJoin) { busyJoin = false; joinError = 'Connection dropped. Press Join again.'; render(true); }
    if (OFFLINE || inactive) return;
    setTimeout(connect, backoff); backoff = Math.min(backoff * 1.6, 5000);
  }
  function dropSocket() { if (!ws) return; const old = ws; old.onclose = null; old.onmessage = null; try { old.close(); } catch (_) {} ws = null; onClosed(); }
  // Heartbeat: a silent Wi-Fi drop never fires "close", so treat 20 s of silence as a disconnect.
  setInterval(() => {
    if (!wsOpen) return;
    if (Date.now() - lastMsgAt > 20000) return dropSocket();
    ws.send('{"type":"ping"}');
  }, 8000);

  // One live tab per laptop: the newest tab takes over, older ones pause.
  if (tabs) tabs.onmessage = (e) => {
    if (e.data && e.data.type === 'claim' && e.data.tabId !== tabId && !inactive) {
      inactive = true; dec = null; cancelSim();
      if (ws) { const old = ws; old.onclose = null; try { old.close(); } catch (_) {} ws = null; wsOpen = false; }
      screenKey = ''; renderInactive();
    }
  };
  function claimTab() { if (tabs) tabs.postMessage({ type: 'claim', tabId }); }
  function renderInactive() {
    main.innerHTML = `<div class="center"><div class="card pop"><h1 class="brand" style="font-size:34px">Open in another tab</h1>
      <p>This team is being played in another browser tab. Use that one, or continue here.</p>
      <button class="btn-primary" id="useHere">Use this tab</button></div></div>`;
    $('#useHere').onclick = () => { inactive = false; claimTab(); restore(); screenKey = ''; if (OFFLINE) render(); else connect(); };
  }

  function onMsg(msg) {
    if (msg.type === 'joined') {
      localStorage.setItem(LS_KEY, msg.teamId); localStorage.removeItem('lm-join-pending'); joined = true; busyJoin = false; joinError = '';
      flush();
    } else if (msg.type === 'state') {
      const prevId = srv && srv.you && srv.you.id;
      srv = msg;
      if (prevId && prevId !== msg.you.id) resetLocal();
      // The server is authoritative: drop local choices it contradicts (host force-finish), and once a
      // round is no longer being played, anything it never received is void.
      for (const r of [0, 1]) {
        const s = msg.you.rounds[r].choices;
        const roundOpen = msg.phase === PLAY_PHASE[r];
        if (!roundOpen || localChoices[r].slice(0, s.length).join() !== s.join()) localChoices[r] = s.slice();
      }
      pending = pending.filter((p) => msg.phase === PLAY_PHASE[p.round] && msg.you.rounds[p.round].choices.length <= p.idx);
      if (sim) {
        const sc = msg.you.rounds[sim.round].choices[sim.idx];
        if (sc && sc !== sim.step.choice) { cancelSim(); notice = 'The host ended the round before your last click arrived, so nothing was bought.'; }
      }
      persist();
      render();
    } else if (msg.type === 'needName' || msg.type === 'kicked') {
      localStorage.removeItem(LS_KEY); localStorage.removeItem(LOCAL_KEY); localStorage.removeItem('lm-join-pending'); localStorage.removeItem('lm-join-key');
      srv = null; joined = false; busyJoin = false; resetLocal(); render();
    } else if (msg.type === 'error') {
      joinError = msg.message; busyJoin = false; render(true);
    }
  }

  function resetLocal() { localChoices = [[], []]; pending = []; dec = null; cancelSim(); }
  function cancelSim() { sim = null; simSeq++; clearTimeout(simTimer); }

  function flush() {
    if (OFFLINE || inactive || !wsOpen || !joined) return;
    for (const p of pending) ws.send(JSON.stringify(p));
  }

  function updateConn() {
    const el = $('#conn');
    if (OFFLINE || !srv) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('off', !wsOpen);
    el.title = wsOpen ? 'Connected' : 'Reconnecting… your choices are saved and will sync';
  }

  // ---------- offline emulation ----------
  function goOffline() {
    OFFLINE = true;
    if (ws) { const old = ws; old.onclose = null; try { old.close(); } catch (_) {} ws = null; wsOpen = false; }
    try { history.replaceState(null, '', '/?offline'); } catch (_) {}
    srv = null; resetLocal(); restore(); screenKey = ''; render();
  }
  function offlineJoin(name, condChoice) {
    const cond = (condChoice || params.get('cond')) === 'tag' ? 'tag' : 'control';
    srv = { phase: 'r1', you: { id: 'offline', num: 1, name, condition: cond, rounds: [rec(), rec()] }, teamCount: 1 };
    function rec() { return { choices: [], predictions: [], timedOut: [], ms: [], forced: [] }; }
    persist(); render();
  }
  function offlineApply(m) {
    const r = srv.you.rounds[m.round];
    r.choices.push(m.choice); r.predictions[m.idx] = m.prediction; r.timedOut[m.idx] = m.timedOut; r.ms[m.idx] = m.ms;
    persist();
  }
  function offlineAdvance(phase) {
    srv.phase = phase;
    if (phase === 'final') {
      const total = srv.you.rounds.reduce((s, r, i) => s + LM.simulate(i, r.choices).cash, 0);
      srv.rank = 1; srv.leaderboard = [{ num: 1, name: srv.you.name, total, rank: 1 }];
    }
    persist(); render();
  }

  // ---------- derived ----------
  function choicesFor(r) {
    const s = (srv && srv.you && srv.you.rounds[r].choices) || [];
    const l = localChoices[r];
    return l.length > s.length ? s.concat(l.slice(s.length)) : s.slice();
  }
  function predictionsFor(r) { return (srv && srv.you && srv.you.rounds[r].predictions) || []; }
  function playRound() { return srv && srv.phase === 'r1' ? 0 : srv && srv.phase === 'r2' ? 1 : null; }
  function showTag(r) { return r === 1 || (srv && srv.you.condition === 'tag'); }

  // ---------- header ----------
  function setHeader() {
    const you = srv && srv.you;
    const pill = $('#teamPill');
    if (you) { pill.textContent = `Team ${you.num} · ${you.name}`; pill.classList.remove('hidden'); } else pill.classList.add('hidden');
    updateConn();
  }

  // ---------- render ----------
  function render(force) {
    if (inactive) return;
    let key, fn;
    if (srv && sim && sim.round !== playRound()) cancelSim();
    if (srv && dec && dec.round !== playRound()) { dec = null; persist(); }
    if (!srv || !srv.you) { key = 'join'; fn = renderJoin; }
    else if (srv.phase === 'lobby') { key = 'lobby'; fn = renderLobby; }
    else if (playRound() != null) {
      const r = playRound();
      const n = choicesFor(r).length;
      if (sim && sim.round === r) { key = `sim-${r}-${sim.idx}`; fn = renderSim; }
      else if (n >= 3) { dec = null; key = `done-${r}-${choicesFor(r).join('')}`; fn = () => renderDone(r); }
      else {
        if (!dec || dec.round !== r || dec.idx !== n) { dec = { round: r, idx: n, stage: r === 1 ? 'predict' : 'choose', prediction: null, startedAt: Date.now() }; persist(); }
        key = `dec-${r}-${n}-${dec.stage}`; fn = renderDecision;
      }
    } else if (srv.phase === 'final') { key = 'final-' + JSON.stringify([choicesFor(0), choicesFor(1), srv.rank, srv.leaderboard]); fn = renderFinal; }
    else { key = 'reveal-' + srv.phase + '-' + choicesFor(0).join('') + choicesFor(1).join(''); fn = renderReveal; }
    document.body.classList.toggle('playing', /^(dec|sim|done)-/.test(key));
    if (key !== screenKey || force) { screenKey = key; fn(); }
    else if (key === 'lobby') fn();
  }

  function renderJoin() {
    setHeader();
    main.innerHTML = `
      <div class="center"><div class="card pop">
        <h1 class="brand">Line Manager</h1>
        <p class="muted">Run a factory for one 24-hour shift. Make the most money.<br>One laptop per team.</p>
        <form id="joinForm" class="join-row">
          <input id="name" type="text" maxlength="24" placeholder="Team name" autocomplete="off" autofocus>
          <button class="btn-primary" id="joinBtn" type="submit">Join</button>
        </form>
        <div class="err">${esc(joinError)}</div>
        ${OFFLINE ? `<div class="offgrp"><span>Offline mode: this laptop plays on its own. Your group:</span>
            <label><input type="radio" name="cond" value="control" ${params.get('cond') === 'tag' ? '' : 'checked'}> Odd team</label>
            <label><input type="radio" name="cond" value="tag" ${params.get('cond') === 'tag' ? 'checked' : ''}> Even team</label></div>`
          : '<p class="muted" style="font-size:13px;margin-top:18px">Wi-Fi trouble? <button type="button" class="linkbtn" id="goOff">Play offline</button></p>'}
      </div></div>`;
    const name = $('#name');
    const off = $('#goOff'); if (off) off.onclick = goOffline;
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) { joinError = 'Please enter a team name.'; return render(true); }
      if (OFFLINE) { const c = main.querySelector('input[name=cond]:checked'); return offlineJoin(v, c && c.value); }
      if (!wsOpen) { joinError = 'Connecting to the game… try again in a moment.'; return render(true); }
      busyJoin = true; $('#joinBtn').disabled = true;
      localStorage.setItem('lm-join-pending', '1');
      ws.send(JSON.stringify({ type: 'join', name: v, joinKey: joinKey() }));
    };
  }

  function renderLobby() {
    setHeader();
    main.innerHTML = `
      <div class="center"><div class="card pop">
        <div class="pill" style="margin-bottom:14px">Team ${srv.you.num}</div>
        <h1 class="brand" style="font-size:44px">${esc(srv.you.name)}</h1>
        <p>You're in. Waiting for the host to start Round 1.</p>
        <p class="muted" style="font-size:15px">${srv.teamCount} team${srv.teamCount === 1 ? '' : 's'} joined · Each round: 3 decisions, ${DECISION_SECONDS} seconds each. Highest cash wins.</p>
        <p class="muted" style="font-size:13px;margin-top:10px">Tip: press F11 (Ctrl+Cmd+F on Mac) for full screen</p>
      </div></div>`;
  }

  // ================= factory map UI =================
  const ICONS = {
    saw: '<circle cx="12" cy="12" r="7"/><path d="M12 2.5l1.6 3M21.5 12l-3 1.6M12 21.5l-1.6-3M2.5 12l3-1.6M18.7 5.3l-2.4 2.4M18.7 18.7l-2.4-2.4M5.3 18.7l2.4-2.4M5.3 5.3l2.4 2.4"/><circle cx="12" cy="12" r="2"/>',
    flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.6-5.3 3.6-8.3.9 1.6 1.5 2.6 2.6 3.2C12 7 13 4.6 15.5 3c-.4 3 3 5.6 3 10.8 0 4.4-2.8 7.2-6.5 7.2z"/><path d="M12 21c-1.7 0-3-1.2-3-3 0-2 1.7-3 2.3-4.8C12.6 15 15 15.6 15 18c0 1.8-1.3 3-3 3z"/>',
    drop: '<path d="M12 3c3.5 4.6 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.4 6-11z"/><path d="M9.2 14.5a2.9 2.9 0 0 0 2.8 2.8"/>',
    box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
    whisk: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M15 4l-3.5 7.5M18 6l-5 5.5"/>',
    press: '<path d="M4 4h16M4 20h16M7 4v4h10V4M7 20v-4h10v4"/><path d="M12 9.5v5M10 12.5l2 2 2-2"/>',
    snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2"/>',
    crate: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9 5v14M15 5v14"/>',
  };
  const icon = (k, size = 34) => `<g transform="translate(${-size / 2},${-size / 2}) scale(${size / 24})" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</g>`;

  function belt(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  // Map of the factory as SVG. opts: target (machine id of the current offer), bumped, saving
  function mapSVG(r, st, opts = {}) {
    const round = ROUNDS[r];
    const fl = LM.flows(round, st);
    const nudges = r === 1;                   // bottleneck glow + pile-ups are Round 2 nudges
    const glow = nudges ? LM.bottleneckIds(round, st) : [];
    const pos = {};
    round.machines.forEach((m) => pos[m.id] = m);
    round.supplies.forEach((s) => pos[s.id] = s);
    pos.sell = { x: round.sell.x, y: round.sell.y };
    const R_M = 50, R_S = 36, R_SELL = 38;
    const rad = (id) => (id === 'sell' ? R_SELL : pos[id].to ? R_S : R_M);
    let belts = '', items = '', piles = '';
    fl.edges.forEach((e, i) => {
      const a = pos[e.from], b = pos[e.to];
      const d = belt(a.x + rad(e.from) - 4, a.y, b.x - rad(e.to) + 4, b.y);
      belts += `<path d="${d}" class="bed"/><path d="${d}" class="tread"/><path id="belt${r}-${i}" d="${d}" fill="none" stroke="none"/>`;
      const n = 3, dur = Math.max(1.4, 16 / Math.max(e.flow, 1));
      for (let k = 0; k < n; k++) items += `<g class="item"><rect x="-5" y="-5" width="10" height="10" rx="2.5"/><animateMotion dur="${dur.toFixed(2)}s" repeatCount="indefinite" begin="${(-k * dur / n).toFixed(2)}s"><mpath href="#belt${r}-${i}"/></animateMotion></g>`;
      if (nudges && e.pile > 0) {
        // pile of waiting items sits at the middle of the belt; label goes on the outside of the curve
        const px = (a.x + rad(e.from) + b.x - rad(e.to)) / 2, py = (a.y + b.y) / 2, up = a.y <= b.y;
        piles += `<g class="pile" transform="translate(${px},${py})">
          <rect x="-24" y="-7" width="12" height="12" rx="2.5"/><rect x="-10" y="-7" width="12" height="12" rx="2.5"/><rect x="-17" y="-20" width="12" height="12" rx="2.5"/>
          <g transform="translate(${up ? 66 : -84},${up ? -46 : 12})"><rect class="chip" x="-62" y="-13" width="124" height="26" rx="13"/><text y="5">+${e.pile}/hr piling up</text></g></g>`;
      }
    });
    const supplies = round.supplies.map((s) => `
      <g class="node supply" transform="translate(${s.x},${s.y})" data-node="${s.id}">
        <circle r="${R_S}" class="disc"/>${icon('crate', 28)}
        <g transform="translate(0,${R_S + 24})"><rect class="label" x="-56" y="-16" width="112" height="42" rx="11"/><text class="nm" y="0">${esc(s.name)}</text><text class="rt" y="18">${s.rate}/hr</text></g>
      </g>`).join('');
    const machines = round.machines.map((m) => {
      const util = fl.prod[m.id] / st.rates[m.id];
      const circ = 2 * Math.PI * (R_M + 7);
      return `
      <g class="node machine ${glow.includes(m.id) ? 'glow' : ''} ${opts.target === m.id ? 'target' : ''} ${opts.bumped === m.id ? 'bumped' : ''}" transform="translate(${m.x},${m.y})" data-node="${m.id}">
        ${glow.includes(m.id) ? `<circle r="${R_M + 16}" class="halo"/>` : ''}
        ${opts.target === m.id ? `<circle r="${R_M + 12}" class="ring"/>` : ''}
        ${nudges ? `<circle r="${R_M + 7}" class="util-bg"/><circle r="${R_M + 7}" class="util" stroke-dasharray="${(circ * util).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90)"/>` : ''}
        <circle r="${R_M}" class="disc"/>${icon(m.icon, 44)}
        ${glow.includes(m.id) ? `<g transform="translate(0,${-R_M - 26})"><rect class="bn" x="-56" y="-13" width="112" height="26" rx="13"/><text class="bnt" y="4">BOTTLENECK</text></g>` : ''}
        ${m.id === 'mixer' && st.saving ? `<g transform="translate(0,${-R_M - 26})"><rect class="save" x="-64" y="-13" width="128" height="26" rx="13"/><text class="savet" y="4">−$${st.saving}/hr power</text></g>` : ''}
        <g transform="translate(0,${R_M + 26})"><rect class="label" x="-56" y="-17" width="112" height="48" rx="12"/><text class="nm" y="0">${esc(m.name)}</text><text class="rt big" y="22">${st.rates[m.id]}/hr</text></g>
      </g>`;
    }).join('');
    const sell = `
      <g class="node sell" transform="translate(${pos.sell.x},${pos.sell.y})">
        <circle r="${R_SELL}" class="disc"/><text class="dollar" y="10">$</text>
        <g transform="translate(0,${R_SELL + 24})"><rect class="label" x="-50" y="-16" width="100" height="42" rx="11"/><text class="nm" y="0">Sell</text><text class="rt" y="18">${usd(round.price)} each</text></g>
      </g>`;
    return `<svg class="map" viewBox="0 0 930 610" preserveAspectRatio="xMidYMid meet">
      <defs><pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="rgba(255,226,190,.09)"/></pattern></defs>
      <rect width="930" height="610" fill="url(#dots)"/>
      ${belts}${items}${piles}${supplies}${machines}${sell}
    </svg>
    <div class="maphud"><div><small>Line makes</small><b>${fl.units}/hr</b></div><div><small>Earning</small><b>${usd(LM.hourly(round, st))}/hr</b></div></div>
    <div class="inspector hidden" id="inspector"></div>`;
  }

  function wireMap(r, st) {
    const round = ROUNDS[r];
    const fl = LM.flows(round, st);
    const box = $('#inspector'), wrap = $('.mapwrap');
    wrap.querySelectorAll('[data-node]').forEach((g) => g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = g.dataset.node;
      const m = round.machines.find((x) => x.id === id);
      const s = round.supplies.find((x) => x.id === id);
      let html;
      if (m) {
        const util = Math.round(fl.prod[id] / st.rates[id] * 100);
        html = `<b>${esc(m.name)}</b><span>${esc(m.role)}</span><div class="kv"><span>Can make</span><b>${st.rates[id]}/hr</b></div><div class="kv"><span>Actually making</span><b>${fl.prod[id]}/hr</b></div>${r === 1 ? `<div class="kv"><span>Busy</span><b>${util}%</b></div>` : ''}`;
      } else if (s) html = `<b>${esc(s.name)}</b><span>Raw material delivered to the ${esc(round.machines.find((x) => x.id === s.to).name)}</span><div class="kv"><span>Delivered</span><b>${s.rate}/hr</b></div>`;
      else return;
      const rect = g.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      box.innerHTML = html; box.classList.remove('hidden');
      let left = rect.left - wr.left + rect.width / 2 - 110, top = rect.bottom - wr.top + 6;
      left = Math.max(8, Math.min(left, wr.width - 228)); if (top + 140 > wr.height) top = rect.top - wr.top - 140;
      box.style.left = left + 'px'; box.style.top = top + 'px';
    }));
    wrap.addEventListener('click', () => box.classList.add('hidden'));
  }

  // cash at a given hour for a round, given choices
  function cashAt(r, hour) {
    const s = LM.simulate(r, choicesFor(r));
    let cash = START_CASH;
    for (const st of s.steps) {
      const h0 = CHECKPOINTS[st.idx], h1 = CHECKPOINTS[st.idx + 1] ?? SHIFT_HOURS;
      if (hour < h0) break;
      const after = st.cashBefore - (st.invested ? st.ev.offer.cost : 0);
      if (hour <= h1) return after + st.perHour * (hour - h0);
      cash = st.cashAfter;
    }
    return cash;
  }
  function stateAtHour(r, hour) {
    const s = LM.simulate(r, choicesFor(r));
    let st = LM.initialState(ROUNDS[r]);
    for (const step of s.steps) if (CHECKPOINTS[step.idx] <= hour) st = { rates: step.rates, saving: LM.simulate(r, choicesFor(r).slice(0, step.idx + 1)).state.saving };
    return st;
  }

  function sparkSVG(r, hour) {
    const W = 210, H = 54;
    const pts = [];
    const max = Math.max(LM.bestChoices(r).cash, START_CASH) * 1.05, min = 0;
    for (let h = 0; h <= Math.min(hour, SHIFT_HOURS) + 1e-9; h += 0.5) pts.push([h, cashAt(r, h)]);
    if (pts.length && pts[pts.length - 1][0] < hour) pts.push([hour, cashAt(r, hour)]);
    const xy = pts.map(([h, c]) => `${(h / SHIFT_HOURS * W).toFixed(1)},${(H - (c - min) / (max - min) * H).toFixed(1)}`).join(' ');
    const ticks = CHECKPOINTS.slice(1).map((h) => `<line x1="${h / SHIFT_HOURS * W}" x2="${h / SHIFT_HOURS * W}" y1="0" y2="${H}" class="tick"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">${ticks}<polyline points="${xy}" /></svg>`;
  }

  function logHTML(r, upto, deciding) {
    const s = LM.simulate(r, choicesFor(r));
    return CHECKPOINTS.map((h, i) => {
      const st = s.steps[i];
      const o = ROUNDS[r].offers[i];
      const cur = deciding && i === upto;
      const rec = srv && srv.you && srv.you.rounds[r];
      const how = rec && rec.forced && rec.forced[i] ? 'Round ended · nothing bought' : rec && rec.timedOut && rec.timedOut[i] ? 'Time ran out · nothing bought' : null;
      const txt = st && i < upto ? (st.invested ? `Bought · −${usd(o.cost)}` : how || (r === 1 && o.sunk ? 'Scrapped' : 'Passed')) : (cur ? 'Deciding now…' : '');
      return `<li class="${cur ? 'cur' : ''} ${st && !cur ? 'did' : ''}"><span class="h">${String(h).padStart(2, '0')}:00</span><span class="t">${esc(o.title)}<small>${txt}</small></span></li>`;
    }).join('');
  }

  function shell(r, { hour, cash, upto, right, map, replay = false, deciding = false }) {
    const round = ROUNDS[r];
    const runs = [0, 1].map((ri) => {
      const ch = choicesFor(ri);
      const done = ch.length === 3;
      const active = ri === r;
      if (ri > r && !done) return `<li class="todo"><span>${ROUNDS[ri].title}</span><b>–</b></li>`;
      return `<li class="${active ? 'on' : ''}"><span>${ROUNDS[ri].title}</span><b>${done ? usd(LM.simulate(ri, ch).cash) : 'running'}</b></li>`;
    }).join('');
    main.innerHTML = `
      <div class="game">
        <aside class="side left">
          <section class="panel goal"><div class="eyebrow">Goal</div><p>Earn as much money as you can in one 24-hour shift.</p></section>
          <section class="panel shift">
            <div class="eyebrow">${esc(round.title)}</div>
            <div class="clockrow"><span id="clockLabel">Hour ${Math.floor(hour)} of ${SHIFT_HOURS}</span></div>
            <div class="clockbar"><div id="clockFill" style="width:${hour / SHIFT_HOURS * 100}%"></div></div>
            <div class="cashrow"><small>Cash</small><b id="cash">${usd(cash)}</b></div>
            <div id="spark">${sparkSVG(r, hour)}</div>
            ${replay ? `<div class="replay"><input type="range" id="scrub" min="0" max="24" step="0.5" value="${hour}"><div class="rbtns"><button class="btn-ghost sm" id="rFirst">⏮ First</button><button class="btn-primary sm" id="rPlay">▶ Replay</button></div></div>` : ''}
          </section>
          <section class="panel log"><div class="eyebrow">Shift log</div><ol>${logHTML(r, upto, deciding)}</ol></section>
          <section class="panel runs"><div class="eyebrow">Your rounds</div><ul>${runs}</ul></section>
        </aside>
        <section class="mapwrap">${map}</section>
        <aside class="side right">${right}</aside>
      </div>`;
  }

  function setClock(r, hour, cash) {
    const l = $('#clockLabel'), f = $('#clockFill'), c = $('#cash'), sp = $('#spark');
    if (l) l.textContent = `Hour ${Math.floor(hour)} of ${SHIFT_HOURS}`;
    if (f) f.style.width = (hour / SHIFT_HOURS * 100) + '%';
    if (c) c.textContent = usd(cash);
    if (sp) sp.innerHTML = sparkSVG(r, hour);
  }

  function stateAt(r, idx) {
    const s = LM.simulate(r, choicesFor(r).slice(0, idx));
    return { st: s.state, cash: s.cash };
  }

  function effectText(round, st, offer) {
    const e = offer.effect;
    if (e.saving) return `Saves ${usd(e.saving)}/hr in running costs`;
    const m = round.machines.find((x) => x.id === e.machine);
    return `${m.name}: ${st.rates[e.machine]} → ${st.rates[e.machine] + e.rate} /hr`;
  }

  function tagHTML(ev) {
    const never = ev.payback === Infinity;
    const scale = Math.max(SHIFT_HOURS, never ? 0 : ev.payback) * 1.1;
    const fill = never ? 100 : (ev.payback / scale * 100);
    const mark = ev.hoursLeft / scale * 100;
    const col = ev.payable ? 'var(--good)' : 'var(--bad)';
    return `<div class="tag ${ev.payable ? 'ok' : 'no'} pop">
      <div class="ico">${ev.payable ? '✓' : '✗'}</div>
      <div style="flex:1">
        <div>${never ? 'Never pays back' : `Pays back in ${LM.fmtH(ev.payback)}`} · ${ev.hoursLeft}h left</div>
        <div class="tagbar"><div class="fill" style="width:${fill}%;background:${col};opacity:.35"></div><div class="mark" style="left:${mark}%" title="end of shift"></div><span class="marklabel" style="${mark > 50 ? `right:${100 - mark}%;margin-right:5px` : `left:${mark}%;margin-left:8px`}">end of shift</span></div>
        <div class="sub">Payback tag: time to earn it back vs time left</div>
      </div></div>`;
  }

  function renderDecision() {
    const { round: r, idx, stage } = dec;
    const round = ROUNDS[r];
    const { st, cash } = stateAt(r, idx);
    const ev = LM.evaluateOffer(round, st, idx);
    const o = ev.offer;
    setHeader();
    const predictStage = stage === 'predict';
    const tagOn = showTag(r) && !predictStage;
    const scrap = r === 1 && o.sunk > 0;
    const msLeft = DECISION_SECONDS * 1000 - (Date.now() - dec.startedAt);
    let guess = '';
    if (r === 1 && dec.prediction) {
      const right = (dec.prediction === 'yes') === ev.payable;
      guess = `<div class="guess ${right ? 'right' : 'wrong'}">You predicted “${dec.prediction === 'yes' ? 'yes' : 'no'}”. ${right ? 'Spot on.' : 'The tag says otherwise.'}</div>`;
    }
    const right = `
      <div class="panel offer pop">
        <div class="timer" id="timer"></div>
        <div class="kicker"><span>Decision ${idx + 1} of 3 · ${ev.hoursLeft}h of shift left</span><span class="secs${msLeft < 10000 ? ' low' : ''}"><span id="secs">${Math.max(0, Math.ceil(msLeft / 1000))}</span>s</span></div>
        <h3>${esc(o.title)}</h3>
        ${r === 1 && !predictStage ? '' : `<p class="blurb">${esc(o.blurb)}</p>`}
        <div class="rows">
          ${o.sunk ? `<div class="row sunk"><span>Already spent</span><b>${usd(o.sunk)}</b></div>` : ''}
          <div class="row"><span>Cost now</span><b>${usd(o.cost)}</b></div>
          <div class="row"><span>Effect</span><b>${esc(effectText(round, st, o))}</b></div>
        </div>
        ${tagOn ? tagHTML(ev) : ''}
        ${r === 1 && o.sunk && !predictStage ? `<div class="newmgr pop"><div class="face">🧑‍💼</div><div><b>New Manager check</b>A new manager with no history walks in. The ${usd(o.sunk)} is gone either way. Would <i>they</i> pay ${usd(o.cost)}?</div></div>` : ''}
      </div>
      <div class="panel actions pop">
        ${predictStage ? `
          <h4>Predict first</h4>
          <p>Before you see the payback tag: will this pay back before the shift ends?</p>
          <div class="predict-row"><button class="btn-ghost" data-pred="yes">Yes</button><button class="btn-ghost" data-pred="no">No</button></div>` : `
          ${guess}
          <div class="choices">
            <button class="btn-primary" data-choice="A"><span>Invest ${usd(o.cost)}</span><small>Pay now</small></button>
            ${scrap
              ? `<button class="btn-scrap" data-choice="B"><span>Scrap it</span><small>Write off ${usd(o.sunk)}</small></button>`
              : `<button class="btn-ghost" data-choice="B"><span>Don't invest</span><small>Keep ${usd(o.cost)}</small></button>`}
          </div>
          <p class="fine">Talk it over. If time runs out, nothing is bought.</p>`}
      </div>`;
    shell(r, { hour: CHECKPOINTS[idx], cash, upto: idx, right, deciding: true, map: mapSVG(r, st, { target: o.effect.machine }) });
    wireMap(r, st);
    main.querySelectorAll('[data-pred]').forEach((b) => b.onclick = () => { dec.prediction = b.dataset.pred; dec.stage = 'choose'; persist(); render(); });
    main.querySelectorAll('[data-choice]').forEach((b) => b.onclick = () => choose(b.dataset.choice, false));
    tickTimer();
  }

  function tickTimer() {
    if (!dec || inactive) return;
    const el = $('#timer');
    const left = DECISION_SECONDS * 1000 - (Date.now() - dec.startedAt);
    if (el) { el.style.width = Math.max(0, left / (DECISION_SECONDS * 10)) + '%'; el.classList.toggle('low', left < 10000); }
    const t = $('#secs'); if (t) { t.textContent = Math.max(0, Math.ceil(left / 1000)); t.parentNode.classList.toggle('low', left < 10000); }
    if (left <= 0) choose('B', true);
  }
  setInterval(tickTimer, 250);

  function choose(choice, timedOut) {
    if (!dec || inactive || dec.round !== playRound()) return;
    notice = '';
    const { round: r, idx } = dec;
    const msg = { type: 'decide', round: r, idx, choice, prediction: dec.prediction, timedOut, ms: Date.now() - dec.startedAt };
    dec = null;
    localChoices[r] = choicesFor(r).slice(0, idx).concat(choice);
    if (OFFLINE) offlineApply(msg); else { pending.push(msg); persist(); flush(); }
    startSim(r, idx);
  }

  function startSim(r, idx) {
    const s = LM.simulate(r, choicesFor(r));
    const step = s.steps[idx];
    const from = step.cashBefore - (step.invested ? step.ev.offer.cost : 0);
    cancelSim();
    const id = simSeq;
    sim = { id, round: r, idx, t0: performance.now(), dur: 4200, from, to: step.cashAfter, step };
    render();
    requestAnimationFrame((t) => animate(t, id));
  }

  function animate(now, id) {
    if (!sim || sim.id !== id) return;
    const p = Math.min(1, (now - sim.t0) / sim.dur);
    const h0 = CHECKPOINTS[sim.idx], h1 = CHECKPOINTS[sim.idx + 1] ?? SHIFT_HOURS;
    const hour = h0 + (h1 - h0) * p;
    const cash = sim.from + (sim.to - sim.from) * p;
    setClock(sim.round, hour, cash);
    const big = $('#simHour'), earned = $('#simEarned');
    if (big) big.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:00`;
    if (earned) earned.textContent = '+' + usd((sim.to - sim.from) * p);
    if (p < 1) requestAnimationFrame((t) => animate(t, id));
    else simTimer = setTimeout(() => { if (sim && sim.id === id) { sim = null; render(); } }, 450);
  }

  function renderSim() {
    const { round: r, idx, step } = sim;
    const o = step.ev.offer;
    const st = { rates: step.rates, saving: LM.simulate(r, choicesFor(r).slice(0, idx + 1)).state.saving };
    const h0 = CHECKPOINTS[idx], h1 = CHECKPOINTS[idx + 1] ?? SHIFT_HOURS;
    setHeader();
    const right = `
      <div class="panel running pop">
        <div class="kicker">Running the factory</div>
        <div class="simclock" id="simHour">${String(h0).padStart(2, '0')}:00</div>
        <p class="muted">Hours ${h0}–${h1} at ${usd(step.perHour)}/hr</p>
        <div class="earnbox"><small>Earned so far</small><b id="simEarned">+$0</b></div>
        <p class="what">${step.invested ? `You bought <b>${esc(o.title)}</b> <span style="white-space:nowrap">(−${usd(o.cost)})</span>.` : (r === 1 && o.sunk ? `You scrapped <b>${esc(o.title)}</b>.` : `You passed on <b>${esc(o.title)}</b>.`)}</p>
      </div>`;
    shell(r, { hour: h0, cash: sim.from, upto: idx + 1, right, map: mapSVG(r, st, { bumped: step.invested ? o.effect.machine : null }) });
    wireMap(r, st);
  }

  let replayRaf = null;
  function renderDone(r) {
    const s = LM.simulate(r, choicesFor(r));
    setHeader();
    const offlineNext = OFFLINE ? `<button class="btn-orange" id="next" style="width:100%;margin-top:14px">${r === 0 ? 'Start Round 2' : 'See my Bias Mirror'}</button>` : '';
    const units = s.steps.reduce((n, st) => n + LM.flows(ROUNDS[r], { rates: st.rates, saving: 0 }).units * ((CHECKPOINTS[st.idx + 1] ?? SHIFT_HOURS) - CHECKPOINTS[st.idx]), 0);
    const right = `
      <div class="panel done pop">
        <div class="kicker">Shift complete</div>
        <div class="final">${usd(s.cash)}</div>
        <p class="muted">${units} ${ROUNDS[r].product}s made and sold</p>
        ${notice ? `<p class="guess wrong">${esc(notice)}</p>` : ''}
        <p>${OFFLINE ? 'Drag the timeline on the left to replay your shift.' : 'Waiting for the other teams. Eyes on the big screen.'}</p>
        ${offlineNext}
      </div>`;
    shell(r, { hour: SHIFT_HOURS, cash: s.cash, upto: 3, right, map: mapSVG(r, s.state), replay: true });
    wireMap(r, s.state);
    const n = $('#next'); if (n) n.onclick = () => offlineAdvance(r === 0 ? 'r2' : 'final');
    const scrub = $('#scrub');
    let lastSt = '';
    const show = (h) => {
      setClock(r, h, cashAt(r, h)); scrub.value = h;
      const st = stateAtHour(r, h); const k = JSON.stringify(st);
      if (k !== lastSt) { lastSt = k; $('.mapwrap').innerHTML = mapSVG(r, st); wireMap(r, st); }
    };
    scrub.oninput = () => { cancelAnimationFrame(replayRaf); show(parseFloat(scrub.value)); };
    $('#rFirst').onclick = () => { cancelAnimationFrame(replayRaf); show(0); };
    $('#rPlay').onclick = () => {
      cancelAnimationFrame(replayRaf);
      const t0 = performance.now();
      const step = (now) => { const h = Math.min(SHIFT_HOURS, (now - t0) / 6000 * SHIFT_HOURS); if (!$('#scrub')) return; show(h); if (h < SHIFT_HOURS) replayRaf = requestAnimationFrame(step); };
      replayRaf = requestAnimationFrame(step);
    };
  }

  function renderReveal() {
    const r = srv.phase === 'r1-reveal' ? 0 : 1;
    const s = LM.simulate(r, choicesFor(r));
    setHeader({ cash: s.cash });
    main.innerHTML = `
      <div class="center"><div class="card pop">
        <div style="font-size:54px">👀</div>
        <h1 class="brand" style="font-size:40px">Eyes on the big screen</h1>
        <p>${ROUNDS[r].title}: you finished with <b>${usd(s.cash)}</b>.</p>
      </div></div>`;
  }

  function renderFinal() {
    const rounds = [0, 1].map((r) => {
      const rec = srv.you.rounds[r];
      const m = LM.mirror(r, choicesFor(r)).map((d) => {
        if (rec.forced && rec.forced[d.idx]) return { ...d, ok: null, bias: null, delta: 0, text: 'The round ended before your team decided, so nothing was bought. Not counted.' };
        if (rec.timedOut && rec.timedOut[d.idx]) return { ...d, bias: d.ok ? null : 'Default effect: time ran out', text: 'Time ran out, so the default kicked in and nothing was bought. ' + d.text.replace(/^You (walked away from|passed|skipped)/, 'That meant passing on') };
        return d;
      });
      return { r, m, cash: LM.simulate(r, choicesFor(r)).cash, best: LM.bestChoices(r).cash };
    });
    const played = (x) => choicesFor(x.r).length > 0;
    const total = srv.you.total != null ? srv.you.total : rounds.reduce((s, x) => s + (played(x) ? x.cash : 0), 0);
    const allPlayed = rounds.every((x) => choicesFor(x.r).length === 3);
    const lost = rounds.reduce((s, x) => s + x.m.reduce((a, d) => a - d.delta, 0), 0);
    const sunkLost = rounds.reduce((s, x) => s + x.m.filter((d) => !d.ok && d.choice === 'A').reduce((a, d) => a - d.delta, 0), 0);
    const preds = predictionsFor(1);
    const r2sim = LM.simulate(1, choicesFor(1));
    const predRight = r2sim.steps.filter((s) => preds[s.idx] && ((preds[s.idx] === 'yes') === s.ev.payable)).length;
    const predMade = r2sim.steps.filter((s) => preds[s.idx]).length;
    setHeader({ cash: total });
    const col = (x) => `
      <div class="card pop">
        <h3><span>${ROUNDS[x.r].title}</span><span>${played(x) ? usd(x.cash) : '–'} <small class="muted" style="font-size:13px">/ best ${usd(x.best)}</small></span></h3>
        ${played(x) ? '' : '<p class="muted">Your team did not play this round.</p>'}
        ${x.m.map((d) => `
          <div class="mi"><div class="mark ${d.ok == null ? 'na' : d.ok ? 'ok' : 'no'}">${d.ok == null ? '–' : d.ok ? '✓' : '✗'}</div>
            <div><div class="t">${esc(d.title)} · ${d.choice === 'A' ? 'Invested' : 'Passed'}</div>
            <p>${esc(d.text)}</p>${d.bias ? `<span class="bias">${esc(d.bias)}</span>` : ''}</div></div>`).join('')}
      </div>`;
    const lb = srv.leaderboard || [];
    main.innerHTML = `
      <div class="card hero pop">
        <div class="rank">#${srv.rank || '–'}</div>
        <div><div class="muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.1em;font-size:12px">Your Bias Mirror</div>
          <h2 style="font-size:30px">${esc(srv.you.name)}: ${usd(total)}</h2>
          <div class="lost">${lost > 0 ? `Biased calls cost you <b style="color:var(--bad)">${usd(lost)}</b>${sunkLost ? (sunkLost >= lost ? ', all of it from paying into things that could not pay back' : `, ${usd(sunkLost)} of it from paying into things that could not pay back`) : ''}.` : (allPlayed ? 'A perfect manager. No money lost to bias.' : '')}
          ${predMade ? ` Round 2 predictions: ${predRight}/${predMade} right.` : ''}</div></div>
        <div class="muted" style="text-align:right;font-size:14px">Sunk money is gone.<br><b style="color:var(--brown)">Look forward.</b></div>
      </div>
      <div class="mirror">${rounds.map(col).join('')}</div>
      ${lb.length > 1 ? `<div class="card lb pop"><h3 style="margin-bottom:10px">Final leaderboard</h3><ol>${lb.map((l, i) => `<li class="${l.name === srv.you.name ? 'me' : ''}"><span>${l.rank || i + 1}. ${esc(l.name)}</span><span>${usd(l.total)}</span></li>`).join('')}</ol></div>` : ''}`;
  }

  // ---------- boot ----------
  claimTab();
  restore();
  if (!OFFLINE) connect();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
})();
