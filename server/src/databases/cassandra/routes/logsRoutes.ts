import { Router } from 'express';
import { authenticateJWT } from '../../neo4j/middleware/authMiddleware.js';
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

router.post('/execution', createExecutionLog);
router.get('/execution/:examId', getMyExecutionLogs);
router.get('/execution/:examId/:studentId', getStudentExecutionLogs);

router.post('/security', createSecurityEvent);
router.get('/security/:examId', getExamSecurityEvents);
router.get('/security/:examId/:studentId', getStudentSecurityEvents);
router.get('/security/:examId/:studentId/count', getViolationCount);

export default router;
