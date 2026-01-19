import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Kreiramo klijenta, ali ga NE konektujemo ovde (to radimo u index.ts)
export const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false 
  }
});

redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
redisClient.on('connect', () => console.log('✅ Redis Client Connected'));