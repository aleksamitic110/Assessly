import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
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

// Sve rute zahtevaju autentifikaciju
router.use(authenticateJWT);

// ============================================
// EXECUTION LOGS RUTE
// ============================================

// POST /api/logs/execution - Student loguje izvršavanje koda
router.post('/execution', createExecutionLog);

// GET /api/logs/execution/:examId - Dohvati moje logove na ispitu
router.get('/execution/:examId', getMyExecutionLogs);

// GET /api/logs/execution/:examId/:studentId - Profesor gleda logove studenta
router.get('/execution/:examId/:studentId', getStudentExecutionLogs);

// ============================================
// SECURITY EVENTS RUTE
// ============================================

// POST /api/logs/security - Logiraj sumnjivi događaj
router.post('/security', createSecurityEvent);

// GET /api/logs/security/:examId - Profesor vidi sve događaje na ispitu
router.get('/security/:examId', getExamSecurityEvents);

// GET /api/logs/security/:examId/:studentId - Događaji za studenta
router.get('/security/:examId/:studentId', getStudentSecurityEvents);

// GET /api/logs/security/:examId/:studentId/count - Broj kršenja
router.get('/security/:examId/:studentId/count', getViolationCount);

export default router;
