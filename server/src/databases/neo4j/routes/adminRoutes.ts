import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';
import {
  adminLogin,
  getSystemHealth,
  getStatistics,
  getUsers,
  changeUserRole,
  disableUser,
  adminGetExams,
  adminGetSubjects,
  adminDeleteExam,
  adminDeleteSubject,
  adminResetExamState,
  getSecurityEventsAdmin,
  getActiveExams,
  getRecentActivity
} from '../controllers/adminController.js';

const router = Router();

// Public admin login
router.post('/login', adminLogin);

// All routes below require ADMIN role
router.use(authenticateJWT, requireRole('ADMIN'));

router.get('/health', getSystemHealth);
router.get('/statistics', getStatistics);
router.get('/active-exams', getActiveExams);
router.get('/security-events', getSecurityEventsAdmin);

router.get('/users', getUsers);
router.patch('/users/:id/role', changeUserRole);
router.patch('/users/:id/disable', disableUser);

router.get('/exams', adminGetExams);
router.delete('/exams/:examId', adminDeleteExam);
router.post('/exams/:examId/reset-state', adminResetExamState);

router.get('/subjects', adminGetSubjects);
router.delete('/subjects/:subjectId', adminDeleteSubject);

router.get('/activity', getRecentActivity);

export default router;
