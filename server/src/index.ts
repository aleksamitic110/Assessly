/**
 * ASSESSLY BACKEND - Main Entry Point
 * Architecture: Express + Socket.io + Triple Cloud DB (Redis, Neo4j, Cassandra)
 */

import dotenv from 'dotenv';
dotenv.config(); // Mora biti na samom vrhu

import authRoutes from './routes/authRoutes.js';
import examRoutes from './routes/examRoutes.js';
import logsRoutes from './routes/logsRoutes.js';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { createClient } from 'redis';

// Database Drivers
import { neo4jDriver } from "./neo4j.js";
import { cassandraClient } from "./cassandra.js";

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const CLIENT_URL = "http://localhost:5173"; // React Vite port

const app = express();
const server = http.createServer(app);

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"]
  }
});

// --- REDIS SETUP ---
const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false 
  }
});

redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));

// --- ROUTES ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Assessly Backend</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          color: #333;
          text-align: center;
          padding: 50px;
        }
        .container {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #2c3e50;
        }
        .status {
          font-size: 1.2em;
          margin: 20px 0;
        }
        .links {
          margin-top: 30px;
        }
        .links a {
          display: inline-block;
          margin: 0 10px;
          padding: 10px 20px;
          background: #3498db;
          color: white;
          text-decoration: none;
          border-radius: 5px;
        }
        .links a:hover {
          background: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 Assessly Backend</h1>
        <p class="status">Backend is Running Successfully!</p>
        <p>This server provides API endpoints for database operations and real-time communication.</p>
        <div class="links">
          <a href="/status/redis">Redis Status</a>
          <a href="/status/neo4j">Neo4j Status</a>
          <a href="/status/cassandra">Cassandra Status</a>
          <a href="http://localhost:5173">Client App</a>
        </div>
      </div>
    </body>
    </html>
  `);
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

  // 1. Redis
  await redisClient.connect();
  console.log("✅ Connected to Redis (Upstash)");

  // 2. Neo4j
  const neoSession = neo4jDriver.session();
  const neoResult = await neoSession.run("RETURN 1 AS test");
  console.log("✅ Connected to Neo4j (AuraDB):", neoResult.records[0].get("test"));
  await neoSession.close();

  // 3. Cassandra
  console.log("⏳ Connecting to Cassandra...");
  await cassandraClient.connect();
  const cassResult = await cassandraClient.execute('SELECT release_version FROM system.local');
  console.log(`✅ Connected to Cassandra (Astra DB)! Version: ${cassResult.first().get('release_version')}`);
}

// --- SERVER START ---
const startServer = async () => {
  try {
    // Povezivanje na baze podataka
    await initializeDatabases();

    // Socket.io događaji
    io.on('connection', (socket) => {
      console.log(`👤 User connected: ${socket.id}`);
      
      socket.on('disconnect', () => {
        console.log(`👤 User disconnected: ${socket.id}`);
      });
    });

    // Pokretanje HTTP servera
    server.listen(PORT, () => {
      console.log(`
🚀 SERVER IS LIVE!
---------------------------------------
📡 URL: http://localhost:${PORT}
📂 Env: Development
⚡ Real-time: Socket.io Active
---------------------------------------
      `);
    });

  } catch (error) {
    console.error("❌ CRITICAL ERROR DURING STARTUP:", error);
    process.exit(1);
  }
};

// --- GRACEFUL SHUTDOWN ---
const gracefulShutdown = async () => {
  console.log('\n🛑 Shutdown signal received. Closing all connections...');

  try {
    // Zatvaranje Neo4j
    await neo4jDriver.close();
    console.log('✔ Neo4j driver closed.');

    // Zatvaranje Redis
    await redisClient.quit();
    console.log('✔ Redis client closed.');

    // Zatvaranje Cassandra (Korišćenje ispravne metode .shutdown())
    await cassandraClient.shutdown();
    console.log('✔ Cassandra client closed.');

    // Gašenje servera
    server.close(() => {
      console.log('✔ HTTP server stopped.');
      process.exit(0);
    });

    // Safety timeout za nasilno gašenje
    setTimeout(() => {
      console.error('⚠️ Forcefully shutting down (timeout).');
      process.exit(1);
    }, 5000);

  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Pokretanje aplikacije
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/logs', logsRoutes);
startServer();

// Registracija signala za gašenje
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);