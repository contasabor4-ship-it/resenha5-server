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
const WORLD_SIZE = 400;
const SPAWN_X = 0;
const SPAWN_Z = 0;

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
  katana: { name: 'Katana', damage: 999, fireRate: 600, ammo: 999, spread: 0.01, recoil: 0.08 },
};

const SHOP_ITEMS = {
  armor_light: { name: 'Colete Leve', price: 500, category: 'consumivel', effect: (p) => { p.armor = Math.min(100, p.armor + 25); } },
  armor_heavy: { name: 'Colete Pesada', price: 1000, category: 'consumivel', effect: (p) => { p.armor = Math.min(100, p.armor + 50); } },
  ammo_refill: { name: 'Municao Extra', price: 300, category: 'consumivel', effect: (p) => { p.ammo = WEAPONS[p.weapon].ammo; } },
  health_pack: { name: 'Kit Medico', price: 400, category: 'consumivel', effect: (p) => { p.health = Math.min(100, p.health + 40); } },
  skin_red: { name: 'Skin Vermelho', price: 200, category: 'skin', effect: (p) => { p.color = '#ff3333'; } },
  skin_blue: { name: 'Skin Azul', price: 200, category: 'skin', effect: (p) => { p.color = '#3366ff'; } },
  skin_gold: { name: 'Skin Dourado', price: 800, category: 'skin', effect: (p) => { p.color = '#ffd700'; } },
  skin_neon: { name: 'Skin Neon', price: 600, category: 'skin', effect: (p) => { p.color = '#00ff88'; } },
  skin_purple: { name: 'Skin Roxo', price: 400, category: 'skin', effect: (p) => { p.color = '#9933ff'; } },
  skin_camo: { name: 'Skin Camuflagem', price: 500, category: 'skin', effect: (p) => { p.color = '#556b2f'; } },
  weapon_shotgun: { name: 'Shotgun', price: 1000, category: 'arma', effect: (p) => { p.weapon = 'shotgun'; p.ammo = WEAPONS.shotgun.ammo; } },
  weapon_smg: { name: 'SMG', price: 1500, category: 'arma', effect: (p) => { p.weapon = 'smg'; p.ammo = WEAPONS.smg.ammo; } },
  weapon_rifle: { name: 'Rifle', price: 2500, category: 'arma', effect: (p) => { p.weapon = 'rifle'; p.ammo = WEAPONS.rifle.ammo; } },
  weapon_katana: { name: 'Katana (Hitkill)', price: 1000000, category: 'arma', effect: (p) => { p.weapon = 'katana'; p.ammo = 999; } },
};

const VEHICLE_MODELS = [
  { name: 'Sedan', maxSpeed: 45, acceleration: 18, color: 0xcc3333, handling: 0.92 },
  { name: 'SUV', maxSpeed: 38, acceleration: 14, color: 0x3333cc, handling: 0.88 },
  { name: 'Sports', maxSpeed: 60, acceleration: 25, color: 0xddcc00, handling: 0.95 },
  { name: 'Truck', maxSpeed: 28, acceleration: 10, color: 0x33aa33, handling: 0.82 },
  { name: 'Muscle', maxSpeed: 50, acceleration: 22, color: 0xff6600, handling: 0.90 },
  { name: 'Coupe', maxSpeed: 52, acceleration: 20, color: 0x9933cc, handling: 0.93 },
  { name: 'Pickup', maxSpeed: 35, acceleration: 12, color: 0x8B4513, handling: 0.85 },
  { name: 'Van', maxSpeed: 32, acceleration: 11, color: 0x556677, handling: 0.80 },
];

const HOUSE_TEMPLATES = [
  { name: 'Casa', w: 7, h: 3.5, d: 7, color: 0xcc9966, roofColor: 0x8B4513 },
  { name: 'Sobrado', w: 9, h: 7, d: 9, color: 0xddbb88, roofColor: 0x993333 },
  { name: 'Predio', w: 10, h: 14, d: 10, color: 0x7788aa, roofColor: 0x444444 },
  { name: 'Galpao', w: 14, h: 6, d: 18, color: 0x666666, roofColor: 0x444444 },
  { name: 'Bar', w: 8, h: 3.5, d: 8, color: 0x884422, roofColor: 0x228822 },
];

function spawnVehicles() {
  gtaVehicles.length = 0;
  const spots = [
    { x: 30, z: 0, r: 0 }, { x: -30, z: 0, r: Math.PI },
    { x: 0, z: 30, r: Math.PI / 2 }, { x: 0, z: -30, r: -Math.PI / 2 },
    { x: 60, z: 0, r: 0 }, { x: -60, z: 0, r: Math.PI },
    { x: 0, z: 60, r: Math.PI / 2 }, { x: 0, z: -60, r: -Math.PI / 2 },
    { x: 90, z: 0, r: 0 }, { x: -90, z: 0, r: Math.PI },
    { x: 0, z: 90, r: Math.PI / 2 }, { x: 0, z: -90, r: -Math.PI / 2 },
  ];
  for (let i = 0; i < spots.length; i++) {
    const model = VEHICLE_MODELS[i % VEHICLE_MODELS.length];
    const s = spots[i];
    gtaVehicles.push({
      id: `vehicle_${i}`, model: model.name,
      x: s.x, y: 0.5, z: s.z, rotation: s.r,
      speed: 0, maxSpeed: model.maxSpeed, acceleration: model.acceleration,
      handling: model.handling, color: model.color, driver: null, health: 100,
    });
  }
}

const SPAWN_POINTS = [
  { x: 0, z: 0 }, { x: -5, z: 0 }, { x: 5, z: 0 },
  { x: 0, z: -5 }, { x: 0, z: 5 },
];

function spawnHouses() {
  gtaHouses.length = 0;
  let id = 0;
  const add = (x, z, t) => {
    const tmpl = HOUSE_TEMPLATES[t];
    gtaHouses.push({ id: `house_${id++}`, name: tmpl.name, x, z, w: tmpl.w, h: tmpl.h, d: tmpl.d, color: tmpl.color, roofColor: tmpl.roofColor, doorSide: Math.floor(Math.random() * 4) });
  };

  const half = WORLD_SIZE / 2 - 15;
  const spacing = 15;
  const positions = [];

  for (let gx = -half; gx <= half; gx += spacing) {
    for (let gz = -half; gz <= half; gz += spacing) {
      const ox = gx + (Math.random() - 0.5) * 4;
      const oz = gz + (Math.random() - 0.5) * 4;
      if (Math.abs(ox) < 10 && Math.abs(oz) < 10) continue;
      positions.push({ x: ox, z: oz });
    }
  }

  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const counts = [20, 18, 16, 8, 4];
  let idx = 0;
  for (let t = 0; t < 5; t++) {
    for (let c = 0; c < counts[t] && idx < positions.length; c++, idx++) {
      add(positions[idx].x, positions[idx].z, t);
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
    const spawnIdx = gtaPlayers.size % SPAWN_POINTS.length;
    const sp = SPAWN_POINTS[spawnIdx];
    const player = {
      id: socket.id,
      nickname: (data.nickname || 'Player').slice(0, 16),
      x: sp.x + (Math.random() - 0.5) * 4,
      y: 1,
      z: sp.z + (Math.random() - 0.5) * 4,
      rotation: 0,
      health: 100,
      armor: 0,
      money: 0,
      kills: 0,
      deaths: 0,
      weapon: startWeapon,
      ammo: WEAPONS[startWeapon].ammo,
      inVehicle: null,
      isAlive: true,
      deathX: 0, deathY: 0, deathZ: 0,
      speed: 0,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    };
    gtaPlayers.set(socket.id, player);
    socket.emit('welcome', {
      player,
      vehicles: gtaVehicles,
      houses: gtaHouses,
      weapons: WEAPONS,
      shopItems: Object.entries(SHOP_ITEMS).map(([id, item]) => ({
        id, name: item.name, price: item.price, category: item.category,
      })),
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
      dirX: data.dirX, dirY: data.dirY || 0, dirZ: data.dirZ,
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

  socket.on('buy_item', (data) => {
    const player = gtaPlayers.get(socket.id);
    if (!player || !player.isAlive) return;
    const item = SHOP_ITEMS[data.itemId];
    if (!item) return socket.emit('shop_error', 'Item invalido');
    if (player.money < item.price) return socket.emit('shop_error', 'Dinheiro insuficiente');
    player.money -= item.price;
    item.effect(player);
    socket.emit('shop_success', { itemId: data.itemId, money: player.money });
    io.emit('players_update', Array.from(gtaPlayers.values()));
  });

  socket.on('respawn', () => {
    const player = gtaPlayers.get(socket.id);
    if (!player || player.isAlive) return;
    const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    player.isAlive = true; player.health = 100; player.armor = 0;
    player.x = sp.x + (Math.random() - 0.5) * 4;
    player.z = sp.z + (Math.random() - 0.5) * 4;
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
    const oldX = proj.x;
    const oldZ = proj.z;
    const oldY = proj.y;
    proj.x += proj.dirX * proj.speed * (1 / TICK_RATE);
    proj.z += proj.dirZ * proj.speed * (1 / TICK_RATE);
    proj.y += (proj.dirY || 0) * proj.speed * (1 / TICK_RATE);
    proj.life -= 1 / TICK_RATE;

    for (const [id, player] of gtaPlayers) {
      if (id === proj.ownerId || !player.isAlive) continue;

      const dx = proj.x - oldX;
      const dz = proj.z - oldZ;
      const lenSq = dx * dx + dz * dz;
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((player.x - oldX) * dx + (player.z - oldZ) * dz) / lenSq));
      }
      const closestX = oldX + t * dx;
      const closestZ = oldZ + t * dz;
      const closestY = oldY + t * (proj.y - oldY);
      const dist = Math.hypot(closestX - player.x, closestZ - player.z);

      if (dist < 1.5) {
        let dmgMult = 1.0;
        const hitY = closestY;
        const playerBase = player.y || 1;
        if (hitY > playerBase + 1.6) dmgMult = 2.0;
        else if (hitY < playerBase + 0.4) dmgMult = 0.7;
        else if (hitY < playerBase + 0.8) dmgMult = 0.85;

        let dmg = Math.round(proj.damage * dmgMult);
        if (player.armor > 0) {
          const absorbed = Math.min(player.armor, dmg * 0.6);
          player.armor -= absorbed;
          dmg -= absorbed;
        }
        player.health -= dmg;
        if (player.health <= 0) {
          player.health = 0; player.isAlive = false; player.deaths++;
          player.deathX = player.x; player.deathY = player.y; player.deathZ = player.z;
          const killer = gtaPlayers.get(proj.ownerId);
          if (killer) {
            killer.money += 500; killer.kills++;
            gtaKillfeed.unshift({ killer: killer.nickname, victim: player.nickname, weapon: killer.weapon, time: Date.now() });
            if (gtaKillfeed.length > 10) gtaKillfeed.pop();
          }
          io.emit('player_death', { killerId: proj.ownerId, victimId: id, killerName: killer?.nickname || '???', victimName: player.nickname, dmgMult, deathX: player.deathX, deathY: player.deathY, deathZ: player.deathZ });
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

  for (const v of gtaVehicles) {
    io.emit('vehicle_update', { id: v.id, x: v.x, y: v.y, z: v.z, rotation: v.rotation, speed: v.speed, color: v.color, model: v.model, driver: v.driver, health: v.health });
  }

  io.emit('players_update', Array.from(gtaPlayers.values()));
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
  const pickColor = () => colors[Math.floor(Math.random() * colors.length)];

  for (let i = 0; i < 40; i++) {
    const w = 4 + Math.floor(Math.random() * 4) * 4;
    const h = 4 + Math.floor(Math.random() * 5) * 4;
    const d = 4 + Math.floor(Math.random() * 4) * 4;
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - w);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - d);
    blocks.push({ x, y: h / 2, z, w, h, d, color: pickColor() });
  }

  for (let i = 0; i < 30; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    const w = 2 + Math.random() * 5;
    const h = 0.8 + Math.random() * 1.5;
    const d = 1 + Math.random() * 3;
    blocks.push({ x, y: h / 2, z, w, h, d, color: 0x8B4513 });
  }

  for (let i = 0; i < 25; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 3);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 3);
    const s = 1 + Math.random() * 2;
    blocks.push({ x, y: s / 2, z, w: s, h: s, d: s, color: pickColor() });
  }

  for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 1);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 1);
    blocks.push({ x, y: 0.4, z, w: 0.4, h: 0.8, d: 0.4, color: 0x555555 });
  }

  for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    const w = 1 + Math.random() * 2;
    const h = 0.6 + Math.random() * 1.2;
    const d = 1 + Math.random() * 2;
    blocks.push({ x, y: h / 2, z, w, h, d, color: pickColor() });
  }

  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 4);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 4);
    blocks.push({ x, y: 0.5, z, w: 3, h: 1, d: 1, color: 0x666666 });
    blocks.push({ x, y: 1.5, z, w: 2, h: 1, d: 0.8, color: 0x8B4513 });
  }

  for (let i = 0; i < 12; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 6);
    blocks.push({ x, y: 4, z, w: 6, h: 0.5, d: 6, color: 0x8B4513 });
    for (let dx = -1; dx <= 1; dx += 2) {
      blocks.push({ x: x + dx * 2.5, y: 2, z, w: 1, h: 4, d: 1, color: 0x8B4513 });
    }
  }

  for (let i = 0; i < 8; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 10);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 10);
    blocks.push({ x, y: 8, z, w: 10, h: 0.3, d: 10, color: 0x556b2f });
    for (let dx = -1; dx <= 1; dx += 2) {
      for (let dz = -1; dz <= 1; dz += 2) {
        blocks.push({ x: x + dx * 4, y: 4, z: z + dz * 4, w: 1, h: 8, d: 1, color: 0x666666 });
      }
    }
  }

  for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 8);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 8);
    blocks.push({ x, y: 0.3, z, w: 8, h: 0.6, d: 0.6, color: pickColor() });
  }

  for (let i = 0; i < 10; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 1);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 1);
    const wallLen = 3 + Math.random() * 8;
    const isX = Math.random() > 0.5;
    blocks.push({
      x, y: 1.5, z,
      w: isX ? wallLen : 0.4,
      h: 3,
      d: isX ? 0.4 : wallLen,
      color: pickColor()
    });
  }

  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    const z = (Math.random() - 0.5) * (HNS_MAP_SIZE - 2);
    blocks.push({ x, y: 0.3, z, w: 1.5, h: 0.6, d: 1.5, color: 0x333333 });
    blocks.push({ x, y: 1.2, z, w: 0.3, h: 1.2, d: 0.3, color: 0x555555 });
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
    if (!room) return socket.emit('error_msg', 'Sala nao encontrada');
    const isHost = room.host === socket.id || room.players[0]?.id === socket.id;
    if (!isHost) return socket.emit('error_msg', 'Apenas o host pode iniciar');
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

  const http = require('http');
  const SERVER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    http.get(`${SERVER_URL}/keepalive`, (res) => {
      console.log(`Keepalive: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`Keepalive error: ${err.message}`);
    });
  }, 10 * 60 * 1000);
});
