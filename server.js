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

const TICK_RATE = 20;
const WORLD_SIZE = 200;
const SPAWN_X = 0;
const SPAWN_Z = 0;

const players = new Map();
const vehicles = [];
const projectiles = [];

const VEHICLE_MODELS = [
  { name: 'Sedan', speed: 40, acceleration: 15, color: 0xff4444 },
  { name: 'SUV', speed: 35, acceleration: 12, color: 0x4444ff },
  { name: 'Sports', speed: 55, acceleration: 22, color: 0xffdd00 },
  { name: 'Truck', speed: 25, acceleration: 8, color: 0x44cc44 },
];

function spawnVehicles() {
  for (let i = 0; i < 12; i++) {
    const model = VEHICLE_MODELS[i % VEHICLE_MODELS.length];
    vehicles.push({
      id: `vehicle_${i}`,
      model: model.name,
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: 0.5,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      rotation: Math.random() * Math.PI * 2,
      speed: 0,
      maxSpeed: model.speed,
      acceleration: model.acceleration,
      color: model.color,
      driver: null,
      health: 100,
    });
  }
}

const MISSIONS = [
  { id: 'robbery_1', name: 'Assalto à Loja', reward: 500, x: 40, z: 40, radius: 8 },
  { id: 'robbery_2', name: 'Assalto ao Banco', reward: 1500, x: -60, z: 30, radius: 10 },
  { id: 'robbery_3', name: 'Roubo de Veículo', reward: 800, x: 20, z: -50, radius: 6 },
  { id: 'delivery_1', name: 'Entrega Rápida', reward: 300, x: -30, z: -40, radius: 5 },
];

spawnVehicles();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    const player = {
      id: socket.id,
      nickname: data.nickname || 'Player',
      x: SPAWN_X + (Math.random() - 0.5) * 10,
      y: 1,
      z: SPAWN_Z + (Math.random() - 0.5) * 10,
      rotation: 0,
      health: 100,
      money: 5000,
      bank: 0,
      weapon: 'pistol',
      ammo: 30,
      inVehicle: null,
      isAlive: true,
      speed: 0,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
    };
    players.set(socket.id, player);

    socket.emit('welcome', {
      player,
      vehicles,
      missions: MISSIONS,
      worldSize: WORLD_SIZE,
    });

    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('position', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    player.x = data.x;
    player.y = data.y;
    player.z = data.z;
    player.rotation = data.rotation;
    player.speed = data.speed || 0;
  });

  socket.on('vehicle_enter', (data) => {
    const player = players.get(socket.id);
    if (!player || player.inVehicle) return;
    const vehicle = vehicles.find(v => v.id === data.vehicleId);
    if (!vehicle || vehicle.driver) return;

    const dist = Math.hypot(player.x - vehicle.x, player.z - vehicle.z);
    if (dist > 5) return;

    vehicle.driver = socket.id;
    player.inVehicle = vehicle.id;
    io.emit('vehicle_update', vehicle);
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('vehicle_exit', () => {
    const player = players.get(socket.id);
    if (!player || !player.inVehicle) return;
    const vehicle = vehicles.find(v => v.id === player.inVehicle);
    if (vehicle) {
      vehicle.driver = null;
      vehicle.speed = 0;
      io.emit('vehicle_update', vehicle);
    }
    player.inVehicle = null;
    player.x += 3;
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('vehicle_position', (data) => {
    const vehicle = vehicles.find(v => v.driver === socket.id);
    if (!vehicle) return;
    vehicle.x = data.x;
    vehicle.y = data.y;
    vehicle.z = data.z;
    vehicle.rotation = data.rotation;
    vehicle.speed = data.speed;
  });

  socket.on('shoot', (data) => {
    const player = players.get(socket.id);
    if (!player || !player.isAlive || player.ammo <= 0) return;
    player.ammo--;

    projectiles.push({
      id: uuidv4(),
      ownerId: socket.id,
      x: data.x,
      y: data.y,
      z: data.z,
      dirX: data.dirX,
      dirZ: data.dirZ,
      speed: 80,
      damage: 25,
      life: 2,
    });

    io.emit('projectile_new', projectiles[projectiles.length - 1]);
  });

  socket.on('mission_start', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    const mission = MISSIONS.find(m => m.id === data.missionId);
    if (!mission) return;

    const dist = Math.hypot(player.x - mission.x, player.z - mission.z);
    if (dist > mission.radius * 2) return;

    socket.emit('mission_active', mission);
  });

  socket.on('mission_complete', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    const mission = MISSIONS.find(m => m.id === data.missionId);
    if (!mission) return;

    const dist = Math.hypot(player.x - mission.x, player.z - mission.z);
    if (dist > mission.radius * 3) return;

    player.money += mission.reward;
    socket.emit('mission_reward', { missionId: mission.id, reward: mission.reward, money: player.money });
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('bank_deposit', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    const amount = Math.min(data.amount, player.money);
    if (amount <= 0) return;
    player.money -= amount;
    player.bank += amount;
    socket.emit('bank_update', { money: player.money, bank: player.bank });
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('bank_withdraw', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    const amount = Math.min(data.amount, player.bank);
    if (amount <= 0) return;
    player.bank -= amount;
    player.money += amount;
    socket.emit('bank_update', { money: player.money, bank: player.bank });
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('chat', (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    io.emit('chat_message', {
      id: uuidv4(),
      nickname: player.nickname,
      message: (data.message || '').slice(0, 200),
      timestamp: Date.now(),
    });
  });

  socket.on('respawn', () => {
    const player = players.get(socket.id);
    if (!player || player.isAlive) return;
    player.isAlive = true;
    player.health = 100;
    player.x = SPAWN_X + (Math.random() - 0.5) * 10;
    player.z = SPAWN_Z + (Math.random() - 0.5) * 10;
    if (player.inVehicle) {
      const vehicle = vehicles.find(v => v.id === player.inVehicle);
      if (vehicle) { vehicle.driver = null; io.emit('vehicle_update', vehicle); }
      player.inVehicle = null;
    }
    io.emit('players_update', Array.from(players.values()));
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player && player.inVehicle) {
      const vehicle = vehicles.find(v => v.id === player.inVehicle);
      if (vehicle) { vehicle.driver = null; io.emit('vehicle_update', vehicle); }
    }
    players.delete(socket.id);
    io.emit('players_update', Array.from(players.values()));
    console.log(`Player disconnected: ${socket.id}`);
  });
});

setInterval(() => {
  for (const proj of projectiles) {
    proj.x += proj.dirX * proj.speed * (1 / TICK_RATE);
    proj.z += proj.dirZ * proj.speed * (1 / TICK_RATE);
    proj.life -= 1 / TICK_RATE;

    for (const [id, player] of players) {
      if (id === proj.ownerId || !player.isAlive) continue;
      const dist = Math.hypot(proj.x - player.x, proj.z - player.z);
      if (dist < 1.5) {
        player.health -= proj.damage;
        if (player.health <= 0) {
          player.health = 0;
          player.isAlive = false;
          const shooter = players.get(proj.ownerId);
          if (shooter) {
            shooter.money += 100;
          }
          io.emit('player_death', { killerId: proj.ownerId, victimId: id });
          io.emit('players_update', Array.from(players.values()));
        }
        proj.life = 0;
        break;
      }
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].life <= 0) {
      projectiles.splice(i, 1);
    }
  }

  io.emit('projectiles_update', projectiles.map(p => ({
    id: p.id,
    x: p.x,
    y: p.y,
    z: p.z,
  })));
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Resenha 5 Game Server running on port ${PORT}`);
});
