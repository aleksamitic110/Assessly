import { Router } from 'express';
import { getExamOverviewStats, getExamStats, getSubjectOverviewStats } from '../controllers/statsController.js';
import { authenticateJWT, requireRole } from '../../neo4j/middleware/authMiddleware.js';
import { validate } from '../../../middleware/validate.js';
import { uuidParam } from '../../../validation/schemas.js';

const router = Router();

router.use(authenticateJWT);
router.get('/exam/:examId', validate({ params: uuidParam }), getExamStats);
router.get('/exam/:examId/overview', requireRole('PROFESSOR'), validate({ params: uuidParam }), getExamOverviewStats);
router.get('/subject/:subjectId/overview', requireRole('PROFESSOR'), validate({ params: uuidParam }), getSubjectOverviewStats);

export default router;
