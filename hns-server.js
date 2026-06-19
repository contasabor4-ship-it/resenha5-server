const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const MAP_SIZE = 60;
const BLOCK_SIZE = 4;
const SEEKER_COUNT_BASE = 1;
const SEEKER_COUNT_PER_PLAYERS = 4;
const PREP_TIME = 10;
const ROUND_TIME = 120;
const COLOR_CHANGE_COOLDOWN = 3;

const rooms = new Map();

app.post('/create-room', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: 'Nickname obrigatório' });
  const code = generateRoomCode();
  const room = {
    code,
    host: null,
    players: [],
    status: 'lobby',
    map: generateMap(),
    seekers: [],
    hiders: [],
    prepTimeLeft: PREP_TIME,
    roundTimeLeft: ROUND_TIME,
    round: 0,
    maxRounds: 3,
    scores: {},
  };
  rooms.set(code, room);
  return res.json({ code });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

function generateRoomCode() {
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
    const color = colors[Math.floor(Math.random() * colors.length)];
    blocks.push({ x, y: h / 2, z, w, h, d, color });
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

io.on('connection', (socket) => {
  console.log(`HNS connected: ${socket.id}`);

  socket.on('create_room', (data) => {
    const code = generateRoomCode();
    const room = {
      code,
      host: socket.id,
      players: [],
      status: 'lobby',
      map: generateMap(),
      seekers: [],
      hiders: [],
      prepTimeLeft: PREP_TIME,
      roundTimeLeft: ROUND_TIME,
      round: 0,
      maxRounds: 3,
      scores: {},
    };
    rooms.set(code, room);
    socket.emit('room_created', { code });
  });

  socket.on('join_room', (data) => {
    const code = data.code;
    const nickname = data.nickname || 'Player';
    const room = rooms.get(code);
    if (!room) return socket.emit('error_msg', 'Sala não encontrada');
    if (room.status !== 'lobby') return socket.emit('error_msg', 'Jogo já começou');
    if (room.players.length >= 16) return socket.emit('error_msg', 'Sala cheia');

    const existing = room.players.find(p => p.id === socket.id);
    if (!existing) {
      const color = HIDER_COLORS[room.players.length % HIDER_COLORS.length];
      room.players.push({
        id: socket.id,
        nickname,
        x: (Math.random() - 0.5) * MAP_SIZE * 0.6,
        y: 1,
        z: (Math.random() - 0.5) * MAP_SIZE * 0.6,
        color,
        currentColor: color,
        isSeeker: false,
        isAlive: true,
        colorChangeCooldown: 0,
      });
      room.scores[socket.id] = 0;
    }

    socket.join(code);
    socket.emit('room_joined', {
      code,
      room: {
        ...room,
        players: room.players.map(p => ({ ...p })),
        map: room.map,
      },
      playerId: socket.id,
    });
    io.to(code).emit('players_update', room.players.map(p => ({ ...p })));
  });

  socket.on('start_game', (data) => {
    const room = rooms.get(data.code);
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

    io.to(data.code).emit('game_start', {
      round: room.round,
      maxRounds: room.maxRounds,
      prepTime: PREP_TIME,
      roundTime: ROUND_TIME,
      seekers: room.seekers,
      hiders: room.hiders,
      players: room.players.map(p => ({ ...p })),
      map: room.map,
    });

    const prepInterval = setInterval(() => {
      room.prepTimeLeft--;
      io.to(data.code).emit('timer_update', { prep: room.prepTimeLeft, round: room.roundTimeLeft, phase: room.status });
      if (room.prepTimeLeft <= 0) {
        clearInterval(prepInterval);
        room.status = 'playing';
        io.to(data.code).emit('phase_change', { phase: 'playing' });

        const roundInterval = setInterval(() => {
          room.roundTimeLeft--;
          io.to(data.code).emit('timer_update', { prep: 0, round: room.roundTimeLeft, phase: 'playing' });

          const aliveHiders = room.hiders.filter(id => {
            const p = room.players.find(pl => pl.id === id);
            return p && p.isAlive;
          });

          if (room.roundTimeLeft <= 0 || aliveHiders.length === 0) {
            clearInterval(roundInterval);
            endRound(room, data.code);
          }
        }, 1000);
      }
    }, 1000);
  });

  socket.on('position', (data) => {
    const room = rooms.get(data.code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.x = data.x;
      player.y = data.y;
      player.z = data.z;
      player.rotation = data.rotation;
    }
  });

  socket.on('color_change', (data) => {
    const room = rooms.get(data.code);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.isSeeker || !player.isAlive || player.colorChangeCooldown > 0) return;

    player.currentColor = data.color;
    player.colorChangeCooldown = COLOR_CHANGE_COOLDOWN;
    io.to(data.code).emit('player_color_change', { id: socket.id, color: data.color });
  });

  socket.on('tag', (data) => {
    const room = rooms.get(data.code);
    if (!room || room.status !== 'playing') return;
    const seeker = room.players.find(p => p.id === socket.id);
    if (!seeker || !seeker.isSeeker) return;

    const hider = room.players.find(p => p.id === data.hiderId);
    if (!hider || hider.isSeeker || !hider.isAlive) return;

    const dist = Math.hypot(seeker.x - hider.x, seeker.z - hider.z);
    if (dist > 3) return;

    hider.isAlive = false;
    seeker.color = 0xffaa00;
    seeker.currentColor = 0xffaa00;
    seeker.isSeeker = false;

    room.hiders = room.hiders.filter(id => id !== hider.id);
    room.seekers.push(hider.id);
    hider.isSeeker = true;
    hider.color = SEEKER_COLOR;
    hider.currentColor = SEEKER_COLOR;

    io.to(data.code).emit('player_tagged', { taggedId: hider.id, taggerId: socket.id });
    io.to(data.code).emit('players_update', room.players.map(p => ({ ...p })));

    const aliveHiders = room.hiders.filter(id => {
      const p = room.players.find(pl => pl.id === id);
      return p && p.isAlive;
    });
    if (aliveHiders.length === 0) {
      endRound(room, data.code);
    }
  });

  socket.on('leave_room', (data) => {
    leaveRoom(socket, data?.code);
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      if (room.players.find(p => p.id === socket.id)) {
        leaveRoom(socket, code);
        break;
      }
    }
  });
});

function leaveRoom(socket, code) {
  const room = rooms.get(code);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  room.seekers = room.seekers.filter(id => id !== socket.id);
  room.hiders = room.hiders.filter(id => id !== socket.id);
  delete room.scores[socket.id];

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.host === socket.id) {
    room.host = room.players[0].id;
  }

  socket.leave(code);
  io.to(code).emit('players_update', room.players.map(p => ({ ...p })));
}

function endRound(room, code) {
  room.status = 'results';
  const aliveHiders = room.hiders.filter(id => {
    const p = room.players.find(pl => pl.id === id);
    return p && p.isAlive;
  });

  for (const id of room.hiders) {
    const p = room.players.find(pl => pl.id === id);
    if (p && p.isAlive) {
      room.scores[id] = (room.scores[id] || 0) + (aliveHiders.length > 0 ? 100 : 50);
    }
  }
  for (const id of room.seekers) {
    const taggedCount = room.hiders.filter(hid => {
      const hp = room.players.find(pl => pl.id === hid);
      return hp && !hp.isAlive;
    }).length;
    room.scores[id] = (room.scores[id] || 0) + taggedCount * 25;
  }

  io.to(code).emit('round_end', {
    round: room.round,
    maxRounds: room.maxRounds,
    hidersWon: aliveHiders.length > 0,
    scores: { ...room.scores },
    players: room.players.map(p => ({ ...p })),
  });

  if (room.round >= room.maxRounds) {
    setTimeout(() => {
      room.status = 'lobby';
      room.round = 0;
      room.seekers = [];
      room.hiders = [];
      io.to(code).emit('game_end', {
        scores: { ...room.scores },
        players: room.players.map(p => ({ ...p })),
      });
    }, 5000);
  } else {
    setTimeout(() => {
      room.status = 'lobby';
      io.to(code).emit('back_to_lobby', { players: room.players.map(p => ({ ...p })), scores: { ...room.scores } });
    }, 5000);
  }
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Hide & Seek Server running on port ${PORT}`);
});
