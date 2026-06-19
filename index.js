const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const hns = io.of('/hns');

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servers: ['gta', 'hns'] });
});

app.get('/keepalive', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ===== GTA SERVER =====
const TICK_RATE = 20;
const WORLD_SIZE = 200;

const gtaPlayers = new Map();
const gtaVehicles = [];
const gtaProjectiles = [];
const gtaHouses = [];
const gtaKillfeed = [];

const WEAPONS = {
  pistol: { name: 'Pistol', damage: 25, fireRate: 400, ammo: 30, spread: 0.02, recoil: 0.03 },
  shotgun: { name: 'Shotgun', damage: 15, fireRate: 800, ammo: 12, spread: 0.08, recoil: 0.06 },
  smg: { name: 'SMG', damage: 15, fireRate: 100, ammo: 60, spread: 0.04, recoil: 0.02 },
  rifle: { name: 'Rifle', damage: 40, fireRate: 600, ammo: 20, spread: 0.01, recoil: 0.05 },
};

const VEHICLE_MODELS = [
  { name: 'Sedan', maxSpeed: 45, acceleration: 18, color: 0xcc3333, handling: 0.92 },
  { name: 'SUV', maxSpeed: 38, acceleration: 14, color: 0x3333cc, handling: 0.88 },
  { name: 'Sports', maxSpeed: 60, acceleration: 25, color: 0xddcc00, handling: 0.95 },
  { name: 'Truck', maxSpeed: 28, acceleration: 10, color: 0x33aa33, handling: 0.82 },
  { name: 'Muscle', maxSpeed: 50, acceleration: 22, color: 0xff6600, handling: 0.90 },
  { name: 'Coupe', maxSpeed: 52, acceleration: 20, color: 0x9933cc, handling: 0.93 },
];

const HOUSE_TEMPLATES = [
  { name: 'Casa Pequena', price: 3000, w: 8, h: 5, d: 8, color: 0xaa8866, interior: true },
  { name: 'Casa Media', price: 8000, w: 12, h: 7, d: 10, color: 0x887766, interior: true },
  { name: 'Casa Grande', price: 20000, w: 16, h: 9, d: 14, color: 0x776655, interior: true },
  { name: 'Mansao', price: 50000, w: 22, h: 12, d: 18, color: 0x665544, interior: true },
];

function spawnVehicles() {
  gtaVehicles.length = 0;
  const streetPositions = [];
  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x += 20) {
    streetPositions.push({ x, z: (Math.floor(Math.random() * 6) - 3) * 20 + (Math.random() - 0.5) * 8 });
    streetPositions.push({ x: (Math.floor(Math.random() * 6) - 3) * 20 + (Math.random() - 0.5) * 8, z: x });
  }
  for (let i = 0; i < 20; i++) {
    const model = VEHICLE_MODELS[i % VEHICLE_MODELS.length];
    const pos = streetPositions[i % streetPositions.length];
    gtaVehicles.push({
      id: `vehicle_${i}`,
      model: model.name,
      x: pos.x + (Math.random() - 0.5) * 4,
      y: 0.5,
      z: pos.z + (Math.random() - 0.5) * 4,
      rotation: Math.random() * Math.PI * 2,
      speed: 0,
      maxSpeed: model.maxSpeed,
      acceleration: model.acceleration,
      handling: model.handling,
      color: model.color,
      driver: null,
      health: 100,
    });
  }
}

function spawnHouses() {
  gtaHouses.length = 0;
  const neighborhoods = [
    { cx: 70, cz: 70 }, { cx: -70, cz: 70 },
    { cx: 70, cz: -70 }, { cx: -70, cz: -70 },
  ];
  let id = 0;
  for (const n of neighborhoods) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const template = HOUSE_TEMPLATES[Math.floor(Math.random() * HOUSE_TEMPLATES.length)];
        gtaHouses.push({
          id: `house_${id++}`,
          name: template.name,
          price: template.price,
          x: n.cx + col * 20,
          z: n.cz + row * 20,
          w: template.w,
          h: template.h,
          d: template.d,
          color: template.color,
          owner: null,
          interior: template.interior,
        });
      }
    }
  }
}

spawnVehicles();
spawnHouses();

function respawnVehicle(vehicle) {
  const model = VEHICLE_MODELS.find(m => m.name === vehicle.model) || VEHICLE_MODELS[0];
  vehicle.x = (Math.random() - 0.5) * WORLD_SIZE * 0.7;
  vehicle.z = (Math.random() - 0.5) * WORLD_SIZE * 0.7;
  vehicle.rotation = Math.random() * Math.PI * 2;
  vehicle.speed = 0;
  vehicle.driver = null;
  vehicle.health = 100;
  io.emit('vehicle_update', vehicle);
}

setInterval(() => {
  for (const v of gtaVehicles) {
    if (!v.driver && v.health < 100) {
      v.health = Math.min(100, v.health + 2);
    }
  }
}, 5000);

io.on('connection', (socket) => {
  console.log(`GTA connected: ${socket.id}`);

  socket.on('join', (data) => {
    const weaponKeys = Object.keys(WEAPONS);
    const startWeapon = weaponKeys[Math.floor(Math.random() * weaponKeys.length)];
    const player = {
      id: socket.id,
      nickname: (data.nickname || 'Player').slice(0, 16),
      x: (Math.random() - 0.5) * 20,
      y: 1,
      z: (Math.random() - 0.5) * 20,
      rotation: 0,
      health: 100,
      armor: 0,
      money: 1000,
      kills: 0,
      deaths: 0,
      weapon: startWeapon,
      ammo: WEAPONS[startWeapon].ammo,
      inVehicle: null,
      isAlive: true,
      speed: 0,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    };
    gtaPlayers.set(socket.id, player);
    socket.emit('welcome', {
      player,
      vehicles: gtaVehicles,
      houses: gtaHouses,
      weapons: WEAPONS,
      worldSize: WORLD_SIZE,
    });
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('position', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player) return;
    player.x = data.x; player.y = data.y; player.z = data.z;
    player.rotation = data.rotation; player.speed = data.speed || 0;
  });

  socket.on('vehicle_enter', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player || player.inVehicle) return;
    const vehicle = gtaVehicles.find(v => v.id === data.vehicleId);
    if (!vehicle || vehicle.driver) return;
    if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > 6) return;
    vehicle.driver = socket.id;
    player.inVehicle = vehicle.id;
    io.emit('vehicle_update', vehicle);
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('vehicle_exit', () => {
    const player = gtaPlayers.get(socket.id);
    if (!player || !player.inVehicle) return;
    const vehicle = gtaVehicles.find(v => v.id === player.inVehicle);
    if (vehicle) { vehicle.driver = null; vehicle.speed = 0; io.emit('vehicle_update', vehicle); }
    player.inVehicle = null; player.x += 3;
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('vehicle_position', (data) => {
    const vehicle = gtaVehicles.find(v => v.driver === socket.id);
    if (!vehicle) return;
    vehicle.x = data.x; vehicle.y = data.y; vehicle.z = data.z;
    vehicle.rotation = data.rotation; vehicle.speed = data.speed;
  });

  socket.on('shoot', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player || !player.isAlive || player.ammo <= 0 || player.inVehicle) return;
    const weapon = WEAPONS[player.weapon];
    if (!weapon) return;
    player.ammo--;
    gtaProjectiles.push({
      id: uuidv4(), ownerId: socket.id,
      x: data.x, y: data.y, z: data.z,
      dirX: data.dirX, dirZ: data.dirZ,
      speed: 100, damage: weapon.damage, life: 1.5,
    });
    io.emit('projectile_new', gtaProjectiles[gtaProjectiles.length - 1]);
  });

  socket.on('weapon_switch', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player || !WEAPONS[data.weapon]) return;
    player.weapon = data.weapon;
    player.ammo = WEAPONS[data.weapon].ammo;
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('buy_house', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player) return;
    const house = gtaHouses.find(h => h.id === data.houseId);
    if (!house || house.owner) return;
    if (Math.hypot(player.x - house.x, player.z - house.z) > 15) return;
    if (player.money < house.price) return socket.emit('error_msg', 'Dinheiro insuficiente');
    player.money -= house.price;
    house.owner = socket.id;
    socket.emit('house_bought', { houseId: house.id, money: player.money });
    io.emit('houses_update', gtaHouses.map(h => ({ id: h.id, owner: h.owner, name: h.name })));
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('respawn', () => {
    const player = gtaPlayers.get(socket.id);
    if (!player || player.isAlive) return;
    player.isAlive = true; player.health = 100; player.armor = 0;
    player.x = (Math.random() - 0.5) * 20;
    player.z = (Math.random() - 0.5) * 20;
    if (player.inVehicle) {
      const vehicle = gtaVehicles.find(v => v.id === player.inVehicle);
      if (vehicle) { vehicle.driver = null; io.emit('vehicle_update', vehicle); }
      player.inVehicle = null;
    }
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('chat', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player) return;
    io.emit('chat_message', {
      id: uuidv4(), nickname: player.nickname,
      message: (data.message || '').slice(0, 200), timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    const player = gtaPlayers.get(socket.id);
    if (player && player.inVehicle) {
      const vehicle = gtaVehicles.find(v => v.id === player.inVehicle);
      if (vehicle) { vehicle.driver = null; io.emit('vehicle_update', vehicle); }
    }
    gtaPlayers.delete(socket.id);
    io.emit('players_update', Array.from(gtaPlayers.values()));
    console.log(`GTA disconnected: ${socket.id}`);
  });
});

setInterval(() => {
  for (const proj of gtaProjectiles) {
    proj.x += proj.dirX * proj.speed * (1 / TICK_RATE);
    proj.z += proj.dirZ * proj.speed * (1 / TICK_RATE);
    proj.life -= 1 / TICK_RATE;
    for (const [id, player] of gtaPlayers) {
      if (id === proj.ownerId || !player.isAlive) continue;
      if (Math.hypot(proj.x - player.x, proj.z - player.z) < 1.5) {
        let dmg = proj.damage;
        if (player.armor > 0) {
          const absorbed = Math.min(player.armor, dmg * 0.6);
          player.armor -= absorbed;
          dmg -= absorbed;
        }
        player.health -= dmg;
        if (player.health <= 0) {
          player.health = 0; player.isAlive = false; player.deaths++;
          const killer = gtaPlayers.get(proj.ownerId);
          if (killer) {
            killer.money += 500; killer.kills++;
            gtaKillfeed.unshift({ killer: killer.nickname, victim: player.nickname, weapon: killer.weapon, time: Date.now() });
            if (gtaKillfeed.length > 10) gtaKillfeed.pop();
          }
          io.emit('player_death', { killerId: proj.ownerId, victimId: id, killerName: killer?.nickname || '???', victimName: player.nickname });
          io.emit('killfeed', gtaKillfeed);
          io.emit('players_update', Array.from(gtaPlayers.values()));
        }
        proj.life = 0; break;
      }
    }
  }
  for (let i = gtaProjectiles.length - 1; i >= 0; i--) {
    if (gtaProjectiles[i].life <= 0) gtaProjectiles.splice(i, 1);
  }
  io.emit('projectiles_update', gtaProjectiles.map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z })));
}, 1000 / TICK_RATE);

// ===== HNS SERVER =====
const HNS_MAP_SIZE = 100;
const HNS_BLOCK_SIZE = 4;
const PREP_TIME = 10;
const ROUND_TIME = 120;
const COLOR_CHANGE_COOLDOWN = 3;

const hnsRooms = new Map();

function hnsGenerateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateHnsMap() {
  const blocks = [];
  const colors = [0x888888, 0x6b8e23, 0x228b22, 0x8b4513, 0x4682b4, 0x9370db, 0xcd853f, 0x708090, 0xb8860b, 0x556b2f, 0x4a4a4a, 0x3d6b3d, 0x6b3d3d, 0x3d3d6b];

  for (let i = 0; i < 60; i++) {
    const w = HNS_BLOCK_SIZE + Math.floor(Math.random() * 4) * HNS_BLOCK_SIZE;
    const h = HNS_BLOCK_SIZE + Math.floor(Math.random() * 6) * HNS_BLOCK_SIZE;
    const d = HNS_BLOCK_SIZE + Math.floor(Math.random() * 4) * HNS_BLOCK_SIZE;
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - w);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - d);
    blocks.push({ x, y: h / 2, z, w, h, d, color: colors[Math.floor(Math.random() * colors.length)] });
  }

  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 8);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 8);
    blocks.push({ x, y: 1.5, z, w: 3, h: 3, d: 3, color: 0xdda0dd });
  }

  for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 4);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 4);
    const s = 1 + Math.random() * 2;
    blocks.push({ x, y: s / 2, z, w: s, h: s, d: s, color: colors[Math.floor(Math.random() * colors.length)] });
  }

  for (let i = 0; i < 30; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    blocks.push({ x, y: 0.5, z, w: 1.5, h: 1, d: 1.5, color: 0x666666 });
  }

  for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    blocks.push({ x, y: 4, z, w: 6, h: 0.5, d: 6, color: 0x8B4513 });
    blocks.push({ x: x - 2.5, y: 2, z, w: 1, h: 4, d: 1, color: 0x8B4513 });
    blocks.push({ x: x + 2.5, y: 2, z, w: 1, h: 4, d: 1, color: 0x8B4513 });
  }

  for (let i = 0; i < 10; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 10);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 10);
    blocks.push({ x, y: 8, z, w: 10, h: 0.3, d: 10, color: 0x556b2f });
    for (let dx = -1; dx <= 1; dx += 2) {
      for (let dz = -1; dz <= 1; dz += 2) {
        blocks.push({ x: x + dx * 4, y: 4, z: z + dz * 4, w: 1, h: 8, d: 1, color: 0x666666 });
      }
    }
  }

  return blocks;
}

const HIDER_COLORS = [
  0x228b22, 0x556b2f, 0x6b8e23, 0x3cb371, 0x2e8b57,
  0x8b4513, 0xa0522d, 0xd2691e, 0xcd853f, 0xdaa520,
  0x708090, 0x2f4f4f, 0x556b2f, 0x4682b4, 0x4169e1,
];
const SEEKER_COLOR = 0xff0000;

hns.on('connection', (socket) => {
  console.log(`HNS connected: ${socket.id}`);

  socket.on('create_room', () => {
    const code = hnsGenerateCode();
    hnsRooms.set(code, {
      code, host: null, players: [], status: 'lobby', map: generateHnsMap(),
      seekers: [], hiders: [], prepTimeLeft: PREP_TIME, roundTimeLeft: ROUND_TIME,
      round: 0, maxRounds: 3, scores: {},
    });
    socket.emit('room_created', { code });
  });

  socket.on('join_room', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room) return socket.emit('error_msg', 'Sala nao encontrada');
    if (room.status !== 'lobby') return socket.emit('error_msg', 'Jogo ja comecou');
    if (room.players.length >= 16) return socket.emit('error_msg', 'Sala cheia');

    if (!room.players.find(p => p.id === socket.id)) {
      const color = HIDER_COLORS[room.players.length % HIDER_COLORS.length];
      room.players.push({
        id: socket.id, nickname: (data.nickname || 'Player').slice(0, 16),
        x: (Math.random() - 0.5) * HNS_MAP_SIZE * 0.6, y: 1,
        z: (Math.random() - 0.5) * HNS_MAP_SIZE * 0.6,
        color, currentColor: color, isSeeker: false, isAlive: true, colorChangeCooldown: 0,
      });
      room.scores[socket.id] = 0;
      if (room.host === null) room.host = socket.id;
    }

    socket.join(data.code);
    socket.emit('room_joined', {
      code: data.code,
      room: { ...room, players: room.players.map(p => ({ ...p })), map: room.map },
      playerId: socket.id,
    });
    hns.to(data.code).emit('players_update', room.players.map(p => ({ ...p })));
  });

  socket.on('start_game', (data) => {
    const room = hnsRooms.get(data.code);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error_msg', 'Precisa de pelo menos 2 jogadores');

    room.round++;
    room.status = 'prep';
    room.prepTimeLeft = PREP_TIME;
    room.roundTimeLeft = ROUND_TIME;

    const seekerCount = Math.min(Math.floor(room.players.length / 4) + 1, Math.floor(room.players.length / 2));
    room.seekers = [];
    room.hiders = [];

    for (let i = 0; i < room.players.length; i++) {
      const player = room.players[i];
      if (i < seekerCount) {
        player.isSeeker = true; player.color = SEEKER_COLOR; player.currentColor = SEEKER_COLOR;
        room.seekers.push(player.id);
      } else {
        player.isSeeker = false; player.isAlive = true;
        player.color = HIDER_COLORS[i % HIDER_COLORS.length]; player.currentColor = player.color;
        room.hiders.push(player.id);
      }
      player.x = (Math.random() - 0.5) * HNS_MAP_SIZE * 0.4;
      player.z = (Math.random() - 0.5) * HNS_MAP_SIZE * 0.4;
    }

    hns.to(data.code).emit('game_start', {
      round: room.round, maxRounds: room.maxRounds,
      prepTime: PREP_TIME, roundTime: ROUND_TIME,
      seekers: room.seekers, hiders: room.hiders,
      players: room.players.map(p => ({ ...p })), map: room.map,
    });

    const prepInterval = setInterval(() => {
      room.prepTimeLeft--;
      hns.to(data.code).emit('timer_update', { prep: room.prepTimeLeft, round: room.roundTimeLeft, phase: room.status });
      if (room.prepTimeLeft <= 0) {
        clearInterval(prepInterval);
        room.status = 'playing';
        hns.to(data.code).emit('phase_change', { phase: 'playing' });
        const roundInterval = setInterval(() => {
          room.roundTimeLeft--;
          hns.to(data.code).emit('timer_update', { prep: 0, round: room.roundTimeLeft, phase: 'playing' });
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
    hns.to(data.code).emit('player_color_change', { id: socket.id, color: data.color });
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
    seeker.color = 0xffaa00; seeker.currentColor = 0xffaa00; seeker.isSeeker = false;
    room.hiders = room.hiders.filter(id => id !== hider.id);
    room.seekers.push(hider.id);
    hider.isSeeker = true; hider.color = SEEKER_COLOR; hider.currentColor = SEEKER_COLOR;

    hns.to(data.code).emit('player_tagged', { taggedId: hider.id, taggerId: socket.id });
    hns.to(data.code).emit('players_update', room.players.map(p => ({ ...p })));
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
  if (room.host === socket.id) room.host = room.players[0]?.id || null;
  socket.leave(code);
  hns.to(code).emit('players_update', room.players.map(p => ({ ...p })));
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
  hns.to(code).emit('round_end', {
    round: room.round, maxRounds: room.maxRounds, hidersWon: aliveHiders.length > 0,
    scores: { ...room.scores }, players: room.players.map(p => ({ ...p })),
  });
  if (room.round >= room.maxRounds) {
    setTimeout(() => {
      room.status = 'lobby'; room.round = 0; room.seekers = []; room.hiders = [];
      hns.to(code).emit('game_end', { scores: { ...room.scores }, players: room.players.map(p => ({ ...p })) });
    }, 5000);
  } else {
    setTimeout(() => {
      room.status = 'lobby';
      hns.to(code).emit('back_to_lobby', { players: room.players.map(p => ({ ...p })), scores: { ...room.scores } });
    }, 5000);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Combined Game Server running on port ${PORT}`);
});
