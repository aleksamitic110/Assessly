import { Router } from 'express';
import express from 'express';
import { authenticateJWT } from '../databases/neo4j/middleware/authMiddleware.js';
import { getDefaultLanguageId, getJudge0Languages, isJudge0Configured } from '../services/judge0.js';
import { tasksDir } from '../middleware/upload.js';

const router = Router();
const LOCAL_CPP_LANGUAGE = { id: 0, name: 'C++ (local)' };

router.use('/uploads/tasks', express.static(tasksDir));

router.get('/languages', authenticateJWT, async (_req, res) => {
  if (!isJudge0Configured()) {
    return res.json({
      languages: [LOCAL_CPP_LANGUAGE],
      defaultLanguageId: LOCAL_CPP_LANGUAGE.id,
      useJudge0: false
    });
  }

  try {
    const [languages, defaultLanguageId] = await Promise.all([
      getJudge0Languages(),
      getDefaultLanguageId()
    ]);

    if (!languages.length || defaultLanguageId == null) {
      return res.json({
        languages: [LOCAL_CPP_LANGUAGE],
        defaultLanguageId: LOCAL_CPP_LANGUAGE.id,
        useJudge0: false
      });
    }

    res.json({
      languages,
      defaultLanguageId,
      useJudge0: true
    });
  } catch (error) {
    console.error('Judge0 languages error:', error);
    res.json({
      languages: [LOCAL_CPP_LANGUAGE],
      defaultLanguageId: LOCAL_CPP_LANGUAGE.id,
      useJudge0: false
    });
  }
});

export default router;
