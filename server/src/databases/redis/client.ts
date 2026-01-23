import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || '';
const useTls = redisUrl.startsWith('rediss://') || String(process.env.REDIS_TLS || '').toLowerCase() === 'true';

export const redisClient = createClient({
  url: redisUrl,
  socket: {
    tls: useTls,
    rejectUnauthorized: String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false'
  }
});

redisClient.on('error', (err) => console.error('Redis client error:', err));
redisClient.on('connect', () => console.log('Redis client connected'));
