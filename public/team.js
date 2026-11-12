// Line Manager — team laptop client
(() => {
  const $ = (s) => document.querySelector(s);
  const main = $('#main');
  const params = new URLSearchParams(location.search);
  const OFFLINE = params.has('offline');
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

  // Persist in-flight work so a refresh mid-decision keeps the clock, prediction and unsent choices.
  function persist() {
    if (OFFLINE) return;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ teamId: localStorage.getItem(LS_KEY), pending, localChoices, dec })); } catch (_) {}
  }
  function restore() {
    if (OFFLINE) return;
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
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = () => {
      wsOpen = false; joined = false; updateConn();
      if (busyJoin) { busyJoin = false; joinError = 'Connection dropped. Press Join again.'; render(true); }
      setTimeout(connect, backoff); backoff = Math.min(backoff * 1.6, 5000);
    };
  }
  setInterval(() => { if (wsOpen) ws.send('{"type":"ping"}'); }, 25000);

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
    if (OFFLINE || !wsOpen || !joined) return;
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
  function offlineJoin(name) {
    const cond = params.get('cond') === 'tag' ? 'tag' : 'control';
    srv = { phase: 'r1', you: { id: 'offline', num: 1, name, condition: cond, rounds: [rec(), rec()] }, teamCount: 1 };
    function rec() { return { choices: [], predictions: [], timedOut: [], ms: [] }; }
    render();
  }
  function offlineApply(m) {
    const r = srv.you.rounds[m.round];
    r.choices.push(m.choice); r.predictions[m.idx] = m.prediction; r.timedOut[m.idx] = m.timedOut; r.ms[m.idx] = m.ms;
  }
  function offlineAdvance(phase) {
    srv.phase = phase;
    if (phase === 'final') {
      const total = srv.you.rounds.reduce((s, r, i) => s + LM.simulate(i, r.choices).cash, 0);
      srv.rank = 1; srv.leaderboard = [{ num: 1, name: srv.you.name, total }];
    }
    render();
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
  function setHeader({ hour = null, cash = null } = {}) {
    const you = srv && srv.you;
    const pill = $('#teamPill');
    if (you) { pill.textContent = `Team ${you.num} · ${you.name}`; pill.classList.remove('hidden'); } else pill.classList.add('hidden');
    $('#clockStat').classList.toggle('hidden', hour == null);
    $('#cashStat').classList.toggle('hidden', cash == null);
    if (hour != null) {
      $('#clockLabel').textContent = `Hour ${Math.floor(hour)} of ${SHIFT_HOURS}`;
      $('#clockFill').style.width = (hour / SHIFT_HOURS * 100) + '%';
    }
    if (cash != null) $('#cash').textContent = usd(cash);
    updateConn();
  }

  // ---------- render ----------
  function render(force) {
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
        ${OFFLINE ? '<p class="muted" style="font-size:13px">Offline mode: this laptop plays on its own.</p>'
          : '<p class="muted" style="font-size:13px;margin-top:18px">Wi-Fi trouble? <a href="?offline" style="color:inherit">Play offline</a></p>'}
      </div></div>`;
    const name = $('#name');
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) { joinError = 'Please enter a team name.'; return render(true); }
      if (OFFLINE) return offlineJoin(v);
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
      </div></div>`;
  }

  const GEAR = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  function lineHTML(r, st, { target = null, bumped = null, run = false } = {}) {
    const round = ROUNDS[r];
    const glow = r === 1 ? LM.bottleneckIds(round, st) : [];
    const units = Math.min(...Object.values(st.rates));
    const machines = round.machines.map((m) => `
      <div class="machine ${glow.includes(m.id) ? 'glow' : ''} ${target === m.id ? 'target' : ''} ${bumped === m.id ? 'bumped' : ''}">
        ${glow.includes(m.id) ? '<span class="bn-label">BOTTLENECK</span>' : ''}
        ${GEAR}
        <div class="name">${esc(m.name)}</div>
        <div class="rate">${st.rates[m.id]} <small>/hr</small></div>
      </div>`).join('');
    const boxes = run ? Array.from({ length: 6 }, (_, i) => `<span class="box" style="animation-delay:${(-i * 0.37).toFixed(2)}s"></span>`).join('') : '';
    return `<div class="line">${machines}
      <div class="output"><small>Line makes</small><div class="big">${units}/hr</div><small>× ${usd(round.price)}${st.saving ? ` + ${usd(st.saving)} saved` : ''} = <b>${usd(LM.hourly(round, st))}/hr</b></small></div>
      <div class="conveyor ${run ? 'run' : ''}">${boxes}</div></div>`;
  }

  function stateAt(r, idx) {
    // machine state + cash at checkpoint idx, given the choices made before it
    const s = LM.simulate(r, choicesFor(r).slice(0, idx));
    return { st: s.state, cash: s.cash };
  }

  function effectText(round, st, offer) {
    const e = offer.effect;
    if (e.saving) return `Saves ${usd(e.saving)}/hr in running costs`;
    const m = round.machines.find((x) => x.id === e.machine);
    return `${m.name}: ${st.rates[e.machine]} → ${st.rates[e.machine] + e.rate} units/hr`;
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
        <div class="tagbar"><div class="fill" style="width:${fill}%;background:${col};opacity:.35"></div><div class="mark" style="left:${mark}%" title="end of shift"></div></div>
        <div class="sub">Payback tag: time to earn the cost back vs time left in the shift</div>
      </div></div>`;
  }

  function renderDecision() {
    const { round: r, idx, stage } = dec;
    const round = ROUNDS[r];
    const { st, cash } = stateAt(r, idx);
    const ev = LM.evaluateOffer(round, st, idx);
    const o = ev.offer;
    setHeader({ hour: CHECKPOINTS[idx], cash });
    const predictStage = stage === 'predict';
    const tagOn = showTag(r) && !predictStage;
    const scrap = r === 1 && o.sunk > 0;
    let guess = '';
    if (r === 1 && dec.prediction) {
      const right = (dec.prediction === 'yes') === ev.payable;
      guess = `<div class="guess ${right ? 'right' : 'wrong'}">You predicted “${dec.prediction === 'yes' ? 'Yes, it pays back' : 'No, it won’t'}”. ${right ? 'Spot on.' : 'The tag says otherwise.'}</div>`;
    }
    main.innerHTML = `
      <div class="round-title"><h2>${round.title}</h2><span class="muted">${r === 1 ? 'Everyone has the new tools this round' : ''}</span></div>
      ${lineHTML(r, st, { target: o.effect.machine })}
      <div class="decision" style="margin-top:14px">
        <div class="card offer pop">
          <div class="timer" id="timer"></div>
          <div class="kicker">Decision ${idx + 1} of 3 · Hour ${CHECKPOINTS[idx]} · ${ev.hoursLeft}h left in the shift</div>
          <h3>${esc(o.title)}</h3>
          <p class="blurb">${esc(o.blurb)}</p>
          <div class="rows">
            ${o.sunk ? `<div class="row sunk"><span>Already spent on this</span><b>${usd(o.sunk)}</b></div>` : ''}
            <div class="row"><span>Cost to go ahead now</span><b>${usd(o.cost)}</b></div>
            <div class="row"><span>What it does</span><b>${esc(effectText(round, st, o))}</b></div>
          </div>
          ${tagOn ? tagHTML(ev) : ''}
          ${r === 1 && o.sunk && !predictStage ? `<div class="newmgr pop"><div class="face">🧑‍💼</div><div><b>New Manager check</b>A new manager walks in today with no history. The ${usd(o.sunk)} already spent is gone either way. Would <i>they</i> pay ${usd(o.cost)} for this?</div></div>` : ''}
        </div>
        <div class="card panel pop">
          ${predictStage ? `
            <h4>Predict first</h4>
            <p>Before you see the payback tag: will this pay back before the shift ends?</p>
            <div class="predict-row">
              <button class="btn-ghost" data-pred="yes">Yes</button>
              <button class="btn-ghost" data-pred="no">No</button>
            </div>` : `
            ${guess}
            <h4>Your call</h4>
            <p>Talk it over as a team. If time runs out, nothing is bought.</p>
            <div class="choices">
              <button class="btn-primary" data-choice="A"><span>Invest ${usd(o.cost)}</span><small>Pay now</small></button>
              ${scrap
                ? `<button class="btn-scrap" data-choice="B"><span>Scrap it</span><small>Write off the ${usd(o.sunk)} in one click</small></button>`
                : `<button class="btn-ghost" data-choice="B"><span>Don't invest</span><small>Keep ${usd(o.cost)} in the bank</small></button>`}
            </div>`}
        </div>
      </div>`;
    main.querySelectorAll('[data-pred]').forEach((b) => b.onclick = () => { dec.prediction = b.dataset.pred; dec.stage = 'choose'; persist(); render(); });
    main.querySelectorAll('[data-choice]').forEach((b) => b.onclick = () => choose(b.dataset.choice, false));
    tickTimer();
  }

  function tickTimer() {
    if (!dec) return;
    const el = $('#timer');
    const left = DECISION_SECONDS * 1000 - (Date.now() - dec.startedAt);
    if (el) { el.style.width = Math.max(0, left / (DECISION_SECONDS * 10)) + '%'; el.classList.toggle('low', left < 10000); }
    if (left <= 0) choose('B', true);
  }
  setInterval(tickTimer, 250);

  function choose(choice, timedOut) {
    if (!dec || dec.round !== playRound()) return;
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
    const ease = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const h0 = CHECKPOINTS[sim.idx], h1 = CHECKPOINTS[sim.idx + 1] ?? SHIFT_HOURS;
    const hour = h0 + (h1 - h0) * p;
    const cash = sim.from + (sim.to - sim.from) * ease;
    setHeader({ hour, cash });
    const big = $('#simHour'), earned = $('#simEarned');
    if (big) big.textContent = `Hour ${Math.floor(hour)}`;
    if (earned) earned.textContent = '+' + usd((sim.to - sim.from) * ease);
    if (p < 1) requestAnimationFrame((t) => animate(t, id));
    else simTimer = setTimeout(() => { if (sim && sim.id === id) { sim = null; render(); } }, 450);
  }

  function renderSim() {
    const { round: r, idx, step } = sim;
    const round = ROUNDS[r];
    const st = { rates: step.rates, saving: LM.simulate(r, choicesFor(r).slice(0, idx + 1)).state.saving };
    const o = step.ev.offer;
    const h0 = CHECKPOINTS[idx], h1 = CHECKPOINTS[idx + 1] ?? SHIFT_HOURS;
    main.innerHTML = `
      <div class="round-title"><h2>${round.title}</h2></div>
      ${lineHTML(r, st, { bumped: step.invested ? o.effect.machine : null, run: true })}
      <div class="card simbanner pop">
        <div class="spinner"></div>
        <div style="flex:1">
          <div class="muted">${step.invested ? `Bought: ${esc(o.title)} (−${usd(o.cost)})` : (r === 1 && o.sunk ? `Scrapped: ${esc(o.title)}` : `Skipped: ${esc(o.title)}`)}</div>
          <div class="big" id="simHour">Hour ${h0}</div>
          <div class="muted">Running hours ${h0}–${h1} at ${usd(step.perHour)}/hr</div>
        </div>
        <div class="earned" id="simEarned">+$0</div>
      </div>`;
  }

  function renderDone(r) {
    const s = LM.simulate(r, choicesFor(r));
    setHeader({ hour: SHIFT_HOURS, cash: s.cash });
    const offlineNext = OFFLINE ? (r === 0
      ? '<button class="btn-orange" id="next" style="margin-top:18px">Start Round 2</button>'
      : '<button class="btn-orange" id="next" style="margin-top:18px">See my Bias Mirror</button>') : '';
    main.innerHTML = `
      <div class="center"><div class="card pop">
        <div class="pill" style="margin-bottom:12px">${ROUNDS[r].title}</div>
        <h1 class="brand" style="font-size:40px">Shift complete</h1>
        <p style="font-size:22px">You finished with <b>${usd(s.cash)}</b></p>
        <p class="muted">${OFFLINE ? '' : 'Waiting for the other teams… eyes on the big screen.'}</p>
        ${offlineNext}
      </div></div>`;
    const n = $('#next'); if (n) n.onclick = () => offlineAdvance(r === 0 ? 'r2' : 'final');
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
    const rounds = [0, 1].map((r) => ({ r, m: LM.mirror(r, choicesFor(r)), cash: LM.simulate(r, choicesFor(r)).cash, best: LM.bestChoices(r).cash }));
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
          <div class="mi"><div class="mark ${d.ok ? 'ok' : 'no'}">${d.ok ? '✓' : '✗'}</div>
            <div><div class="t">${esc(d.title)} · ${d.choice === 'A' ? 'Invested' : 'Passed'}</div>
            <p>${esc(d.text)}</p>${d.bias ? `<span class="bias">${esc(d.bias)}</span>` : ''}</div></div>`).join('')}
      </div>`;
    const lb = srv.leaderboard || [];
    main.innerHTML = `
      <div class="card hero pop">
        <div class="rank">#${srv.rank || '–'}</div>
        <div><div class="muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.1em;font-size:12px">Your Bias Mirror</div>
          <h2 style="font-size:30px">${esc(srv.you.name)}: ${usd(total)}</h2>
          <div class="lost">${lost > 0 ? `Biased calls cost you <b style="color:var(--bad)">${usd(lost)}</b>${sunkLost ? `, ${usd(sunkLost)} of it from paying into things that could not pay back` : ''}.` : (allPlayed ? 'A perfect manager. No money lost to bias.' : '')}
          ${predMade ? ` Round 2 predictions: ${predRight}/${predMade} right.` : ''}</div></div>
        <div class="muted" style="text-align:right;font-size:14px">Sunk money is gone.<br><b style="color:var(--brown)">Look forward.</b></div>
      </div>
      <div class="mirror">${rounds.map(col).join('')}</div>
      ${lb.length > 1 ? `<div class="card lb pop"><h3 style="margin-bottom:10px">Final leaderboard</h3><ol>${lb.map((l, i) => `<li class="${l.name === srv.you.name ? 'me' : ''}"><span>${i + 1}. ${esc(l.name)}</span><span>${usd(l.total)}</span></li>`).join('')}</ol></div>` : ''}`;
  }

  // ---------- boot ----------
  if (!OFFLINE) { restore(); connect(); }
  render();
})();
