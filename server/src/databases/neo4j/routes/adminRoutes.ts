import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';
import { validate } from '../../../middleware/validate.js';
import { adminSchemas } from '../../../validation/schemas.js';
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
  getRecentActivity,
  adminCreateUser,
  adminGetUser,
  adminUpdateUser,
  adminDeleteUser,
  adminCreateSubject,
  adminUpdateSubject,
  adminCreateExam,
  adminUpdateExam,
  adminGetTasks,
  adminCreateTask,
  adminUpdateTask,
  adminDeleteTask,
  getSecurityExamsList
} from '../controllers/adminController.js';

const router = Router();

// Public admin login
router.post('/login', adminLogin);

// All routes below require ADMIN role
router.use(authenticateJWT, requireRole('ADMIN'));

router.get('/health', getSystemHealth);
router.get('/statistics', getStatistics);
router.get('/active-exams', getActiveExams);
router.get('/security-events/exams', getSecurityExamsList);
router.get('/security-events', getSecurityEventsAdmin);

// Users CRUD
router.get('/users', getUsers);
router.post('/users', validate({ body: adminSchemas.createUser }), adminCreateUser);
router.get('/users/:id', adminGetUser);
router.put('/users/:id', validate({ body: adminSchemas.updateUser }), adminUpdateUser);
router.delete('/users/:id', adminDeleteUser);
router.patch('/users/:id/role', changeUserRole);
router.patch('/users/:id/disable', disableUser);

// Exams CRUD
router.get('/exams', adminGetExams);
router.post('/exams', validate({ body: adminSchemas.createExam }), adminCreateExam);
router.put('/exams/:examId', validate({ body: adminSchemas.updateExam }), adminUpdateExam);
router.delete('/exams/:examId', adminDeleteExam);
router.post('/exams/:examId/reset-state', adminResetExamState);

// Subjects CRUD
router.get('/subjects', adminGetSubjects);
router.post('/subjects', validate({ body: adminSchemas.createSubject }), adminCreateSubject);
router.put('/subjects/:subjectId', validate({ body: adminSchemas.updateSubject }), adminUpdateSubject);
router.delete('/subjects/:subjectId', adminDeleteSubject);

// Tasks CRUD
router.get('/tasks/:examId', adminGetTasks);
router.post('/tasks', validate({ body: adminSchemas.createTask }), adminCreateTask);
router.put('/tasks/:taskId', validate({ body: adminSchemas.updateTask }), adminUpdateTask);
router.delete('/tasks/:taskId', adminDeleteTask);

router.get('/activity', getRecentActivity);

export default router;
