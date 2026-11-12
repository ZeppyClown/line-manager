// Line Manager — live game server (HTTP static + WebSocket). In-memory state, snapshot to disk.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const LM = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || 's102';
const STATE_FILE = process.env.STATE_FILE || path.join(require('os').tmpdir(), 'line-manager-state.json');
const MAX_TEAMS = 12;
const PHASES = ['lobby', 'r1', 'r1-reveal', 'r2', 'r2-reveal', 'final'];
const PLAY_PHASE = { 0: 'r1', 1: 'r2' };

// ---------- state ----------
function freshGame() {
  return { phase: 'lobby', teams: [], updatedAt: Date.now() };
}
let game = freshGame();
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved && Array.isArray(saved.teams) && PHASES.includes(saved.phase)) game = saved;
} catch (_) { /* no snapshot */ }

let saveTimer = null;
function save() {
  game.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(game), () => {}), 200);
}

function newRoundRecord() { return { choices: [], predictions: [], timedOut: [], ms: [] }; }

function teamView(t) {
  const rounds = t.rounds.map((r, i) => {
    const sim = LM.simulate(i, r.choices);
    return { ...r, cash: sim.cash, done: sim.done };
  });
  const total = rounds.reduce((s, r) => s + (r.choices.length ? r.cash : 0), 0);
  return { id: t.id, num: t.num, name: t.name, condition: t.condition, online: onlineCount(t.id) > 0, rounds, total };
}

function stats() {
  const out = {};
  for (const ri of [0, 1]) {
    const groups = { control: blank(), tag: blank(), all: blank() };
    for (const t of game.teams) {
      const r = t.rounds[ri];
      if (!r || !r.choices.length) continue;
      const sim = LM.simulate(ri, r.choices);
      const gs = [groups.all, groups[t.condition]];
      for (const s of sim.steps) {
        for (const g of gs) {
          if (s.ev.payable) { g.goodSeen++; if (s.invested) g.goodTaken++; }
          else { g.badSeen++; if (s.invested) g.badTaken++; }
          if (ri === 1 && r.predictions[s.idx] != null) {
            g.predSeen++;
            if ((r.predictions[s.idx] === 'yes') === s.ev.payable) g.predRight++;
          }
        }
      }
      if (sim.done) for (const g of gs) { g.done++; g.cashSum += sim.cash; }
    }
    out[ri] = groups;
  }
  return out;
  function blank() { return { badSeen: 0, badTaken: 0, goodSeen: 0, goodTaken: 0, predSeen: 0, predRight: 0, done: 0, cashSum: 0 }; }
}

function publicState() {
  const teams = game.teams.map(teamView);
  const leaderboard = teams.map(t => ({ id: t.id, num: t.num, name: t.name, total: t.total, condition: t.condition }))
    .sort((a, b) => b.total - a.total);
  return { phase: game.phase, teams, leaderboard, stats: stats() };
}

// ---------- sockets ----------
const sockets = new Set(); // ws with .role, .teamId
function onlineCount(teamId) { let n = 0; for (const ws of sockets) if (ws.teamId === teamId) n++; return n; }

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast() {
  save();
  const st = publicState();
  for (const ws of sockets) {
    if (ws.role === 'host') send(ws, { type: 'state', state: st });
    else if (ws.role === 'team') {
      const you = st.teams.find(t => t.id === ws.teamId);
      if (!you) { send(ws, { type: 'kicked' }); continue; }
      const showBoard = game.phase === 'final';
      send(ws, {
        type: 'state', phase: st.phase, you,
        teamCount: st.teams.length,
        rank: showBoard ? st.leaderboard.findIndex(l => l.id === you.id) + 1 : null,
        leaderboard: showBoard ? st.leaderboard.map(l => ({ num: l.num, name: l.name, total: l.total })) : null,
      });
    }
  }
}

function cleanName(s) {
  return String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function handleTeam(ws, msg) {
  if (msg.type === 'join') {
    let t = msg.teamId && game.teams.find(x => x.id === msg.teamId);
    if (!t) {
      if (msg.teamId && !msg.name) return send(ws, { type: 'needName' });
      if (game.teams.length >= MAX_TEAMS) return send(ws, { type: 'error', message: 'The game is full.' });
      const name = cleanName(msg.name);
      if (!name) return send(ws, { type: 'error', message: 'Please enter a team name.' });
      if (game.teams.some(x => x.name.toLowerCase() === name.toLowerCase())) return send(ws, { type: 'error', message: 'That name is taken.' });
      const num = (game.teams.reduce((m, x) => Math.max(m, x.num), 0)) + 1;
      t = { id: crypto.randomBytes(8).toString('hex'), num, name, condition: num % 2 ? 'control' : 'tag', rounds: [newRoundRecord(), newRoundRecord()] };
      game.teams.push(t);
    }
    ws.role = 'team'; ws.teamId = t.id;
    send(ws, { type: 'joined', teamId: t.id });
    return broadcast();
  }
  if (msg.type === 'decide') {
    const t = game.teams.find(x => x.id === ws.teamId);
    if (!t) return;
    const ri = msg.round, idx = msg.idx;
    if (ri !== 0 && ri !== 1) return;
    // Accept during that round's play phase or later (late/offline-queued answers), never before.
    if (PHASES.indexOf(game.phase) < PHASES.indexOf(PLAY_PHASE[ri])) return;
    const r = t.rounds[ri];
    if (idx !== r.choices.length || idx > 2) return broadcast(); // duplicate/out of order: resync client
    if (msg.choice !== 'A' && msg.choice !== 'B') return;
    r.choices.push(msg.choice);
    r.predictions[idx] = msg.prediction === 'yes' || msg.prediction === 'no' ? msg.prediction : null;
    r.timedOut[idx] = !!msg.timedOut;
    r.ms[idx] = Math.max(0, Math.min(600000, Number(msg.ms) || 0));
    return broadcast();
  }
}

function handleHost(ws, msg) {
  switch (msg.type) {
    case 'setPhase':
      if (!PHASES.includes(msg.phase)) return;
      game.phase = msg.phase; break;
    case 'toggleCondition': {
      const t = game.teams.find(x => x.id === msg.teamId);
      if (t) t.condition = t.condition === 'control' ? 'tag' : 'control';
      break;
    }
    case 'removeTeam':
      game.teams = game.teams.filter(x => x.id !== msg.teamId); break;
    case 'forceFinish': {
      const ri = game.phase === 'r1' ? 0 : game.phase === 'r2' ? 1 : null;
      if (ri == null) return;
      for (const t of game.teams) {
        const r = t.rounds[ri];
        while (r.choices.length < 3) { const i = r.choices.length; r.choices.push('B'); r.predictions[i] = null; r.timedOut[i] = true; r.ms[i] = 0; }
      }
      break;
    }
    case 'reset':
      game = freshGame(); break;
    default: return;
  }
  broadcast();
}

// ---------- http ----------
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function csv() {
  const rows = [['team_num', 'team', 'condition_r1', 'round', 'decision', 'offer', 'choice', 'payable', 'prediction', 'timed_out', 'decide_ms', 'cash_after_round']];
  for (const t of game.teams) {
    t.rounds.forEach((r, ri) => {
      const sim = LM.simulate(ri, r.choices);
      sim.steps.forEach(s => rows.push([t.num, t.name, t.condition, ri + 1, s.idx + 1, s.ev.offer.title, s.invested ? 'invest' : 'skip', s.ev.payable, r.predictions[s.idx] ?? '', r.timedOut[s.idx] ? 1 : 0, r.ms[s.idx] ?? '', sim.done ? sim.cash : '']));
    });
  }
  return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (p === '/qr.svg') {
    const target = url.searchParams.get('u') || '';
    const svg = await QRCode.toString(target.slice(0, 300), { type: 'svg', margin: 1, color: { dark: '#4a1f0c', light: '#00000000' } });
    res.writeHead(200, { 'Content-Type': TYPES['.svg'], 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  if (p === '/export.csv') {
    if (url.searchParams.get('key') !== HOST_KEY) { res.writeHead(403); return res.end('forbidden'); }
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="line-manager-results.csv"' });
    return res.end(csv());
  }
  let file = p === '/' ? 'team.html' : p === '/host' ? 'host.html' : p.slice(1);
  const full = path.normalize(path.join(PUB, file));
  if (!full.startsWith(PUB + path.sep)) { res.writeHead(400); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  sockets.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') return send(ws, { type: 'pong' });
    if (msg.type === 'host') {
      if (msg.key !== HOST_KEY) return send(ws, { type: 'error', message: 'Wrong host key.' });
      ws.role = 'host';
      return send(ws, { type: 'state', state: publicState() });
    }
    if (ws.role === 'host') return handleHost(ws, msg);
    return handleTeam(ws, msg);
  });
  ws.on('close', () => { sockets.delete(ws); if (ws.role === 'team') broadcast(); });
});
setInterval(() => {
  for (const ws of sockets) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 20000);

server.listen(PORT, () => console.log(`Line Manager on :${PORT}  (host: /host?key=${HOST_KEY})`));
