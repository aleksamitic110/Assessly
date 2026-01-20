import { Router } from 'express';
import { neo4jDriver } from '../driver.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const session = neo4jDriver.session();
    const result = await session.run('RETURN 1 AS test');
    await session.close();
    res.json({ status: 'ok', message: result.records[0].get('test').toNumber().toString() });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

export default router;
