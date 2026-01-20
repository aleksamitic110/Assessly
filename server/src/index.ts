/**
 * Assessly backend entry point.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

import authRoutes from './databases/neo4j/routes/authRoutes.js';
import examRoutes from './databases/neo4j/routes/examRoutes.js';
import logsRoutes from './databases/cassandra/routes/logsRoutes.js';
import redisStatusRoutes from './databases/redis/routes/statusRoutes.js';
import neo4jStatusRoutes from './databases/neo4j/routes/statusRoutes.js';
import cassandraStatusRoutes from './databases/cassandra/routes/statusRoutes.js';
import { redisClient } from './databases/redis/client.js';
import { initSocket } from './databases/redis/services/socketService.js';
import { neo4jDriver } from './databases/neo4j/driver.js';
import { cassandraClient } from './databases/cassandra/client.js';

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

initSocket(io);

app.get('/', (req, res) => {
  res.send('<h1>Assessly Backend is Running</h1><p>Socket.io & Redis Active</p>');
});

app.use('/status/redis', redisStatusRoutes);
app.use('/status/neo4j', neo4jStatusRoutes);
app.use('/status/cassandra', cassandraStatusRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/logs', logsRoutes);

async function initializeDatabases() {
  console.log('Initializing databases...');

  await redisClient.connect();

  const neoSession = neo4jDriver.session();
  await neoSession.run('RETURN 1');
  console.log('Connected to Neo4j (AuraDB)');
  await neoSession.close();

  await cassandraClient.connect();
  console.log('Connected to Cassandra (Astra DB)');
}

const startServer = async () => {
  try {
    await initializeDatabases();

    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log('Socket.io auth and monitoring: active');
    });
  } catch (error) {
    console.error('Critical error:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async () => {
  console.log('\nShutdown signal received...');
  try {
    await neo4jDriver.close();
    if (redisClient.isOpen) await redisClient.quit();
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
