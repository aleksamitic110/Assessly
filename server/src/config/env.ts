import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.string().optional(),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  JWT_EXPIRES_IN: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  SERVER_BASE_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  REQUEST_SIZE_LIMIT: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  AUTH_MAX_FAILED_ATTEMPTS: z.string().optional(),
  AUTH_LOCKOUT_MINUTES: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  RATE_LIMIT_MAX: z.string().optional(),
  AUTH_RATE_LIMIT_MAX: z.string().optional(),
  REDIS_URL: z.string().optional(),
  NEO4J_URI: z.string().optional(),
  NEO4J_USERNAME: z.string().optional(),
  NEO4J_PASSWORD: z.string().optional(),
  CASSANDRA_CLIENT_ID: z.string().optional(),
  CASSANDRA_CLIENT_SECRET: z.string().optional(),
  CASSANDRA_KEYSPACE: z.string().optional(),
  CASSANDRA_BUNDLE_PATH: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional()
});

export const env = envSchema.parse(process.env);

export const getCorsOrigins = () => {
  const raw = env.CORS_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};
