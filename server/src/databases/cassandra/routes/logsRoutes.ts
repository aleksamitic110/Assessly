import { Router } from 'express';
import { authenticateJWT, requireRole } from '../../neo4j/middleware/authMiddleware.js';
import { validate } from '../../../middleware/validate.js';
import { logsSchemas, uuidParam } from '../../../validation/schemas.js';
import {
  createExecutionLog,
  getMyExecutionLogs,
  getStudentExecutionLogs,
  createSecurityEvent,
  getExamSecurityEvents,
  getStudentSecurityEvents,
  getViolationCount
} from '../controllers/logsController.js';

const router = Router();

router.use(authenticateJWT);

router.post('/execution', validate({ body: logsSchemas.execution }), createExecutionLog);
router.get('/execution/:examId', validate({ params: uuidParam }), getMyExecutionLogs);
router.get('/execution/:examId/:studentId', requireRole('PROFESSOR'), validate({ params: uuidParam }), getStudentExecutionLogs);

router.post('/security', validate({ body: logsSchemas.securityEvent }), createSecurityEvent);
router.get('/security/:examId', requireRole('PROFESSOR'), validate({ params: uuidParam }), getExamSecurityEvents);
router.get('/security/:examId/:studentId', requireRole('PROFESSOR'), validate({ params: uuidParam }), getStudentSecurityEvents);
router.get('/security/:examId/:studentId/count', requireRole('PROFESSOR'), validate({ params: uuidParam }), getViolationCount);

export default router;
