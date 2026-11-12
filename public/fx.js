/* Line Manager — "juice" module: synthesised sound + lightweight visual effects.
 * Dependency-free. Add one tag: <script src="/fx.js"></script>  → window.FX
 *
 *   FX.sound(name)                 'click' 'coin' 'buy' 'scrap' 'tick' 'roundStart'
 *                                  'countdown' 'go' 'complete' 'badge' 'error'
 *   FX.muted / FX.setMuted(bool)   persisted in localStorage 'lm-muted'
 *   FX.muteButton()                → <button class="fx-mute"> speaker toggle
 *   FX.init({ defaultMuted, volume })
 *   FX.confetti({ x, y, count, duration, colors })
 *   FX.countdown(steps, { onDone, sound, stepMs }) → Promise<{ skipped }>
 *   FX.coinPop(x, y, text, { color, coin })
 *   FX.pulse(el, { scale })
 *   FX.toast(text, { tone, icon, duration })
 *   FX.reducedMotion               live prefers-reduced-motion
 *
 * Every call is wrapped so it never throws, works before DOMContentLoaded and
 * degrades to a no-op where WebAudio / canvas / WAAPI are missing.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.FX && window.FX.__fx) return; // loaded twice: keep the first instance

  var doc = window.document;
  var STORE_KEY = 'lm-muted';
  var PALETTE = ['#f39a1e', '#ffb547', '#4a1f0c', '#2f8a4c', '#c2412a', '#a8673c'];
  var FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif";

  function safe(fn, fallback) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { return fallback; }
    };
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function onBody(fn) {
    if (doc && doc.body) { fn(); return; }
    if (doc) doc.addEventListener('DOMContentLoaded', function () { try { fn(); } catch (e) { /* ignore */ } }, { once: true });
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ styles */
  var CSS = [
    '.fx-layer{position:fixed;inset:0;pointer-events:none;z-index:10000;contain:layout style size;overflow:hidden}',
    '.fx-confetti{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10001;display:block}',

    /* coin pop */
    '.fx-pop{position:absolute;left:0;top:0;will-change:transform}',
    '.fx-pop-in{display:flex;align-items:center;gap:.28em;white-space:nowrap;font:800 18px/1 ' + FONT + ';letter-spacing:-.01em;',
    '  text-shadow:0 0 2px #fff,0 0 2px #fff,0 1px 0 #fff,0 2px 6px rgba(74,31,12,.18);',
    '  animation:fx-pop-rise 900ms cubic-bezier(.2,.75,.3,1) forwards;will-change:transform,opacity}',
    '.fx-pop-in.fx-rm{animation:fx-pop-fade 900ms ease-out forwards}',
    '.fx-coin{flex:none;width:.95em;height:.95em;border-radius:50%;',
    '  background:radial-gradient(circle at 35% 30%,#ffe9a8 0,#ffb547 42%,#f39a1e 72%,#c9761a 100%);',
    '  box-shadow:inset 0 0 0 1.5px rgba(122,59,28,.45),inset 0 0 0 3.5px rgba(255,233,168,.55),0 1px 2px rgba(74,31,12,.25)}',
    '@keyframes fx-pop-rise{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}',
    '  15%{opacity:1;transform:translate(-50%,calc(-50% - 8px)) scale(1.12)}',
    '  60%{opacity:1;transform:translate(-50%,calc(-50% - 28px)) scale(1)}',
    '  100%{opacity:0;transform:translate(-50%,calc(-50% - 40px)) scale(.96)}}',
    '@keyframes fx-pop-fade{0%{opacity:0;transform:translate(-50%,-50%)}15%,60%{opacity:1;transform:translate(-50%,-50%)}100%{opacity:0;transform:translate(-50%,-50%)}}',

    /* countdown */
    '.fx-cd{position:fixed;inset:0;z-index:10002;display:grid;place-items:center;cursor:pointer;user-select:none;-webkit-user-select:none;',
    '  background:radial-gradient(ellipse at 50% 45%,rgba(253,246,236,.94) 0,rgba(251,228,201,.94) 100%);',
    '  font-family:' + FONT + ';color:#4a1f0c;animation:fx-fade-in 160ms ease-out}',
    '.fx-cd.fx-out{animation:fx-fade-out 200ms ease-in forwards}',
    '.fx-cd-step{grid-area:1/1;position:relative;display:grid;place-items:center;width:min(62vmin,520px);height:min(62vmin,520px);',
    '  animation:fx-cd-pop var(--fx-step,600ms) cubic-bezier(.2,.8,.3,1) forwards;will-change:transform,opacity}',
    '.fx-cd-ring{position:absolute;inset:0;border-radius:50%;background:#fff;',
    '  box-shadow:0 0 0 min(1.6vmin,14px) #ffb547,0 24px 60px rgba(74,31,12,.18)}',
    '.fx-cd-num{position:relative;font-weight:800;font-size:min(36vmin,300px);line-height:1;letter-spacing:-.04em;',
    '  font-variant-numeric:tabular-nums}',
    '.fx-cd-go .fx-cd-ring{background:#f39a1e;box-shadow:0 0 0 min(1.6vmin,14px) #4a1f0c,0 24px 60px rgba(243,154,30,.4)}',
    '.fx-cd-go .fx-cd-num{font-size:min(22vmin,190px);color:#fff;text-shadow:0 4px 0 rgba(74,31,12,.25)}',
    '.fx-cd-skip{position:absolute;bottom:4vh;left:0;right:0;text-align:center;font-size:15px;font-weight:500;color:#8a6a55;opacity:.8}',
    '.fx-cd.fx-rm .fx-cd-step{animation-name:fx-cd-fade}',
    '@keyframes fx-cd-pop{0%{opacity:0;transform:scale(.35)}28%{opacity:1;transform:scale(1.07)}45%{transform:scale(1)}',
    '  82%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.12)}}',
    '@keyframes fx-cd-fade{0%{opacity:0}20%,80%{opacity:1}100%{opacity:0}}',
    '@keyframes fx-fade-in{from{opacity:0}to{opacity:1}}',
    '@keyframes fx-fade-out{from{opacity:1}to{opacity:0}}',

    /* toasts */
    '.fx-toasts{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10003;display:flex;flex-direction:column;',
    '  align-items:center;gap:8px;pointer-events:none;width:max-content;max-width:calc(100vw - 32px)}',
    '.fx-toast{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:10px;max-width:100%;',
    '  background:#fff;color:#4a1f0c;border-radius:999px;padding:7px 20px 7px 7px;border:2px solid #ead8c2;',
    '  font:600 16px/1.25 ' + FONT + ';box-shadow:0 12px 30px rgba(74,31,12,.16),0 2px 6px rgba(74,31,12,.08);',
    '  animation:fx-toast-in 340ms cubic-bezier(.2,.9,.3,1.25) both}',
    '.fx-toast-ico{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:17px;font-weight:800;',
    '  background:#fbe4c9;color:#7a3b1c}',
    '.fx-toast-txt{min-width:0;overflow-wrap:anywhere}',
    '.fx-toast-good{border-color:#bfe2c8}.fx-toast-good .fx-toast-ico{background:#e3f4e7;color:#2f8a4c}',
    '.fx-toast-bad{border-color:#f1c3b8}.fx-toast-bad .fx-toast-ico{background:#fbe5df;color:#c2412a}',
    '.fx-toast-info .fx-toast-ico{background:#fbe4c9;color:#7a3b1c}',
    '.fx-toast.fx-out{animation:fx-toast-out 200ms ease-in forwards;pointer-events:none}',
    '.fx-toasts.fx-rm .fx-toast{animation-name:fx-fade-in}.fx-toasts.fx-rm .fx-toast.fx-out{animation-name:fx-fade-out}',
    '@keyframes fx-toast-in{from{opacity:0;transform:translateY(-14px) scale(.92)}to{opacity:1;transform:none}}',
    '@keyframes fx-toast-out{to{opacity:0;transform:translateY(-8px) scale(.95)}}',

    /* mute button */
    '.fx-mute{all:unset;box-sizing:border-box;width:40px;height:40px;border-radius:50%;display:inline-grid;place-items:center;cursor:pointer;',
    '  background:#fff;color:#4a1f0c;border:2px solid #ead8c2;box-shadow:0 4px 12px rgba(74,31,12,.10);flex:none;',
    '  transition:transform .12s ease,border-color .2s,background .2s,color .2s}',
    '.fx-mute:hover{border-color:#a8673c}.fx-mute:active{transform:scale(.92)}',
    '.fx-mute:focus-visible{outline:3px solid #ffb547;outline-offset:2px}',
    '.fx-mute[aria-pressed="true"]{background:#fbe4c9;color:#8a6a55}',
    '.fx-mute svg{width:20px;height:20px;display:block}'
  ].join('\n');

  var styled = false;
  function ensureStyles() {
    if (styled || !doc) return;
    var host = doc.head || doc.documentElement;
    if (!host) return;
    if (doc.getElementById('fx-styles')) { styled = true; return; }
    var s = doc.createElement('style');
    s.id = 'fx-styles';
    s.textContent = CSS;
    host.appendChild(s);
    styled = true;
  }

  var layer = null;
  function getLayer() {
    ensureStyles();
    if (!doc.body) return null;
    if (!layer || !layer.isConnected) {
      layer = doc.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(layer);
    }
    return layer;
  }
  function maybeDropLayer() {
    if (layer && !layer.firstChild) { layer.remove(); layer = null; }
  }

  /* ------------------------------------------------------------------ audio */
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, bus = null, noiseBuf = null;
  var volume = 0.25;
  var muted = false;
  var hasPref = false;
  try {
    var saved = window.localStorage.getItem(STORE_KEY);
    if (saved === '1' || saved === '0') { muted = saved === '1'; hasPref = true; }
  } catch (e) { /* storage blocked */ }

  function buildGraph() {
    actx = new AC();
    var master = actx.createGain();
    master.gain.value = volume;
    // Gentle top cut (laptop speakers are harsh) + compressor so stacked sounds never clip.
    var lp = actx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = 0.5;
    var comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.15;
    master.connect(lp); lp.connect(comp); comp.connect(actx.destination);
    bus = master;
    // 1 s of white noise, shared by every noisy sound.
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function unlock() {
    if (!AC) return;
    try {
      if (!actx) buildGraph();
      if (actx.state !== 'running' && actx.resume) {
        var p = actx.resume();
        if (p && p.then) p.then(checkUnlocked, function () {}); else checkUnlocked();
      } else checkUnlocked();
    } catch (e) { /* ignore */ }
  }
  var GESTURES = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
  function checkUnlocked() {
    if (actx && actx.state === 'running') {
      GESTURES.forEach(function (ev) { window.removeEventListener(ev, unlock, true); });
    }
  }
  if (AC) GESTURES.forEach(function (ev) { window.addEventListener(ev, unlock, true); });

  // One enveloped oscillator voice. Exponential ramps from/to 0.0001 (-80 dB) and the
  // oscillator stops only after the envelope has reached silence, so no clicks.
  function tone(freq, t, dur, o) {
    o = o || {};
    var osc = actx.createOscillator();
    var g = actx.createGain();
    var attack = o.attack || 0.006;
    var peak = o.gain == null ? 0.5 : o.gain;
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (o.hold) g.gain.setValueAtTime(peak, t + attack + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var out = g;
    if (o.lp) {
      var f = actx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7;
      g.connect(f); out = f;
    }
    osc.connect(g); out.connect(bus);
    osc.start(t); osc.stop(t + dur + 0.03);
    osc.onended = function () { try { osc.disconnect(); g.disconnect(); out.disconnect(); } catch (e) { /* ignore */ } };
  }

  // Filtered noise burst; `from`→`to` sweeps the band-pass centre.
  function noise(t, dur, o) {
    o = o || {};
    var src = actx.createBufferSource();
    src.buffer = noiseBuf;
    var f = actx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.from || 2000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var g = actx.createGain();
    var peak = o.gain == null ? 0.4 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.03);
    src.onended = function () { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
  }

  // Equal-tempered notes; everything sits in C major so sounds blend with each other.
  var N = {
    F3: 174.61, A3: 220.0, C4: 261.63, G4: 392.0, C5: 523.25, E5: 659.26, G5: 783.99, A5: 880.0,
    B5: 987.77, C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0
  };

  var SOUNDS = {
    click: function (t) {
      tone(N.C6, t, 0.05, { type: 'sine', to: N.G5, gain: 0.35, attack: 0.003 });
    },
    tick: function (t) {
      tone(N.G6, t, 0.04, { type: 'sine', gain: 0.22, attack: 0.002 });
      tone(N.G5, t, 0.09, { type: 'triangle', gain: 0.4, attack: 0.003 });
    },
    coin: function (t) {
      tone(N.B5, t, 0.08, { gain: 0.35, attack: 0.003 });
      tone(N.E6, t + 0.07, 0.3, { gain: 0.38, attack: 0.004 });
      tone(N.E6 * 2, t + 0.07, 0.16, { type: 'sine', gain: 0.06 }); // a touch of sparkle
    },
    buy: function (t) {
      noise(t, 0.06, { filter: 'highpass', from: 5000, gain: 0.18, attack: 0.003 }); // "cha"
      tone(N.E5, t + 0.02, 0.1, { gain: 0.32 });
      tone(N.C6, t + 0.09, 0.12, { gain: 0.34 });
      tone(N.E6, t + 0.16, 0.34, { gain: 0.36 });
      tone(N.G6, t + 0.16, 0.3, { type: 'sine', gain: 0.1 });
    },
    scrap: function (t) {
      noise(t, 0.42, { from: 2600, to: 280, q: 1.3, gain: 0.55, attack: 0.04 }); // whoosh down
      tone(N.G4, t + 0.02, 0.32, { to: 120, gain: 0.22 });                       // falling "thoop"
      tone(110, t + 0.3, 0.14, { type: 'sine', to: 70, gain: 0.45, attack: 0.004 }); // soft landing
      noise(t + 0.3, 0.07, { from: 900, q: 0.8, gain: 0.18, attack: 0.003 });      // paper scuff
    },
    countdown: function (t) {
      tone(N.C5, t, 0.2, { gain: 0.42, hold: 0.06 });
      tone(N.C6, t, 0.12, { type: 'sine', gain: 0.08 });
    },
    go: function (t) {
      tone(N.C6, t, 0.5, { gain: 0.38, hold: 0.12 });
      tone(N.G5, t, 0.45, { gain: 0.22, hold: 0.1 });
      tone(N.E6, t, 0.4, { type: 'sine', gain: 0.1 });
    },
    roundStart: function (t) {
      [N.G4, N.C5, N.E5].forEach(function (f, i) { tone(f, t + i * 0.07, 0.12, { gain: 0.3 }); });
      tone(N.G5, t + 0.21, 0.42, { gain: 0.36, hold: 0.08 });
      tone(N.C6, t + 0.21, 0.36, { type: 'sine', gain: 0.1 });
    },
    complete: function (t) {
      [N.C5, N.E5, N.G5].forEach(function (f, i) { tone(f, t + i * 0.11, 0.14, { gain: 0.32 }); });
      var e = t + 0.33;
      tone(N.C6, e, 0.75, { gain: 0.36, hold: 0.15 });
      tone(N.G5, e, 0.7, { gain: 0.2, hold: 0.12 });
      tone(N.E5, e, 0.65, { gain: 0.16, hold: 0.1 });
      tone(N.E6, e + 0.12, 0.35, { type: 'sine', gain: 0.1 });
      tone(N.G6, e + 0.2, 0.35, { type: 'sine', gain: 0.08 });
    },
    badge: function (t) {
      [N.G5, N.C6, N.E6, N.G6].forEach(function (f, i) { tone(f, t + i * 0.055, 0.22, { type: 'sine', gain: 0.3 }); });
      tone(N.C7, t + 0.22, 0.7, { type: 'sine', gain: 0.14 });
      tone(N.E6, t + 0.22, 0.6, { gain: 0.18 });
    },
    error: function (t) {
      tone(N.A3, t, 0.13, { type: 'square', gain: 0.2, lp: 1100 });
      tone(N.F3, t + 0.12, 0.22, { type: 'square', gain: 0.2, lp: 900 });
    }
  };
  var MIN_GAP = { coin: 120, tick: 80, click: 35 };
  var lastAt = {};

  function sound(name) {
    if (muted || !actx || !bus || actx.state !== 'running') {
      if (actx && actx.state === 'suspended' && !muted) { try { actx.resume(); } catch (e) { /* ignore */ } }
      return;
    }
    var fn = SOUNDS[name];
    if (!fn) return;
    var ms = now();
    var gap = MIN_GAP[name] || 50; // identical sounds closer than 50 ms only add noise
    if (lastAt[name] && ms - lastAt[name] < gap) return;
    lastAt[name] = ms;
    fn(actx.currentTime + 0.01);
  }

  /* ------------------------------------------------------------------ mute */
  var muteButtons = [];
  var ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2h3.2L12 5.3v13.4l-4.8-3.9H4z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M15.6 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2h3.2L12 5.3v13.4l-4.8-3.9H4z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function paintButton(b) {
    b.innerHTML = muted ? ICON_OFF : ICON_ON;
    b.setAttribute('aria-pressed', muted ? 'true' : 'false');
    var label = muted ? 'Sound off — click to turn on' : 'Sound on — click to mute';
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  function setMuted(v, persist) {
    muted = !!v;
    if (persist !== false) {
      hasPref = true;
      try { window.localStorage.setItem(STORE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    muteButtons.forEach(paintButton);
    try { window.dispatchEvent(new CustomEvent('fx:mute', { detail: { muted: muted } })); } catch (e) { /* ignore */ }
  }
  function muteButton() {
    ensureStyles();
    if (!doc) return null;
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'fx-mute';
    paintButton(b);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      setMuted(!muted);
      if (!muted) { unlock(); setTimeout(function () { sound('click'); }, 30); }
    });
    muteButtons.push(b);
    return b;
  }
  // Keep other tabs (e.g. tutorial + game) in sync.
  window.addEventListener('storage', function (e) {
    if (e.key === STORE_KEY && (e.newValue === '1' || e.newValue === '0')) setMuted(e.newValue === '1', false);
  });

  function init(opts) {
    opts = opts || {};
    if (typeof opts.defaultMuted === 'boolean' && !hasPref) setMuted(opts.defaultMuted, false);
    if (typeof opts.volume === 'number') {
      volume = Math.max(0, Math.min(1, opts.volume));
      if (bus) bus.gain.value = volume;
    }
    ensureStyles();
    return api;
  }

  /* ------------------------------------------------------------------ confetti */
  var cf = { canvas: null, ctx: null, parts: [], raf: 0, last: 0, dpr: 1, w: 0, h: 0 };
  var MAX_PARTS = 450;

  function cfResize() {
    if (!cf.canvas) return;
    cf.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cf.w = window.innerWidth; cf.h = window.innerHeight;
    cf.canvas.width = Math.round(cf.w * cf.dpr);
    cf.canvas.height = Math.round(cf.h * cf.dpr);
  }
  function cfStop() {
    if (cf.raf) cancelAnimationFrame(cf.raf);
    cf.raf = 0; cf.parts.length = 0;
    if (cf.canvas) cf.canvas.remove();
    cf.canvas = cf.ctx = null;
    window.removeEventListener('resize', cfResize);
  }
  function cfFrame(ts) {
    var dt = Math.min(0.05, Math.max(0, (ts - cf.last) / 1000));
    cf.last = ts;
    var c = cf.ctx, dpr = cf.dpr, parts = cf.parts, h = cf.h;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cf.canvas.width, cf.canvas.height);
    var alive = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.age += dt;
      if (p.age >= p.life || p.y > h + 40) continue;
      // physics: gravity, quadratic-ish air drag, sideways flutter
      p.vy += p.g * dt;
      var drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vy *= drag;
      p.x += (p.vx + Math.sin(p.age * p.wf + p.ph) * p.wa) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      var fade = p.life - p.age < 0.5 ? (p.life - p.age) / 0.5 : 1;
      if (p.fadeIn) fade = Math.min(fade, p.age / 0.3);
      c.globalAlpha = fade < 0 ? 0 : fade;
      c.fillStyle = p.color;
      var cs = Math.cos(p.rot) * dpr, sn = Math.sin(p.rot) * dpr, sy = Math.cos(p.tilt);
      c.setTransform(cs, sn, -sn * sy, cs * sy, p.x * dpr, p.y * dpr);
      if (p.round) { c.beginPath(); c.arc(0, 0, p.w / 2, 0, 6.2832); c.fill(); }
      else c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      parts[alive++] = p;
    }
    parts.length = alive;
    if (alive) cf.raf = requestAnimationFrame(cfFrame);
    else cfStop();
  }
  function confetti(opts) {
    opts = opts || {};
    if (!doc || !doc.body) { onBody(function () { confetti(opts); }); return; }
    ensureStyles();
    if (!cf.canvas) {
      var cv = doc.createElement('canvas');
      var ctx2 = cv.getContext && cv.getContext('2d');
      if (!ctx2 || !window.requestAnimationFrame) return;
      cv.className = 'fx-confetti';
      cv.setAttribute('aria-hidden', 'true');
      cf.canvas = cv; cf.ctx = ctx2;
      cfResize();
      doc.body.appendChild(cv);
      window.addEventListener('resize', cfResize);
    }
    var rm = reducedMotion();
    var W = cf.w, H = cf.h;
    var x0 = typeof opts.x === 'number' ? opts.x : W / 2;
    var y0 = typeof opts.y === 'number' ? opts.y : H * 0.22;
    var count = Math.max(0, Math.round(opts.count == null ? 140 : opts.count));
    var life = (opts.duration || 2500) / 1000;
    var colors = opts.colors && opts.colors.length ? opts.colors : PALETTE;
    if (rm) count = Math.min(24, Math.round(count * 0.15));
    count = Math.min(count, MAX_PARTS - cf.parts.length);
    var scale = Math.max(0.8, Math.min(1.4, Math.min(W, H) / 800)); // bigger screens → bigger burst
    for (var i = 0; i < count; i++) {
      var round = Math.random() < 0.3;
      var size = (round ? 5 + Math.random() * 4 : 6 + Math.random() * 6) * scale;
      var p = {
        x: x0, y: y0, age: 0,
        life: life * (0.75 + Math.random() * 0.25),
        color: colors[(Math.random() * colors.length) | 0],
        round: round, w: size, h: round ? size : size * (0.45 + Math.random() * 0.35),
        rot: Math.random() * 6.28, tilt: Math.random() * 6.28
      };
      if (rm) {
        // Reduced motion: a few pieces scattered near the origin that drift down slowly and fade.
        p.x = x0 + (Math.random() - 0.5) * Math.min(W, 600);
        p.y = y0 + (Math.random() - 0.5) * 160;
        p.vx = 0; p.vy = 20 + Math.random() * 20; p.g = 0; p.drag = 0;
        p.vr = 0; p.vt = 0; p.wf = 0; p.wa = 0; p.ph = 0; p.fadeIn = true;
      } else {
        // Upward cone burst, then gravity takes over.
        var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
        var spd = (420 + Math.random() * 720) * scale;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd;
        p.g = 820 * scale; p.drag = 1.6 + Math.random() * 1.2;
        p.vr = (Math.random() - 0.5) * 14; p.vt = 4 + Math.random() * 8;
        p.wf = 3 + Math.random() * 4; p.wa = 20 + Math.random() * 40; p.ph = Math.random() * 6.28;
      }
      cf.parts.push(p);
    }
    if (!cf.raf) {
      if (!cf.parts.length) { cfStop(); return; }
      cf.last = now();
      cf.raf = requestAnimationFrame(cfFrame);
    }
  }

  /* ------------------------------------------------------------------ countdown */
  var activeCd = null;
  function countdown(steps, opts) {
    if (!Array.isArray(steps) || !steps.length) steps = ['3', '2', '1', 'Go!'];
    opts = opts || {};
    var withSound = opts.sound !== false;
    var stepMs = opts.stepMs || 600;
    if (activeCd) activeCd.finish(true);

    return new Promise(function (resolve) {
      var done = false, timers = [], overlay = null;
      function cleanup() {
        timers.forEach(clearTimeout); timers = [];
        window.removeEventListener('keydown', onKey, true);
      }
      function finish(skipped) {
        if (done) return;
        done = true; cleanup();
        if (activeCd && activeCd.finish === finish) activeCd = null;
        var result = { skipped: !!skipped };
        if (overlay) {
          overlay.classList.add('fx-out');
          var ov = overlay;
          setTimeout(function () { ov.remove(); }, skipped ? 120 : 200);
        }
        var cb = function () {
          try { if (typeof opts.onDone === 'function') opts.onDone(result); } catch (e) { /* ignore */ }
          resolve(result);
        };
        if (skipped) cb(); else setTimeout(cb, 200);
      }
      function onKey(e) {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        e.preventDefault(); e.stopPropagation(); // don't let the skip key also press a game button
        finish(true);
      }
      activeCd = { finish: finish };

      onBody(function () {
        if (done) return;
        ensureStyles();
        overlay = doc.createElement('div');
        overlay.className = 'fx-cd' + (reducedMotion() ? ' fx-rm' : '');
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'assertive');
        overlay.style.setProperty('--fx-step', stepMs + 'ms');
        var skip = doc.createElement('div');
        skip.className = 'fx-cd-skip';
        skip.textContent = 'Click or press any key to skip';
        overlay.appendChild(skip);
        overlay.addEventListener('pointerdown', function (e) { e.preventDefault(); finish(true); });
        window.addEventListener('keydown', onKey, true);
        doc.body.appendChild(overlay);

        var cur = null;
        steps.forEach(function (label, i) {
          timers.push(setTimeout(function () {
            if (done) return;
            var last = i === steps.length - 1 && steps.length > 1;
            var el = doc.createElement('div');
            el.className = 'fx-cd-step' + (last ? ' fx-cd-go' : '');
            el.innerHTML = '<div class="fx-cd-ring"></div><div class="fx-cd-num"></div>';
            el.lastChild.textContent = String(label);
            if (cur) cur.remove();
            overlay.insertBefore(el, skip);
            cur = el;
            if (withSound) sound(last ? 'go' : 'countdown');
          }, i * stepMs));
        });
        timers.push(setTimeout(function () { finish(false); }, steps.length * stepMs));
      });
    });
  }

  /* ------------------------------------------------------------------ coin pop */
  var pops = [];
  var MAX_POPS = 40;
  function coinPop(x, y, text, opts) {
    opts = opts || {};
    if (text == null) text = '+$10';
    text = String(text);
    var lay = getLayer();
    if (!lay) return;
    if (typeof x !== 'number' || typeof y !== 'number' || x !== x || y !== y) {
      x = window.innerWidth / 2; y = window.innerHeight / 2;
    }
    while (pops.length >= MAX_POPS) { var old = pops.shift(); clearTimeout(old.t); old.el.remove(); }
    var neg = /^\s*[-−–]/.test(text);
    var outer = doc.createElement('div');
    outer.className = 'fx-pop';
    outer.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    var inner = doc.createElement('div');
    inner.className = 'fx-pop-in' + (reducedMotion() ? ' fx-rm' : '');
    inner.style.color = opts.color || (neg ? '#c2412a' : '#2f8a4c');
    if (opts.coin !== false) {
      var c = doc.createElement('span');
      c.className = 'fx-coin';
      inner.appendChild(c);
    }
    inner.appendChild(doc.createTextNode(text));
    outer.appendChild(inner);
    lay.appendChild(outer); // writes only — nothing reads layout, so no thrash
    var rec = { el: outer, t: 0 };
    rec.t = setTimeout(function () {
      outer.remove();
      var i = pops.indexOf(rec); if (i >= 0) pops.splice(i, 1);
      maybeDropLayer();
    }, 950);
    pops.push(rec);
  }

  /* ------------------------------------------------------------------ pulse */
  var pulseAnims = typeof WeakMap === 'function' ? new WeakMap() : null;
  function pulse(el, opts) {
    if (!el || typeof el.animate !== 'function') return;
    opts = opts || {};
    var prev = pulseAnims && pulseAnims.get(el);
    if (prev) { try { prev.cancel(); } catch (e) { /* ignore */ } }
    var a;
    if (reducedMotion()) {
      a = el.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    } else {
      // Transforms don't apply to inline boxes, so promote plain inline text to inline-block.
      if (window.getComputedStyle && getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
      var s = opts.scale || 1.14;
      var frames = [{ transform: 'scale(1)' }, { transform: 'scale(' + s + ')', offset: 0.3 }, { transform: 'scale(1)' }];
      var timing = { duration: 340, easing: 'cubic-bezier(.3,.7,.4,1)' };
      try { a = el.animate(frames, Object.assign({ composite: 'add' }, timing)); }
      catch (e) { a = el.animate(frames, timing); }
    }
    if (pulseAnims) {
      pulseAnims.set(el, a);
      a.onfinish = function () { if (pulseAnims.get(el) === a) pulseAnims.delete(el); };
    }
  }

  /* ------------------------------------------------------------------ toast */
  var toastBox = null;
  var MAX_TOASTS = 4;
  var DEFAULT_ICONS = { good: '✓', bad: '!', info: 'i' };

  function flipSiblings(box, mutate) {
    // FLIP: remember positions, change the DOM, animate siblings from old to new spot.
    var kids = Array.prototype.slice.call(box.children);
    var before = kids.map(function (k) { return k.getBoundingClientRect().top; });
    mutate();
    if (reducedMotion()) return;
    kids.forEach(function (k, i) {
      if (!k.isConnected || typeof k.animate !== 'function') return;
      var dy = before[i] - k.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) k.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' });
    });
  }
  function dismissToast(t) {
    if (!t || t.__fxGone) return;
    t.__fxGone = true;
    clearTimeout(t.__fxTimer);
    t.classList.add('fx-out');
    setTimeout(function () {
      var box = t.parentNode;
      if (!box) return;
      flipSiblings(box, function () { t.remove(); });
      if (!box.firstChild) { box.remove(); if (toastBox === box) toastBox = null; }
    }, 200);
  }
  function toast(text, opts) {
    opts = opts || {};
    if (!doc || !doc.body) { onBody(function () { toast(text, opts); }); return; }
    ensureStyles();
    if (!toastBox || !toastBox.isConnected) {
      toastBox = doc.createElement('div');
      toastBox.className = 'fx-toasts';
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastBox);
    }
    toastBox.classList.toggle('fx-rm', reducedMotion());
    var tone = opts.tone === 'good' || opts.tone === 'bad' ? opts.tone : 'info';
    var t = doc.createElement('div');
    t.className = 'fx-toast fx-toast-' + tone;
    var ico = doc.createElement('span');
    ico.className = 'fx-toast-ico';
    ico.textContent = opts.icon != null ? String(opts.icon) : DEFAULT_ICONS[tone];
    var tx = doc.createElement('span');
    tx.className = 'fx-toast-txt';
    tx.textContent = text == null ? '' : String(text);
    t.appendChild(ico); t.appendChild(tx);
    t.addEventListener('click', function () { dismissToast(t); });
    var live = Array.prototype.filter.call(toastBox.children, function (k) { return !k.__fxGone; });
    if (live.length >= MAX_TOASTS) dismissToast(live[0]);
    toastBox.appendChild(t);
    t.__fxTimer = setTimeout(function () { dismissToast(t); }, opts.duration || 2500);
    return t;
  }

  /* ------------------------------------------------------------------ api */
  var api = {
    __fx: true,
    sound: safe(sound),
    setMuted: safe(function (v) { setMuted(v); }),
    muteButton: safe(muteButton, null),
    confetti: safe(confetti),
    countdown: function (steps, opts) {
      try { return countdown(steps, opts); }
      catch (e) { return Promise.resolve({ skipped: true }); }
    },
    coinPop: safe(coinPop),
    pulse: safe(pulse),
    toast: safe(toast, null),
    unlock: safe(unlock)
  };
  Object.defineProperty(api, 'muted', {
    enumerable: true,
    get: function () { return muted; },
    set: function (v) { try { setMuted(v); } catch (e) { /* ignore */ } }
  });
  Object.defineProperty(api, 'reducedMotion', { enumerable: true, get: reducedMotion });
  Object.defineProperty(api, 'audioState', {
    enumerable: true,
    get: function () { return !AC ? 'unsupported' : !actx ? 'locked' : actx.state; }
  });
  api.init = safe(init, api);
  window.FX = api;
  try { ensureStyles(); } catch (e) { /* ignore */ }
})();
