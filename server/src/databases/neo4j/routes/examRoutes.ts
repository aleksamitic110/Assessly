import { Router } from 'express';
import {
  createSubject,
  updateSubject,
  deleteSubject,
  getAvailableExams,
  getProfessorSubjects,
  getExamTasks,
  getExamById,
  withdrawExam,
  createExam,
  updateExam,
  deleteExam,
  createTask,
  updateTask,
  deleteTask
} from '../controllers/examController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import { taskUpload } from '../../../middleware/upload.js';

const router = Router();

router.post('/subjects', authenticateJWT, createSubject);
router.put('/subjects/:subjectId', authenticateJWT, updateSubject);
router.delete('/subjects/:subjectId', authenticateJWT, deleteSubject);
router.post('/exams', authenticateJWT, createExam);
router.put('/exams/:examId', authenticateJWT, updateExam);
router.delete('/exams/:examId', authenticateJWT, deleteExam);
router.post('/tasks', authenticateJWT, taskUpload.single('pdf'), createTask);
router.put('/tasks/:taskId', authenticateJWT, taskUpload.single('pdf'), updateTask);
router.delete('/tasks/:taskId', authenticateJWT, deleteTask);
router.get('/', authenticateJWT, getAvailableExams);
router.get('/subjects', authenticateJWT, getProfessorSubjects);
router.get('/:examId', authenticateJWT, getExamById);
router.get('/:examId/tasks', authenticateJWT, getExamTasks);
router.post('/:examId/withdraw', authenticateJWT, withdrawExam);

export default router;
