import { Router } from 'express';
import { redisClient } from '../client.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const pong = await redisClient.ping();
    res.json({ status: 'ok', message: pong });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

export default router;
