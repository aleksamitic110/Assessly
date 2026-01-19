/**
 * ASSESSLY BACKEND - Main Entry Point
 */

import dotenv from 'dotenv';
dotenv.config();

import authRoutes from './routes/authRoutes.js';
import examRoutes from './routes/examRoutes.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

// Importujemo naš novi config i service
import { redisClient } from './config/redis.js';
import { initSocket } from './services/socketService.js';
import { neo4jDriver } from "./neo4j.js";
import { cassandraClient } from "./cassandra.js";

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const CLIENT_URL = "http://localhost:5173";

const app = express();
const server = http.createServer(app);

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
  cors: {
    origin: "*", // Za razvoj dozvoli sve, kasnije vrati CLIENT_URL
    methods: ["GET", "POST"]
  }
});

// 🔥 POKREĆEMO TVOJU SOCKET LOGIKU
initSocket(io);

// --- ROUTES ---
app.get('/', (req, res) => {
  res.send(`<h1>🚀 Assessly Backend is Running</h1><p>Socket.io & Redis Active</p>`);
});

// Database status endpoints
app.get('/status/redis', async (req, res) => {
  try {
    const pong = await redisClient.ping();
    res.json({ status: 'ok', message: pong });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

app.get('/status/neo4j', async (req, res) => {
  try {
    const session = neo4jDriver.session();
    const result = await session.run("RETURN 1 AS test");
    await session.close();
    res.json({ status: 'ok', message: result.records[0].get("test").toNumber().toString() });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

app.get('/status/cassandra', async (req, res) => {
  try {
    const result = await cassandraClient.execute('SELECT release_version FROM system.local');
    res.json({ status: 'ok', message: result.first().get('release_version') });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// --- CORE LOGIC: DATABASE INITIALIZATION ---
async function initializeDatabases() {
  console.log("🛠️  Initializing Cloud Databases...");

  // 1. Redis (Konektujemo importovani klijent)
  await redisClient.connect();
  
  // 2. Neo4j
  const neoSession = neo4jDriver.session();
  await neoSession.run("RETURN 1");
  console.log("✅ Connected to Neo4j (AuraDB)");
  await neoSession.close();

  // 3. Cassandra
  await cassandraClient.connect();
  console.log(`✅ Connected to Cassandra (Astra DB)`);
}

// --- SERVER START ---
const startServer = async () => {
  try {
    await initializeDatabases();

    app.use('/api/auth', authRoutes);
    app.use('/api/exams', examRoutes);

    server.listen(PORT, () => {
      console.log(`🚀 SERVER IS LIVE ON PORT ${PORT}`);
      console.log(`⚡ Socket.io Auth & Monitoring: ACTIVE`);
    });

  } catch (error) {
    console.error("❌ CRITICAL ERROR:", error);
    process.exit(1);
  }
};

// --- GRACEFUL SHUTDOWN ---
const gracefulShutdown = async () => {
  console.log('\n🛑 Shutdown signal received...');
  try {
    await neo4jDriver.close();
    if (redisClient.isOpen) await redisClient.quit(); // Provera da li je otvoren
    await cassandraClient.shutdown();
    server.close(() => process.exit(0));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);  