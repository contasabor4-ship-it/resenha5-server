const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const ioGTA = new Server(server, { path: '/gta', cors: { origin: '*', methods: ['GET', 'POST'] } });
const ioHNS = new Server(server, { path: '/hns', cors: { origin: '*', methods: ['GET', 'POST'] } });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servers: ['gta', 'hns'] });
});

// ===== GTA SERVER =====
const gtaPlayers = new Map();
const gtaRooms = new Map();

function gtaGenerateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

ioGTA.on('connection', (socket) => {
  console.log(`GTA connected: ${socket.id}`);

  socket.on('create_room', (data) => {
    const code = gtaGenerateCode();
    gtaRooms.set(code, {
      code, host: socket.id, players: [],
      status: 'lobby', mission: null, missionStep: 0,
      vehicles: [], chat: [],
    });
    socket.emit('room_created', { code });
  });

  socket.on('join_room', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room) return socket.emit('error_msg', 'Sala nao encontrada');
    if (room.status !== 'lobby') return socket.emit('error_msg', 'Jogo ja comecou');
    if (room.players.length >= 8) return socket.emit('error_msg', 'Sala cheia');

    const nick = (data.nickname || 'Player').slice(0, 16);
    const existing = room.players.find(p => p.id === socket.id);
    if (!existing) {
      room.players.push({
        id: socket.id, nickname: nick,
        x: 0, y: 1, z: 0, rotation: 0, health: 100,
        weapon: null, inVehicle: null, money: 0, isAlive: true,
      });
    }

    socket.join(data.code);
    socket.emit('room_joined', { code: data.code, room, playerId: socket.id });
    ioGTA.to(data.code).emit('players_update', room.players);
  });

  socket.on('start_game', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room || room.host !== socket.id) return;
    room.status = 'playing';
    ioGTA.to(data.code).emit('game_started', { players: room.players });
  });

  socket.on('position', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) { p.x = data.x; p.y = data.y; p.z = data.z; p.rotation = data.rotation; }
    socket.to(data.code).emit('player_moved', { id: socket.id, ...data });
  });

  socket.on('shoot', (data) => {
    socket.to(data.code).emit('player_shoot', { id: socket.id, targetId: data.targetId });
  });

  socket.on('vehicle_enter', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) p.inVehicle = data.vehicleId;
    ioGTA.to(data.code).emit('vehicle_entered', { id: socket.id, vehicleId: data.vehicleId });
  });

  socket.on('vehicle_exit', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) p.inVehicle = null;
    ioGTA.to(data.code).emit('vehicle_exited', { id: socket.id });
  });

  socket.on('chat', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    const msg = { id: uuidv4(), playerId: socket.id, nickname: p?.nickname || '???', text: data.text?.slice(0, 200) || '', timestamp: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 50) room.chat.shift();
    ioGTA.to(data.code).emit('chat_msg', msg);
  });

  socket.on('mission_start', (data) => {
    const room = gtaRooms.get(data.code);
    if (!room || room.host !== socket.id) return;
    room.mission = data.missionType;
    room.missionStep = 0;
    ioGTA.to(data.code).emit('mission_update', { mission: room.mission, step: 0 });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of gtaRooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) { gtaRooms.delete(code); }
        else {
          if (room.host === socket.id) room.host = room.players[0].id;
          ioGTA.to(code).emit('players_update', room.players);
        }
        break;
      }
    }
  });
});

// ===== HNS SERVER =====
const MAP_SIZE = 60;
const BLOCK_SIZE = 4;
const SEEKER_COUNT_BASE = 1;
const SEEKER_COUNT_PER_PLAYERS = 4;
const PREP_TIME = 10;
const ROUND_TIME = 120;
const COLOR_CHANGE_COOLDOWN = 3;

const hnsRooms = new Map();

function hnsGenerateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateMap() {
  const blocks = [];
  for (let i = 0; i < 30; i++) {
    const w = BLOCK_SIZE + Math.floor(Math.random() * 3) * BLOCK_SIZE;
    const h = BLOCK_SIZE + Math.floor(Math.random() * 5) * BLOCK_SIZE;
    const d = BLOCK_SIZE + Math.floor(Math.random() * 3) * BLOCK_SIZE;
    const x = (Math.random() - 0.5) * (MAP_SIZE - w);
    const z = (Math.random() - 0.5) * (MAP_SIZE - d);
    const colors = [0x888888, 0x6b8e23, 0x228b22, 0x8b4513, 0x4682b4, 0x9370db, 0xcd853f, 0x708090, 0xb8860b, 0x556b2f];
    blocks.push({ x, y: h / 2, z, w, h, d, color: colors[Math.floor(Math.random() * colors.length)] });
  }
  for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * (MAP_SIZE - 8);
    const z = (Math.random() - 0.5) * (MAP_SIZE - 8);
    blocks.push({ x, y: 1.5, z, w: 3, h: 3, d: 3, color: 0xdda0dd });
  }
  return blocks;
}

const HIDER_COLORS = [
  0x228b22, 0x556b2f, 0x6b8e23, 0x3cb371, 0x2e8b57,
  0x8b4513, 0xa0522d, 0xd2691e, 0xcd853f, 0xdaa520,
  0x708090, 0x2f4f4f, 0x556b2f, 0x4682b4, 0x4169e1,
];
const SEEKER_COLOR = 0xff0000;

app.post('/create-room', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: 'Nickname obrigatorio' });
  const code = hnsGenerateCode();
  hnsRooms.set(code, {
    code, host: null, players: [], status: 'lobby', map: generateMap(),
    seekers: [], hiders: [], prepTimeLeft: PREP_TIME, roundTimeLeft: ROUND_TIME,
    round: 0, maxRounds: 3, scores: {},
  });
  return res.json({ code });
});

ioHNS.on('connection', (socket) => {
  console.log(`HNS connected: ${socket.id}`);

  socket.on('join_room', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room) return socket.emit('error_msg', 'Sala nao encontrada');
    if (room.status !== 'lobby') return socket.emit('error_msg', 'Jogo ja comecou');
    if (room.players.length >= 16) return socket.emit('error_msg', 'Sala cheia');

    if (!room.players.find(p => p.id === socket.id)) {
      const color = HIDER_COLORS[room.players.length % HIDER_COLORS.length];
      room.players.push({
        id: socket.id, nickname: (data.nickname || 'Player').slice(0, 16),
        x: (Math.random() - 0.5) * MAP_SIZE * 0.6, y: 1,
        z: (Math.random() - 0.5) * MAP_SIZE * 0.6,
        color, currentColor: color, isSeeker: false, isAlive: true, colorChangeCooldown: 0,
      });
      room.scores[socket.id] = 0;
    }

    socket.join(data.code);
    socket.emit('room_joined', {
      code: data.code,
      room: { ...room, players: room.players.map(p => ({ ...p })), map: room.map },
      playerId: socket.id,
    });
    ioHNS.to(data.code).emit('players_update', room.players.map(p => ({ ...p })));
  });

  socket.on('start_game', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error_msg', 'Precisa de pelo menos 2 jogadores');

    room.round++;
    room.status = 'prep';
    room.prepTimeLeft = PREP_TIME;
    room.roundTimeLeft = ROUND_TIME;

    const seekerCount = Math.min(
      Math.floor(room.players.length / SEEKER_COUNT_PER_PLAYERS) + SEEKER_COUNT_BASE,
      Math.floor(room.players.length / 2)
    );
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    room.seekers = [];
    room.hiders = [];

    for (let i = 0; i < room.players.length; i++) {
      const player = room.players[i];
      if (i < seekerCount) {
        player.isSeeker = true;
        player.color = SEEKER_COLOR;
        player.currentColor = SEEKER_COLOR;
        room.seekers.push(player.id);
      } else {
        player.isSeeker = false;
        player.isAlive = true;
        player.color = HIDER_COLORS[i % HIDER_COLORS.length];
        player.currentColor = player.color;
        room.hiders.push(player.id);
      }
      player.x = (Math.random() - 0.5) * MAP_SIZE * 0.4;
      player.z = (Math.random() - 0.5) * MAP_SIZE * 0.4;
    }

    ioHNS.to(data.code).emit('game_start', {
      round: room.round, maxRounds: room.maxRounds,
      prepTime: PREP_TIME, roundTime: ROUND_TIME,
      seekers: room.seekers, hiders: room.hiders,
      players: room.players.map(p => ({ ...p })), map: room.map,
    });

    const prepInterval = setInterval(() => {
      room.prepTimeLeft--;
      ioHNS.to(data.code).emit('timer_update', { prep: room.prepTimeLeft, round: room.roundTimeLeft, phase: room.status });
      if (room.prepTimeLeft <= 0) {
        clearInterval(prepInterval);
        room.status = 'playing';
        ioHNS.to(data.code).emit('phase_change', { phase: 'playing' });

        const roundInterval = setInterval(() => {
          room.roundTimeLeft--;
          ioHNS.to(data.code).emit('timer_update', { prep: 0, round: room.roundTimeLeft, phase: 'playing' });
          const aliveHiders = room.hiders.filter(id => { const p = room.players.find(pl => pl.id === id); return p && p.isAlive; });
          if (room.roundTimeLeft <= 0 || aliveHiders.length === 0) {
            clearInterval(roundInterval);
            hnsEndRound(room, data.code);
          }
        }, 1000);
      }
    }, 1000);
  });

  socket.on('position', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) { p.x = data.x; p.y = data.y; p.z = data.z; p.rotation = data.rotation; }
  });

  socket.on('color_change', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room || room.status !== 'playing') return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (!p || p.isSeeker || !p.isAlive || p.colorChangeCooldown > 0) return;
    p.currentColor = data.color;
    p.colorChangeCooldown = COLOR_CHANGE_COOLDOWN;
    ioHNS.to(data.code).emit('player_color_change', { id: socket.id, color: data.color });
  });

  socket.on('tag', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room || room.status !== 'playing') return;
    const seeker = room.players.find(p => p.id === socket.id);
    if (!seeker || !seeker.isSeeker) return;
    const hider = room.players.find(p => p.id === data.hiderId);
    if (!hider || hider.isSeeker || !hider.isAlive) return;
    if (Math.hypot(seeker.x - hider.x, seeker.z - hider.z) > 3) return;

    hider.isAlive = false;
    seeker.color = 0xffaa00;
    seeker.currentColor = 0xffaa00;
    seeker.isSeeker = false;
    room.hiders = room.hiders.filter(id => id !== hider.id);
    room.seekers.push(hider.id);
    hider.isSeeker = true;
    hider.color = SEEKER_COLOR;
    hider.currentColor = SEEKER_COLOR;

    ioHNS.to(data.code).emit('player_tagged', { taggedId: hider.id, taggerId: socket.id });
    ioHNS.to(data.code).emit('players_update', room.players.map(p => ({ ...p })));

    const aliveHiders = room.hiders.filter(id => { const p = room.players.find(pl => pl.id === id); return p && p.isAlive; });
    if (aliveHiders.length === 0) hnsEndRound(room, data.code);
  });

  socket.on('leave_room', (data) => { hnsLeaveRoom(socket, data?.code); });

  socket.on('disconnect', () => {
    for (const [code, room] of hnsRooms) {
      if (room.players.find(p => p.id === socket.id)) { hnsLeaveRoom(socket, code); break; }
    }
  });
});

function hnsLeaveRoom(socket, code) {
  const room = hnsRooms.get(code);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  room.seekers = room.seekers.filter(id => id !== socket.id);
  room.hiders = room.hiders.filter(id => id !== socket.id);
  delete room.scores[socket.id];
  if (room.players.length === 0) { hnsRooms.delete(code); return; }
  if (room.host === socket.id) room.host = room.players[0].id;
  socket.leave(code);
  ioHNS.to(code).emit('players_update', room.players.map(p => ({ ...p })));
}

function hnsEndRound(room, code) {
  room.status = 'results';
  const aliveHiders = room.hiders.filter(id => { const p = room.players.find(pl => pl.id === id); return p && p.isAlive; });
  for (const id of room.hiders) {
    const p = room.players.find(pl => pl.id === id);
    if (p && p.isAlive) room.scores[id] = (room.scores[id] || 0) + (aliveHiders.length > 0 ? 100 : 50);
  }
  for (const id of room.seekers) {
    const taggedCount = room.hiders.filter(hid => { const hp = room.players.find(pl => pl.id === hid); return hp && !hp.isAlive; }).length;
    room.scores[id] = (room.scores[id] || 0) + taggedCount * 25;
  }
  ioHNS.to(code).emit('round_end', {
    round: room.round, maxRounds: room.maxRounds, hidersWon: aliveHiders.length > 0,
    scores: { ...room.scores }, players: room.players.map(p => ({ ...p })),
  });
  if (room.round >= room.maxRounds) {
    setTimeout(() => {
      room.status = 'lobby'; room.round = 0; room.seekers = []; room.hiders = [];
      ioHNS.to(code).emit('game_end', { scores: { ...room.scores }, players: room.players.map(p => ({ ...p })) });
    }, 5000);
  } else {
    setTimeout(() => {
      room.status = 'lobby';
      ioHNS.to(code).emit('back_to_lobby', { players: room.players.map(p => ({ ...p })), scores: { ...room.scores } });
    }, 5000);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Combined Game Server running on port ${PORT}`);
  console.log(`  GTA: /gta | HNS: /hns`);
});
