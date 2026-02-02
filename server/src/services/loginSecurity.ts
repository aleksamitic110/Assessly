import { createHash } from 'crypto';
import { redisClient } from '../databases/redis/client.js';

const MAX_FAILED_ATTEMPTS = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
const LOCKOUT_MINUTES = Number(process.env.AUTH_LOCKOUT_MINUTES || 15);

const lockKey = (email: string) => `auth:lock:${email}`;
const failKey = (email: string) => `auth:fail:${email}`;

export const isLoginLocked = async (email: string) => {
  if (!redisClient.isOpen) return { locked: false };
  const ttl = await redisClient.ttl(lockKey(email));
  if (ttl > 0) {
    return { locked: true, retryAfterSeconds: ttl };
  }
  return { locked: false };
};

export const recordLoginFailure = async (email: string) => {
  if (!redisClient.isOpen) return;
  const key = failKey(email);
  const failures = await redisClient.incr(key);
  if (failures === 1) {
    await redisClient.expire(key, LOCKOUT_MINUTES * 60);
  }
  if (failures >= MAX_FAILED_ATTEMPTS) {
    await redisClient.set(lockKey(email), '1', { EX: LOCKOUT_MINUTES * 60 });
    await redisClient.del(key);
  }
};

export const clearLoginFailures = async (email: string) => {
  if (!redisClient.isOpen) return;
  await redisClient.del([lockKey(email), failKey(email)]);
};

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
