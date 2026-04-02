const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/env', (req, res) => res.redirect('/environment.html'));

// ─── CONFIG ───────────────────────────────────────────
const VOTE_INTERVAL_MS = 15_000;
const VALID_SEASONS = ['printemps', 'ete', 'automne', 'hiver'];
const VALID_ALTERS  = ['gravite', 'temps', 'matiere', 'perception'];

// Votes accumules entre chaque tick
const votes = {
  season: {},    // { printemps: 3, ete: 1, ... }
  alter: {},     // { gravite: 2, temps: 5, ... }
  chaos: 0,
  intensity: []  // tableau des valeurs pour faire la moyenne
};

// Etat actif (broadcast a Unity + spectateurs)
const state = {
  season: 'printemps',
  alter: null,       // alteration dominante
  chaos: false,
  intensity: 50,
  spectators: 0
};

// ─── VOTE RESOLUTION ──────────────────────────────────
function resolveVotes() {
  const seasonVoters = Object.values(votes.season).reduce((a, b) => a + b, 0);
  const alterVoters  = Object.values(votes.alter).reduce((a, b) => a + b, 0);
  const totalVoters  = seasonVoters + votes.chaos;

  if (totalVoters === 0 && alterVoters === 0 && votes.intensity.length === 0) return;

  let changed = false;

  // Chaos = majorite
  if (votes.chaos > 0 && votes.chaos >= totalVoters / 2) {
    if (!state.chaos) { state.chaos = true; changed = true; }
  } else {
    if (state.chaos) { state.chaos = false; changed = true; }
  }

  // Saison = top vote
  let topSeason = null, topSC = 0;
  for (const [s, c] of Object.entries(votes.season)) {
    if (c > topSC) { topSC = c; topSeason = s; }
  }
  if (topSeason && topSeason !== state.season) {
    state.season = topSeason;
    changed = true;
  }

  // Alteration = top vote
  let topAlter = null, topAC = 0;
  for (const [a, c] of Object.entries(votes.alter)) {
    if (c > topAC) { topAC = c; topAlter = a; }
  }
  if (topAlter !== state.alter) {
    state.alter = topAlter;
    changed = true;
  }

  // Intensite = moyenne
  if (votes.intensity.length > 0) {
    const avg = Math.round(votes.intensity.reduce((a, b) => a + b, 0) / votes.intensity.length);
    if (avg !== state.intensity) {
      state.intensity = avg;
      changed = true;
    }
  }

  // Log
  const sStr = Object.entries(votes.season).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
  const aStr = Object.entries(votes.alter).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
  console.log(
    `\x1b[1m[VOTE]\x1b[0m Saisons[${sStr}] Alter[${aStr}] Chaos:${votes.chaos} ` +
    `=> \x1b[33m${state.season}\x1b[0m alter=\x1b[36m${state.alter || 'aucune'}\x1b[0m ` +
    `chaos=\x1b[35m${state.chaos}\x1b[0m int=${state.intensity}%`
  );

  // Reset
  votes.season = {};
  votes.alter = {};
  votes.chaos = 0;
  votes.intensity = [];

  // Broadcast result + reset tallies
  io.emit('votes:live', { season: {}, alter: {}, chaos: 0 });
  if (changed) {
    io.emit('state:update', state);
    console.log(`\x1b[32m[>>]\x1b[0m Broadcast a ${state.spectators} client(s)`);
  }
}

setInterval(resolveVotes, VOTE_INTERVAL_MS);

// ─── CONNEXIONS ───────────────────────────────────────
io.on('connection', (socket) => {
  state.spectators++;
  const role = socket.handshake.query.role || 'spectator';

  if (role === 'unity') {
    console.log(`\x1b[35m[UNITY]\x1b[0m Connecte (${socket.id})`);
  } else {
    console.log(`\x1b[36m[+]\x1b[0m ${socket.id} | Total: ${state.spectators}`);
  }

  socket.emit('state:sync', state);
  io.emit('spectators:count', state.spectators);

  // Broadcast les compteurs de votes a tout le monde
  function broadcastTallies() {
    io.emit('votes:live', {
      season: { ...votes.season },
      alter: { ...votes.alter },
      chaos: votes.chaos
    });
  }

  function broadcastPreview() {
    const preview = { ...state };
    let topS = null, topSC = 0;
    for (const [s, c] of Object.entries(votes.season)) {
      if (c > topSC) { topSC = c; topS = s; }
    }
    if (topS) preview.season = topS;
    let topA = null, topAC = 0;
    for (const [a, c] of Object.entries(votes.alter)) {
      if (c > topAC) { topAC = c; topA = a; }
    }
    if (topA) preview.alter = topA;
    const totalV = Object.values(votes.season).reduce((a, b) => a + b, 0) + votes.chaos;
    preview.chaos = votes.chaos > 0 && votes.chaos >= totalV / 2;
    if (votes.intensity.length > 0) {
      preview.intensity = Math.round(votes.intensity.reduce((a, b) => a + b, 0) / votes.intensity.length);
    }
    io.emit('state:preview', preview);
  }

  // Vote saison
  socket.on('vote:season', (season) => {
    if (!VALID_SEASONS.includes(season)) return;
    votes.season[season] = (votes.season[season] || 0) + 1;
    socket.emit('vote:accepted', { type: 'season', value: season });
    broadcastTallies();
    broadcastPreview();
    console.log(`\x1b[90m[vote]\x1b[0m ${socket.id} -> saison:${season}`);
  });

  // Vote alteration
  socket.on('vote:alter', (alter) => {
    if (alter === null) return;
    if (!VALID_ALTERS.includes(alter)) return;
    votes.alter[alter] = (votes.alter[alter] || 0) + 1;
    socket.emit('vote:accepted', { type: 'alter', value: alter });
    broadcastTallies();
    broadcastPreview();
    console.log(`\x1b[90m[vote]\x1b[0m ${socket.id} -> alter:${alter}`);
  });

  // Vote chaos
  socket.on('vote:chaos', () => {
    votes.chaos++;
    socket.emit('vote:accepted', { type: 'chaos' });
    broadcastTallies();
    broadcastPreview();
    console.log(`\x1b[90m[vote]\x1b[0m ${socket.id} -> chaos`);
  });

  // Intensite
  socket.on('intensity:change', (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    votes.intensity.push(Math.round(n));
    // Broadcast live intensity preview so environment reacts immediately
    const avg = Math.round(votes.intensity.reduce((a, b) => a + b, 0) / votes.intensity.length);
    io.emit('intensity:live', avg);
    console.log(`\x1b[90m[int]\x1b[0m ${socket.id} -> ${Math.round(n)}%`);
  });

  // Deconnexion
  socket.on('disconnect', () => {
    state.spectators = Math.max(0, state.spectators - 1);
    if (role === 'unity') {
      console.log(`\x1b[35m[UNITY]\x1b[0m Deconnecte`);
    } else {
      console.log(`\x1b[31m[-]\x1b[0m ${socket.id} | Restants: ${state.spectators}`);
    }
    io.emit('spectators:count', state.spectators);
  });
});

// ─── START ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
\x1b[1m╔═══════════════════════════════════════════════╗
║     M A N I P U L A T I O N  ·  Serveur      ║
╠═══════════════════════════════════════════════╣
║  Vote       : http://localhost:${PORT}             ║
║  Environnmt : http://localhost:${PORT}/env         ║
║  Unity      : ws://localhost:${PORT}?role=unity    ║
║  Vote tick  : ${VOTE_INTERVAL_MS / 1000}s                              ║
╚═══════════════════════════════════════════════╝\x1b[0m
  `);
});
