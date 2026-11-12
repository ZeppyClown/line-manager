// Line Manager — interactive lobby tutorial (teaches the interface only).
// Requires engine.js (window.LM) and map.js (window.LMUI). Styles: tutorial.css (all classes prefixed .tut-).
//
//   const t = LMTutorial.start(mountEl, { teamName, onDone, fx, soundHint });
//   t.destroy();
//
// - mountEl: empty element in the page content area. The tutorial sizes itself to the viewport below it.
// - onDone(): called exactly once, when the team presses "We're ready".
// - fx (optional): { sound(name), confetti() }. Every call is guarded.
// - soundHint (optional): text for the sound tip on the last step, or false to hide it.
//   Default: a tip about the speaker button, shown only when fx is given.
//
// Experiment safety: this file uses a neutral practice factory (all machines run at the same speed) and a
// practice offer that changes nothing. It never mentions money already spent, payback, or the slowest machine.
(() => {
  'use strict';

  const SHIFT = 24;
  const START_CASH = 500;
  const DEC_SECS = 40;
  const TIMER_SPEED = 3;          // practice timer runs 3x fast (40 "seconds" in ~13 s)
  const RUN_MS = 3200;            // "watch your cash grow" animation
  const RUN_HOURS = 8;

  const PRACTICE = {
    key: 'tut',
    title: 'Practice · Toy Works',
    price: 5,
    product: 'toy',
    machines: [
      { id: 'saw', name: 'Saw', rate: 8, icon: 'saw', x: 300, y: 135, role: 'Cuts wood into toy parts' },
      { id: 'mixer', name: 'Paint Mixer', rate: 8, icon: 'drop', x: 300, y: 455, role: 'Mixes bright paint' },
      { id: 'assembler', name: 'Assembler', rate: 8, icon: 'press', x: 560, y: 295, role: 'Paints the parts and puts the toy together' },
      { id: 'wrapper', name: 'Wrapper', rate: 8, icon: 'box', x: 745, y: 295, role: 'Wraps toys for sale' },
    ],
    supplies: [
      { id: 'wood', name: 'Wood', rate: 8, x: 85, y: 135, to: 'saw' },
      { id: 'paint', name: 'Paint', rate: 8, x: 85, y: 455, to: 'mixer' },
    ],
    links: [['saw', 'assembler'], ['mixer', 'assembler'], ['assembler', 'wrapper']],
    sell: { x: 870, y: 295 },
    offers: [],
  };

  let instances = 0;

  function start(mountEl, opts) {
    opts = opts || {};
    if (!mountEl) throw new Error('LMTutorial.start: mountEl is required');
    if (!window.LM || !window.LMUI) throw new Error('LMTutorial needs engine.js and map.js loaded first');
    const LM = window.LM, UI = window.LMUI;
    const esc = UI.esc, usd = UI.usd;
    const fx = opts.fx;
    const onDone = typeof opts.onDone === 'function' ? opts.onDone : null;
    const team = String(opts.teamName || '').trim();
    const soundHint = opts.soundHint === false ? '' : (opts.soundHint || (fx ? 'Tip: the 🔊 button at the top turns sound on or off.' : ''));
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const uid = ++instances;

    const sound = (name) => { try { fx && fx.sound && fx.sound(name); } catch (_) { /* never let fx break the tutorial */ } };
    const confetti = () => { if (reduced) return; try { fx && fx.confetti && fx.confetti(); } catch (_) {} };

    const state = { rates: {}, saving: 0 };
    PRACTICE.machines.forEach((m) => { state.rates[m.id] = m.rate; });
    const perHour = LM.hourly(PRACTICE, state);

    // ---------- runtime state ----------
    let step = 0;
    let destroyed = false, doneCalled = false;
    let tapped = false;
    let choice = null;               // 'paint' | 'keep' | 'timeout'
    let timerT0 = 0, timerRaf = 0;
    let runT0 = 0, runRaf = 0, runDone = false, lastPopHour = 0;
    let hour = 0, cash = START_CASH;
    const timeouts = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timeouts.delete(t); if (!destroyed) fn(); }, ms); timeouts.add(t); return t; };

    // ---------- DOM ----------
    const root = document.createElement('div');
    root.className = 'tut' + (reduced ? ' tut-reduced' : '');
    root.innerHTML = `
      <div class="tut-game">
        <aside class="tut-side tut-left">
          <section class="tut-panel tut-goal"><div class="tut-eyebrow">Goal</div><p>Earn as much money as you can in one 24-hour shift.</p></section>
          <section class="tut-panel tut-shift">
            <div class="tut-eyebrow">${esc(PRACTICE.title)}</div>
            <div class="tut-clockrow" data-hour>Hour 0 of ${SHIFT}</div>
            <div class="tut-clockbar"><div data-clockfill></div></div>
            <div class="tut-cashrow"><small>Cash</small><b data-cash>${usd(START_CASH)}</b></div>
            <svg class="tut-spark" viewBox="0 0 200 44" preserveAspectRatio="none"><line class="tick" x1="66.7" x2="66.7" y1="0" y2="44"/><line class="tick" x1="133.3" x2="133.3" y1="0" y2="44"/><polyline data-spark points=""/></svg>
          </section>
          <section class="tut-panel tut-log"><div class="tut-eyebrow">Shift log</div><ol data-log></ol></section>
        </aside>
        <section class="mapwrap tut-mapwrap">${UI.renderMap(PRACTICE, state, { key: 'tut' + uid })}</section>
        <aside class="tut-side tut-right" data-right></aside>
      </div>
      <svg class="tut-shade" aria-hidden="true">
        <defs><mask id="tutMask${uid}" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="100%" height="100%" fill="#fff"/>
          <rect class="tut-hole" fill="#000"/><rect class="tut-hole" fill="#000"/><rect class="tut-hole" fill="#000"/></mask></defs>
        <rect class="tut-dim" x="0" y="0" width="100%" height="100%" mask="url(#tutMask${uid})"/>
        <rect class="tut-ring"/><rect class="tut-ring"/><rect class="tut-ring"/>
      </svg>
      <div class="tut-fxlayer" aria-hidden="true"></div>
      <div class="tut-coach" role="dialog" aria-live="polite" aria-label="Tutorial"></div>
      <div class="tut-modal"></div>`;
    const explicitHeight = mountEl.clientHeight > 300;   // measured before we add content
    mountEl.appendChild(root);

    const $ = (s) => root.querySelector(s);
    const wrap = $('.tut-mapwrap');
    const coach = $('.tut-coach');
    const modal = $('.tut-modal');
    const fxLayer = $('.tut-fxlayer');
    const shade = $('.tut-shade');
    const holes = Array.from(root.querySelectorAll('.tut-hole'));
    const rings = Array.from(root.querySelectorAll('.tut-ring'));
    const svgMap = wrap.querySelector('svg.map');

    // The factory sign (target of the practice offer). Lives inside the map SVG so it scales with it.
    svgMap.insertAdjacentHTML('beforeend', `
      <g class="tut-sign" transform="translate(640,64)">
        <rect class="post" x="-60" y="12" width="9" height="40" rx="3"/><rect class="post" x="51" y="12" width="9" height="40" rx="3"/>
        <g class="tut-signbody"><rect class="board" x="-94" y="-28" width="188" height="54" rx="13"/>
        <text class="sign-t" y="8">TOY WORKS</text></g>
      </g>`);
    const sign = svgMap.querySelector('.tut-sign');
    if (reduced && svgMap.pauseAnimations) { try { svgMap.pauseAnimations(); } catch (_) {} }

    UI.wireMap(PRACTICE, state, false, wrap);
    const inspector = wrap.querySelector('.inspector');
    const hideInspector = () => inspector && inspector.classList.add('hidden');

    // ---------- sizing (no page scroll) ----------
    function fit() {
      if (destroyed) return;
      if (explicitHeight) { root.style.height = '100%'; return; }
      const top = root.getBoundingClientRect().top + window.scrollY;
      let h = Math.max(400, Math.floor(window.innerHeight - top - 12));
      h = Math.max(400, Math.min(h, Math.round(root.clientWidth * 0.64)));   // don't stretch into a tall, empty map
      root.style.height = h + 'px';
      const over = document.documentElement.scrollHeight - window.innerHeight;
      if (over > 0 && h - over >= 400) root.style.height = (h - over) + 'px';
    }

    // ---------- left sidebar ----------
    const LOG = ['Offer 1', 'Offer 2', 'Offer 3'];
    function setLog() {
      const status = (i) => {
        if (i === 0) {
          if (step === 4) return choice ? { cls: 'did', t: choiceText() } : { cls: 'cur', t: 'Deciding now…' };
          if (step >= 5 && choice) return { cls: 'did', t: choiceText() };
          if (step >= 5) return { cls: 'did', t: 'Practice' };
        }
        if (i === 1 && step >= 5 && runDone) return { cls: 'cur', t: 'Up next' };
        return { cls: '', t: '' };
      };
      $('[data-log]').innerHTML = [0, 8, 16].map((h, i) => {
        const s = status(i);
        return `<li class="${s.cls}"><span class="h">${String(h).padStart(2, '0')}:00</span><span class="t">${LOG[i]}<small>${s.t}</small></span></li>`;
      }).join('');
    }
    function choiceText() {
      return choice === 'paint' ? 'Practice · sign painted' : choice === 'keep' ? 'Practice · kept it brown' : 'Time ran out · nothing bought';
    }
    function setClock(h, c) {
      hour = h; cash = c;
      $('[data-hour]').textContent = `Hour ${Math.floor(h)} of ${SHIFT}`;
      $('[data-clockfill]').style.width = (h / SHIFT * 100) + '%';
      $('[data-cash]').textContent = usd(c);
      const pts = [];
      for (let x = 0; x <= h + 1e-9; x += 0.5) pts.push(x);
      if (pts[pts.length - 1] < h) pts.push(h);
      const y = (v) => (44 - (v / 1500) * 44).toFixed(1);
      $('[data-spark]').setAttribute('points', h > 0 ? pts.map((x) => `${(x / SHIFT * 200).toFixed(1)},${y(START_CASH + perHour * x)}`).join(' ') : '');
    }

    // ---------- right column ----------
    function setRight(kind) {
      const right = $('[data-right]');
      if (kind === 'idle') {
        right.innerHTML = `
          <div class="tut-panel tut-idle">
            <div class="tut-idle-ico">📋</div>
            <b>Offers pop up here</b>
            <span>One at each stop in the shift</span>
          </div>`;
      } else if (kind === 'offer') {
        right.innerHTML = `
          <div class="tut-panel tut-offer tut-pop">
            <div class="tut-timer" data-timer></div>
            <div class="tut-kicker"><span>Practice · doesn't count</span><span class="tut-secs" data-secswrap><span data-secs>${DEC_SECS}</span>s</span></div>
            <h3>Paint the factory sign orange?</h3>
            <p class="tut-blurb">A fresh coat of paint for the Toy Works sign.</p>
            <div class="tut-rows">
              <div class="tut-row"><span>Cost now</span><b>Free</b></div>
              <div class="tut-row"><span>Effect</span><b>Sign turns orange</b></div>
            </div>
          </div>
          <div class="tut-panel tut-actions tut-pop" data-actions>${actionsHTML()}</div>`;
      } else if (kind === 'run') {
        right.innerHTML = `
          <div class="tut-panel tut-running tut-pop">
            <div class="tut-kicker"><span>Running the factory</span></div>
            <div class="tut-simclock" data-simclock>00:00</div>
            <p class="tut-muted">Hours 0–${RUN_HOURS} at ${usd(perHour)}/hr</p>
            <div class="tut-earnbox"><small>Earned so far</small><b data-earned>+$0</b></div>
          </div>`;
      }
    }
    function actionsHTML() {
      if (!choice) {
        return `
          <div class="tut-choices">
            <button class="btn-primary" data-choice="paint"><span>Invest (free)</span><small>Paint it orange</small></button>
            <button class="btn-ghost" data-choice="keep"><span>Don't invest</span><small>Keep it brown</small></button>
          </div>
          <p class="tut-fine">Talk it over. If time runs out, nothing is bought.</p>`;
      }
      const r = {
        paint: ['🎨', 'Sign painted!', 'Looking sharp.'],
        keep: ['👍', 'Kept it brown.', 'Nothing bought.'],
        timeout: ['⏰', 'Time’s up!', 'Nothing was bought.'],
      }[choice];
      return `<div class="tut-result tut-pop"><div class="tut-result-ico">${r[0]}</div><div><b>${r[1]}</b><span>${r[2]}</span></div></div>`;
    }

    function setSign(orange, animate) {
      sign.classList.toggle('orange', !!orange);
      if (orange && animate && !reduced) {
        sign.classList.remove('splash'); void sign.getBBox(); sign.classList.add('splash');
        const r = sign.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, ['✦', '🎨', '✦', '✧', '✦', '✧']);
      }
    }

    // ---------- practice decision timer ----------
    function startTimer() {
      stopTimer();
      timerT0 = performance.now();
      const tick = (now) => {
        if (destroyed || step !== 4 || choice) return;
        const left = DEC_SECS * 1000 - (now - timerT0) * TIMER_SPEED;
        const bar = $('[data-timer]'), secs = $('[data-secs]'), sw = $('[data-secswrap]');
        if (bar) { bar.style.width = Math.max(0, left / (DEC_SECS * 10)) + '%'; bar.classList.toggle('low', left < 10000); }
        if (secs) secs.textContent = Math.max(0, Math.ceil(left / 1000));
        if (sw) sw.classList.toggle('low', left < 10000);
        if (left <= 0) { pick('timeout'); return; }
        timerRaf = requestAnimationFrame(tick);
      };
      timerRaf = requestAnimationFrame(tick);
    }
    function stopTimer() { cancelAnimationFrame(timerRaf); timerRaf = 0; }

    function pick(c) {
      if (step !== 4 || choice) return;
      choice = c;
      stopTimer();
      if (c === 'paint') { sound('coin'); setSign(true, true); }
      else if (c === 'keep') sound('click');
      const a = $('[data-actions]');
      if (a) a.innerHTML = actionsHTML();
      setLog();
      renderCoach();
    }

    // ---------- "watch your cash grow" ----------
    function startRun() {
      stopRun();
      runDone = false; lastPopHour = 0;
      setClock(0, START_CASH);
      setLog();
      sound('roundStart');
      runT0 = performance.now();
      const dur = reduced ? 1200 : RUN_MS;
      const tick = (now) => {
        if (destroyed || step !== 5) return;
        const p = Math.min(1, (now - runT0) / dur);
        const h = RUN_HOURS * p;
        setClock(h, START_CASH + perHour * h);
        const sc = $('[data-simclock]'), ea = $('[data-earned]');
        if (sc) sc.textContent = `${String(Math.floor(h)).padStart(2, '0')}:00`;
        if (ea) ea.textContent = '+' + usd(perHour * h);
        while (lastPopHour < Math.floor(h + 1e-9) && lastPopHour < RUN_HOURS) { lastPopHour++; coinPop(lastPopHour); }
        if (p < 1) runRaf = requestAnimationFrame(tick);
        else { runDone = true; setLog(); renderCoach(); }
      };
      runRaf = requestAnimationFrame(tick);
    }
    function stopRun() { cancelAnimationFrame(runRaf); runRaf = 0; }

    function coinPop(n) {
      if (n % 2 === 1) sound('coin');
      const sell = svgMap.querySelector('.node.sell');
      if (!sell) return;
      const r = sell.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'tut-coin';
      el.innerHTML = `<i>$</i><span>+${usd(perHour)}</span>`;
      el.style.left = (r.left - rr.left + r.width / 2 + (n % 2 ? -14 : 14)) + 'px';
      el.style.top = (r.top - rr.top + r.height * 0.3) + 'px';
      fxLayer.appendChild(el);
      later(() => el.remove(), 1200);
      sell.classList.remove('tut-ping'); void sell.getBBox(); sell.classList.add('tut-ping');
    }

    function burst(cx, cy, glyphs) {
      if (reduced) return;
      const rr = root.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'tut-burst';
      box.style.left = (cx - rr.left) + 'px';
      box.style.top = (cy - rr.top) + 'px';
      const g = glyphs || ['✦', '✧', '★', '✦', '✧', '✦', '★', '✧'];
      box.innerHTML = '<b class="tut-burst-ring"></b>' + g.map((s, i) => {
        const a = (i / g.length) * Math.PI * 2 - Math.PI / 2, d = 46 + (i % 2) * 14;
        return `<i style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px">${s}</i>`;
      }).join('');
      fxLayer.appendChild(box);
      later(() => box.remove(), 1000);
    }

    // ---------- tap-a-machine hint ----------
    function showTapHint(on) {
      const old = fxLayer.querySelector('.tut-tap');
      if (old) old.remove();
      if (!on) return;
      const node = svgMap.querySelector('[data-node="assembler"] .disc');
      if (!node) return;
      const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'tut-tap';
      el.style.left = (r.left - rr.left + r.width / 2) + 'px';
      el.style.top = (r.top - rr.top + r.height / 2) + 'px';
      el.style.setProperty('--d', r.width + 'px');
      el.innerHTML = '<b></b><b></b><span>👆</span>';
      fxLayer.appendChild(el);
    }

    wrap.addEventListener('lm:inspect', (ev) => {
      if (destroyed || step !== 2 || tapped) return;
      tapped = true;
      sound('coin');
      showTapHint(false);
      const id = ev.detail && ev.detail.id;
      const g = id && svgMap.querySelector(`[data-node="${id}"] .disc`);
      if (g) { const r = g.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2); }
      renderCoach();
      coach.classList.remove('tut-cheer'); void coach.offsetWidth; coach.classList.add('tut-cheer');
    });

    // ---------- steps ----------
    const name = team ? esc(team) : '';
    const STEPS = [
      { // 1. Welcome
        modal: () => ({
          badge: '🏭',
          eyebrow: 'Quick practice · about 1 minute',
          title: name ? `Welcome, <span class="tut-name">${name}</span>!` : 'Welcome!',
          body: 'You run a factory for one 24-hour shift. Most cash at the end wins.',
          primary: '<button class="btn-orange tut-big" data-next>Show me how <span aria-hidden="true">→</span></button>',
        }),
      },
      { // 2. The map
        holes: ['.tut-mapwrap'],
        place: { to: '.tut-mapwrap', side: 'right', v: 'top' },
        enter: () => { const hud = wrap.querySelector('.maphud > div'); if (hud) hud.classList.add('tut-hl'); },
        leave: () => { const hud = wrap.querySelector('.maphud > div'); if (hud) hud.classList.remove('tut-hl'); },
        coach: () => ({
          title: 'Your factory',
          body: '<p>Raw materials ride the belts through each machine to <b>Sell</b>. Numbers are units per hour.</p><p>The <b class="tut-chip">Line makes</b> box shows what you sell each hour.</p>',
        }),
      },
      { // 3. Tap a machine
        holes: ['.tut-mapwrap'],
        place: { to: '.tut-mapwrap', side: 'right', v: 'top' },
        enter: () => { if (!tapped) later(() => step === 2 && !tapped && showTapHint(true), reduced ? 0 : 250); },
        leave: () => showTapHint(false),
        canNext: () => tapped,
        coach: () => tapped
          ? { title: 'Nice one! 🎉', body: '<p>That’s how you check any machine during the game.</p>' }
          : { title: 'Your turn 👆', body: '<p><b>Tap any machine</b> on the map to inspect it.</p>', next: 'Tap first' },
      },
      { // 4. Clock and cash
        holes: ['.tut-shift', '.tut-log'],
        place: { to: '.tut-shift', side: 'right', v: 'top' },
        coach: () => ({
          title: 'Clock and cash',
          body: '<p>The shift stops at <b>00:00</b>, <b>08:00</b> and <b>16:00</b>. Each stop brings one offer.</p><p>Your cash is here. It starts at <b>$500</b>.</p>',
        }),
      },
      { // 5. Practice decision
        holes: ['.tut-offer', '[data-actions]', '.tut-sign'],
        place: { to: '[data-actions]', side: 'left', v: 'middle', avoid: '.tut-sign' },
        enter: () => { choice = null; setSign(false); setRight('offer'); startTimer(); },
        leave: () => stopTimer(),
        canNext: () => !!choice,
        coach: () => choice
          ? { title: choice === 'timeout' ? 'That’s the timer' : 'Nice teamwork! 🙌', body: choice === 'timeout'
              ? '<p>When time runs out, nothing is bought. Real offers work the same way.</p>'
              : '<p>Every offer works like this. The real ones count.</p>' }
          : { title: 'Practice offer', body: '<p>Real offers show what they cost now and what they change. Talk as a team and pick one: you get <b>40 seconds</b> <span class="tut-soft">(sped up here)</span>.</p><p>If time runs out, nothing is bought.</p><p><span class="tut-tagline">This one doesn’t count</span></p>', next: 'Pick one' },
      },
      { // 6. Watch your cash grow
        holes: ['.tut-shift', '.tut-mapwrap', '.tut-running'],
        place: { to: '.tut-mapwrap', side: 'inside-bottom' },
        enter: () => { setRight('run'); startRun(); },
        leave: () => stopRun(),
        coach: () => ({
          title: 'Watch your cash grow 💰',
          body: '<p>After each offer the clock runs and your factory earns money.</p>'
            + (runDone ? '<button class="tut-link" data-replay>↻ Play it again</button>' : ''),
        }),
      },
      { // 7. Ready
        modal: () => doneCalled
          ? {
            badge: '✓', badgeCls: 'ok',
            eyebrow: 'All set',
            title: name ? `See you on the floor, <span class="tut-name">${name}</span>!` : 'See you on the floor!',
            body: '',
            primary: '<div class="tut-waiting" role="status"><span class="tut-dotsanim"><i></i><i></i><i></i></span>Waiting for the host to start</div>',
            extra: '<button class="tut-link" data-again>Run through it again</button>',
          }
          : {
            badge: '🚀',
            eyebrow: 'Practice done',
            title: name ? `Ready, <span class="tut-name">${name}</span>?` : 'Ready?',
            body: '2 rounds · 3 offers each · 40 seconds per offer. Talk fast, decide together.',
            primary: '<button class="btn-orange tut-big" data-ready>We’re ready <span aria-hidden="true">✓</span></button>',
            extra: soundHint ? `<p class="tut-soundtip">${esc(soundHint)}</p>` : '',
          },
      },
    ];
    const N = STEPS.length;
    const LAST = N - 1;

    function dotsHTML() {
      return `<div class="tut-dots" aria-label="Step ${step + 1} of ${N}">${STEPS.map((_, i) => `<i class="${i === step ? 'on' : i < step ? 'past' : ''}"></i>`).join('')}</div>`;
    }

    function canNext() { const s = STEPS[step]; return !s.canNext || s.canNext(); }

    function renderCoach() {
      const s = STEPS[step];
      if (s.modal) {
        coach.classList.remove('show');
        coach.innerHTML = '';
        const m = s.modal();
        const back = step > 0 && !(step === LAST && doneCalled) ? '<button class="tut-link" data-back>← Back</button>' : '<span></span>';
        const skip = step < LAST ? '<button class="tut-link" data-skip>Skip tutorial</button>' : '<span></span>';
        modal.innerHTML = `
          <div class="tut-modal-card tut-pop" role="dialog" aria-live="polite" aria-label="Tutorial">
            <div class="tut-badge ${m.badgeCls || ''}">${m.badge}</div>
            <div class="tut-eyebrow">${m.eyebrow}</div>
            <h2>${m.title}</h2>
            ${m.body ? `<p class="tut-lead">${m.body}</p>` : ''}
            <div class="tut-primary">${m.primary}</div>
            ${m.extra || ''}
            <div class="tut-modal-foot">${back}${dotsHTML()}${skip}</div>
          </div>`;
        modal.classList.add('show');
        setHoles();
        focusPrimary(modal);
        return;
      }
      modal.classList.remove('show');
      modal.innerHTML = '';
      const c = s.coach();
      const ok = canNext();
      coach.innerHTML = `
        <div class="tut-coach-arrow"></div>
        <div class="tut-coach-top"><span class="tut-count">Step ${step + 1} of ${N}</span><button class="tut-link" data-skip>Skip</button></div>
        <h3>${c.title}</h3>
        <div class="tut-body">${c.body}</div>
        <div class="tut-foot">${dotsHTML()}<div class="tut-nav">
          <button class="btn-ghost tut-btn" data-back>Back</button>
          <button class="btn-primary tut-btn" data-next ${ok ? '' : 'disabled'}>${ok ? 'Next <span aria-hidden="true">→</span>' : esc(c.next || 'Next')}</button>
        </div></div>`;
      coach.classList.add('show');
      setHoles();
      placeCoach();
      if (ok) focusPrimary(coach);
    }

    function focusPrimary(scope) {
      const b = scope.querySelector('[data-next], [data-ready]');
      if (b && !b.disabled) { try { b.focus({ preventScroll: true }); } catch (_) { b.focus(); } }
    }

    // ---------- spotlight + coach placement ----------
    function relRect(el, pad) {
      const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect();
      return { x: r.left - rr.left - pad, y: r.top - rr.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    }
    function setHoles() {
      const s = STEPS[step];
      const sels = s.modal ? [] : (s.holes || []);
      shade.classList.toggle('modal', !!s.modal);
      holes.forEach((h, i) => {
        const el = sels[i] && root.querySelector(sels[i]);
        const ring = rings[i];
        if (!el) {
          const cx = (parseFloat(h.style.x) || 0) + (parseFloat(h.style.width) || 0) / 2;
          const cy = (parseFloat(h.style.y) || 0) + (parseFloat(h.style.height) || 0) / 2;
          [h, ring].forEach((r) => { r.style.x = cx + 'px'; r.style.y = cy + 'px'; r.style.width = '0px'; r.style.height = '0px'; });
          ring.classList.remove('on');
          return;
        }
        const small = sels[i] === '.tut-sign';
        const r = relRect(el, small ? 8 : 5);
        [h, ring].forEach((x) => {
          x.style.x = r.x + 'px'; x.style.y = r.y + 'px'; x.style.width = Math.max(0, r.w) + 'px'; x.style.height = Math.max(0, r.h) + 'px';
          x.style.rx = (small ? 14 : 20) + 'px';
        });
        ring.classList.add('on');
      });
    }

    function placeCoach(instant) {
      const s = STEPS[step];
      if (s.modal || !s.place) return;
      const target = root.querySelector(s.place.to);
      if (!target) return;
      const W = root.clientWidth, H = root.clientHeight;
      const bw = coach.offsetWidth, bh = coach.offsetHeight;
      const t = relRect(target, 0);
      const gap = 18;
      let x, y, arrow = '';
      if (s.place.side === 'right') { x = t.x + t.w + gap; arrow = 'left'; }
      else if (s.place.side === 'left') { x = t.x - gap - bw; arrow = 'right'; }
      else { x = t.x + (t.w - bw) / 2; }
      if (s.place.side === 'inside-bottom') y = t.y + t.h - bh - 14;
      else if (s.place.v === 'middle') y = t.y + (t.h - bh) / 2;
      else y = t.y + Math.min(40, t.h * 0.08);
      if (s.place.avoid) {               // don't cover something the team should be watching
        const av = root.querySelector(s.place.avoid);
        if (av) {
          const a = relRect(av, 10);
          if (x < a.x + a.w && x + bw > a.x && y < a.y + a.h && y + bh > a.y) y = a.y + a.h;
        }
      }
      // keep inside the tutorial area
      const fx0 = x;
      x = Math.max(8, Math.min(x, W - bw - 8));
      y = Math.max(8, Math.min(y, H - bh - 8));
      if (Math.abs(fx0 - x) > 24) arrow = '';       // pushed onto the target: drop the arrow
      coach.dataset.arrow = arrow;
      const ay = Math.max(22, Math.min(bh - 22, (s.place.v === 'middle' ? t.y + t.h / 2 : t.y + 60) - y));
      coach.style.setProperty('--ay', ay + 'px');
      if (instant) coach.classList.add('tut-noanim');
      coach.style.left = Math.round(x) + 'px';
      coach.style.top = Math.round(y) + 'px';
      if (instant) { void coach.offsetWidth; coach.classList.remove('tut-noanim'); }
    }

    function layout() {
      if (destroyed) return;
      setHoles();
      placeCoach(true);
      if (step === 2 && !tapped) showTapHint(true);
    }

    // ---------- navigation ----------
    function goTo(i) {
      i = Math.max(0, Math.min(LAST, i));
      const prev = STEPS[step];
      if (prev.leave) prev.leave();
      hideInspector();
      const wasModal = !!prev.modal;
      step = i;
      // shared scene state for each step
      if (step <= 4) {
        stopRun(); runDone = false;
        setClock(0, START_CASH);
        if (step < 4) { choice = null; setSign(false); setRight('idle'); }
      }
      const s = STEPS[step];
      if (s.enter) s.enter();
      setLog();
      if (wasModal && !s.modal) coach.classList.add('tut-noanim');
      renderCoach();
      placeCoach(wasModal);
      coach.classList.remove('tut-noanim');
    }
    function next() {
      if (step === LAST) { if (!doneCalled) ready(); return; }
      if (!canNext()) { nudge(); return; }
      sound('click');
      goTo(step + 1);
    }
    function back() {
      if (step === 0 || (step === LAST && doneCalled)) return;
      sound('click');
      goTo(step - 1);
    }
    function nudge() {
      if (step === 2) {
        const t = fxLayer.querySelector('.tut-tap');
        if (t) { t.classList.remove('tut-wiggle'); void t.offsetWidth; t.classList.add('tut-wiggle'); }
      } else if (step === 4) {
        const a = $('[data-actions]');
        if (a) { a.classList.remove('tut-wiggle'); void a.offsetWidth; a.classList.add('tut-wiggle'); }
      }
    }
    function ready() {
      if (doneCalled) return;
      doneCalled = true;
      sound('complete');
      confetti();
      renderCoach();
      try { onDone && onDone(); } catch (e) { setTimeout(() => { throw e; }); }
    }

    function onClick(e) {
      const b = e.target.closest('button');
      if (!b || !root.contains(b)) return;
      if (b.hasAttribute('data-next')) next();
      else if (b.hasAttribute('data-back')) back();
      else if (b.hasAttribute('data-skip')) { sound('click'); goTo(LAST); }
      else if (b.hasAttribute('data-ready')) ready();
      else if (b.hasAttribute('data-choice')) pick(b.dataset.choice);
      else if (b.hasAttribute('data-replay')) { sound('click'); startRun(); renderCoach(); }
      else if (b.hasAttribute('data-again')) { sound('click'); tapped = false; goTo(0); }
    }
    function onKey(e) {
      if (destroyed || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      if (!root.isConnected || !root.offsetParent) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const onButton = t && t.tagName === 'BUTTON';
      if (e.key === 'ArrowRight') { if (step < LAST) { e.preventDefault(); next(); } }
      else if (e.key === 'Enter') { if (!onButton) { e.preventDefault(); next(); } }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    }

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    let resizeQueued = false;
    const onResize = () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => { resizeQueued = false; fit(); layout(); });
    };
    window.addEventListener('resize', onResize);
    const ro = window.ResizeObserver ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(root);

    fit();
    goTo(0);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) layout(); });

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopTimer(); stopRun();
        timeouts.forEach(clearTimeout); timeouts.clear();
        root.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        if (ro) ro.disconnect();
        root.remove();
      },
    };
  }

  window.LMTutorial = { start };
})();
