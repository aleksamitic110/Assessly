import { Router } from 'express';
import {
  createSubject,
  updateSubject,
  deleteSubject,
  getAvailableExams,
  getProfessorSubjects,
  getExamTasks,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  createTask
} from '../controllers/examController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/subjects', authenticateJWT, createSubject);
router.put('/subjects/:subjectId', authenticateJWT, updateSubject);
router.delete('/subjects/:subjectId', authenticateJWT, deleteSubject);
router.post('/exams', authenticateJWT, createExam);
router.put('/exams/:examId', authenticateJWT, updateExam);
router.delete('/exams/:examId', authenticateJWT, deleteExam);
router.post('/tasks', authenticateJWT, createTask);
router.get('/', authenticateJWT, getAvailableExams);
router.get('/subjects', authenticateJWT, getProfessorSubjects);
router.get('/:examId', authenticateJWT, getExamById);
router.get('/:examId/tasks', authenticateJWT, getExamTasks);

export default router;
