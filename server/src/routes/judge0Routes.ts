import express, { Router } from 'express';
import { authenticateJWT } from '../databases/neo4j/middleware/authMiddleware.js';
import { getDefaultLanguageId, getJudge0Languages, isJudge0Configured } from '../services/judge0.js';
import { tasksDir } from '../middleware/upload.js';

const router = Router();

router.use('/uploads/tasks', express.static(tasksDir));

router.get('/languages', authenticateJWT, async (_req, res) => {
  if (!isJudge0Configured()) {
    return res.status(503).json({ error: 'Judge0 is not configured.' });
  }

  try {
    const [languages, defaultLanguageId] = await Promise.all([
      getJudge0Languages(),
      getDefaultLanguageId()
    ]);

    res.json({
      languages,
      defaultLanguageId
    });
  } catch (error) {
    console.error('Judge0 languages error:', error);
    res.status(500).json({ error: 'Failed to load Judge0 languages.' });
  }
});

export default router;
