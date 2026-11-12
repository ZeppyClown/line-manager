// Line Manager — shared game engine (browser + Node). Deterministic economy.
(function (root) {
  const SHIFT_HOURS = 24;
  const CHECKPOINTS = [0, 8, 16];
  const START_CASH = 500;
  const DECISION_SECONDS = 40;

  const ROUNDS = [
    {
      key: 'r1',
      title: 'Round 1 · Plant A',
      price: 10,
      machines: [
        { id: 'cutter', name: 'Cutter', rate: 9 },
        { id: 'welder', name: 'Welder', rate: 6 },
        { id: 'painter', name: 'Painter', rate: 9 },
        { id: 'boxer', name: 'Boxer', rate: 12 },
      ],
      offers: [
        {
          title: 'Finish the Welder retrofit',
          blurb: 'Last month the factory started a Welder retrofit and it is half done.',
          sunk: 300, cost: 360, effect: { machine: 'welder', rate: 1 },
          bias: 'Sunk cost',
        },
        {
          title: 'Painter overhaul',
          blurb: 'The Painter is the plant’s pride and joy. An overhaul makes it much faster.',
          sunk: 400, cost: 200, effect: { machine: 'painter', rate: 4 },
          bias: 'Escalation of commitment + bottleneck neglect',
        },
        {
          title: 'Welder quick-fix',
          blurb: 'A technician can tune the Welder in an hour.',
          sunk: 0, cost: 60, effect: { machine: 'welder', rate: 2 },
          bias: 'Over-correction (refusing a good deal)',
        },
      ],
    },
    {
      key: 'r2',
      title: 'Round 2 · Plant B',
      price: 12,
      machines: [
        { id: 'mixer', name: 'Mixer 1', rate: 10 },
        { id: 'press', name: 'Press 2', rate: 10 },
        { id: 'freezer', name: 'Freezer 3', rate: 7 },
        { id: 'packer', name: 'Packer 4', rate: 12 },
      ],
      offers: [
        {
          title: 'Finish the Mixer 1 energy retrofit',
          blurb: 'A retrofit to cut Mixer 1’s power bill is half installed.',
          sunk: 500, cost: 360, effect: { saving: 12 },
          bias: 'Sunk cost',
        },
        {
          title: 'Press 2 turbo kit',
          blurb: 'The turbo kit makes Press 2 the fastest machine on the floor.',
          sunk: 350, cost: 180, effect: { machine: 'press', rate: 4 },
          bias: 'Escalation of commitment + bottleneck neglect',
        },
        {
          title: 'Freezer 3 fast-chill',
          blurb: 'A fast-chill coil for Freezer 3.',
          sunk: 0, cost: 96, effect: { machine: 'freezer', rate: 2 },
          bias: 'Over-correction (refusing a good deal)',
        },
      ],
    },
  ];

  function initialState(round) {
    const rates = {};
    for (const m of round.machines) rates[m.id] = m.rate;
    return { rates, saving: 0 };
  }

  function hourly(round, st) {
    const units = Math.min(...Object.values(st.rates));
    return units * round.price + st.saving;
  }

  function bottleneckIds(round, st) {
    const min = Math.min(...Object.values(st.rates));
    return round.machines.filter(m => st.rates[m.id] === min).map(m => m.id);
  }

  function applyEffect(st, effect) {
    const next = { rates: { ...st.rates }, saving: st.saving };
    if (effect.machine) next.rates[effect.machine] += effect.rate;
    if (effect.saving) next.saving += effect.saving;
    return next;
  }

  // Evaluate an offer given the state at that checkpoint.
  function evaluateOffer(round, st, idx) {
    const offer = round.offers[idx];
    const hoursLeft = SHIFT_HOURS - CHECKPOINTS[idx];
    const before = hourly(round, st);
    const after = hourly(round, applyEffect(st, offer.effect));
    const gain = after - before;
    const payback = gain > 0 ? offer.cost / gain : Infinity;
    const net = gain * hoursLeft - offer.cost;
    return { offer, hoursLeft, gain, payback, net, payable: payback <= hoursLeft };
  }

  // choices: array of 'A' (invest) / 'B' (don't). Missing entries = not yet decided.
  function simulate(roundIdx, choices) {
    const round = ROUNDS[roundIdx];
    let st = initialState(round);
    let cash = START_CASH;
    const steps = [];
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      if (choices[i] !== 'A' && choices[i] !== 'B') break;
      const ev = evaluateOffer(round, st, i);
      const invested = choices[i] === 'A';
      const cashBefore = cash;
      if (invested) { cash -= ev.offer.cost; st = applyEffect(st, ev.offer.effect); }
      const end = CHECKPOINTS[i + 1] ?? SHIFT_HOURS;
      const perHour = hourly(round, st);
      const earned = perHour * (end - CHECKPOINTS[i]);
      cash += earned;
      steps.push({ idx: i, choice: choices[i], invested, ev, cashBefore, perHour, earned, cashAfter: cash, rates: { ...st.rates } });
    }
    return { steps, cash, state: st, done: steps.length === CHECKPOINTS.length };
  }

  function bestChoices(roundIdx) {
    // brute force 8 combos
    let best = null;
    for (let m = 0; m < 8; m++) {
      const c = [0, 1, 2].map(b => (m >> b) & 1 ? 'A' : 'B');
      const r = simulate(roundIdx, c);
      if (!best || r.cash > best.cash) best = { choices: c, cash: r.cash };
    }
    return best;
  }

  // Bias Mirror: per-decision feedback comparing to the right call at that moment.
  function mirror(roundIdx, choices) {
    const sim = simulate(roundIdx, choices);
    return sim.steps.map(s => {
      const right = s.ev.payable ? 'A' : 'B';
      const ok = s.choice === right;
      const o = s.ev.offer;
      let text;
      const pb = s.ev.payback === Infinity ? 'would never pay back' : `needed ${fmtH(s.ev.payback)} to pay back`;
      const left = `${s.ev.hoursLeft}h of shift left`;
      if (ok && s.invested) text = `You bought it for $${o.cost}. It ${pb} with ${left}: ${money(s.ev.net)}.`;
      else if (ok) text = o.sunk
        ? `You walked away from the $${o.sunk} already spent. Right call: finishing ${pb}, with only ${left}.`
        : `You passed. Right call: it ${pb}, with ${left}.`;
      else if (s.invested) text = o.sunk
        ? `You paid $${o.cost} more because $${o.sunk} was already in it. It ${pb}, with ${left}. Cost you $${Math.abs(s.ev.net)}.`
        : `You paid $${o.cost}, but it ${pb}, with ${left}. Cost you $${Math.abs(s.ev.net)}.`;
      else text = `You skipped a $${o.cost} upgrade that ${pb}, with ${left}. You missed $${s.ev.net}.`;
      return { idx: s.idx, title: o.title, choice: s.choice, ok, bias: ok ? null : o.bias, delta: ok ? 0 : -Math.abs(s.ev.net), text };
    });
  }

  function fmtH(h) { return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`; }
  function money(n) { return (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }

  const api = { SHIFT_HOURS, CHECKPOINTS, START_CASH, DECISION_SECONDS, ROUNDS, initialState, hourly, bottleneckIds, applyEffect, evaluateOffer, simulate, bestChoices, mirror, fmtH, money };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LM = api;
})(typeof window !== 'undefined' ? window : globalThis);
