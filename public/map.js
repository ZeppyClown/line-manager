// Line Manager — factory map renderer (SVG). Shared by the game (team.js) and the tutorial (tutorial.js).
// Requires engine.js (window.LM). Exposes window.LMUI = { renderMap, wireMap, icon, usd, esc }.
(() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

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
  // Generic renderer: any round-shaped object (machines/supplies/links/sell/price). Also used by the tutorial.
  function renderMap(round, st, opts = {}) {
    const r = opts.key || 'm';
    const fl = LM.flows(round, st);
    const nudges = !!opts.nudges;             // bottleneck glow + pile-ups are Round 2 nudges
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

  function wireMapRound(round, st, nudges, wrap) {
    const r = nudges ? 1 : 0;
    const fl = LM.flows(round, st);
    const box = wrap.querySelector('.inspector');
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
      wrap.dispatchEvent(new CustomEvent('lm:inspect', { detail: { id } }));
    }));
    wrap.addEventListener('click', () => box.classList.add('hidden'));
  }


  window.LMUI = { renderMap, wireMap: wireMapRound, icon, usd, esc };
})();
