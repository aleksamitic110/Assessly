/**
 * Assessly backend entry point.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { Server } from 'socket.io';
import path from 'path';

import authRoutes from './databases/neo4j/routes/authRoutes.js';
import examRoutes from './databases/neo4j/routes/examRoutes.js';
import adminRoutes from './databases/neo4j/routes/adminRoutes.js';
import logsRoutes from './databases/cassandra/routes/logsRoutes.js';
import redisStatusRoutes from './databases/redis/routes/statusRoutes.js';
import neo4jStatusRoutes from './databases/neo4j/routes/statusRoutes.js';
import cassandraStatusRoutes from './databases/cassandra/routes/statusRoutes.js';
import judge0Routes from './routes/judge0Routes.js';
import { redisClient } from './databases/redis/client.js';
import { initSocket } from './databases/redis/services/socketService.js';
import { neo4jDriver, initNeo4jSchema } from './databases/neo4j/driver.js';
import { cassandraClient } from './databases/cassandra/client.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { env, getCorsOrigins } from './config/env.js';

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

const corsOrigins = getCorsOrigins();
const corsOptions: cors.CorsOptions = {
  origin: corsOrigins.length
    ? (origin, callback) => {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true,
  credentials: true
};

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      connectSrc: ["'self'", ...corsOrigins]
    }
  }
}));
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(morgan(':method :url :status - :response-time ms'));
app.use(apiLimiter);
app.use(express.json({ limit: env.REQUEST_SIZE_LIMIT || '512kb' }));
app.use(express.urlencoded({ extended: true, limit: env.REQUEST_SIZE_LIMIT || '512kb' }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const io = new Server(server, {
  cors: corsOptions
});

initSocket(io);

app.get('/', (req, res) => {
  res.send('<h1>Assessly Backend is Running</h1><p>Socket.io & Redis Active</p>');
});

app.use('/status/redis', redisStatusRoutes);
app.use('/status/neo4j', neo4jStatusRoutes);
app.use('/status/cassandra', cassandraStatusRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/judge0', judge0Routes);

app.use(errorHandler);

async function initializeDatabases() {
  console.log('Initializing databases...');

  await redisClient.connect();

  const neoSession = neo4jDriver.session();
  await neoSession.run('RETURN 1');
  console.log('Connected to Neo4j (AuraDB)');
  await neoSession.close();

  await initNeo4jSchema();

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
