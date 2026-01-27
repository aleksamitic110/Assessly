import { Router } from 'express';
import { cassandraClient } from '../client.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await cassandraClient.execute('SELECT release_version FROM system.local');
    res.json({ status: 'ok', message: result.first().get('release_version') });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

export default router;
