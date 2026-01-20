import { Router } from 'express';
import {
  createSubject,
  getAvailableExams,
  getProfessorSubjects,
  getExamTasks,
  getExamById,
  createExam,
  createTask
} from '../controllers/examController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/subjects', authenticateJWT, createSubject);
router.post('/exams', authenticateJWT, createExam);
router.post('/tasks', authenticateJWT, createTask);
router.get('/', authenticateJWT, getAvailableExams);
router.get('/subjects', authenticateJWT, getProfessorSubjects);
router.get('/:examId', authenticateJWT, getExamById);
router.get('/:examId/tasks', authenticateJWT, getExamTasks);

export default router;
