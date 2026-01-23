import { Router } from 'express';
import {
  createSubject,
  updateSubject,
  deleteSubject,
  enrollSubject,
  unenrollSubject,
  getStudentSubjects,
  getAvailableExams,
  getProfessorSubjects,
  getExamTasks,
  getExamById,
  withdrawExam,
  saveSubmission,
  getMySubmissions,
  getStudentSubmissions,
  submitExam,
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
router.post('/subjects/enroll', authenticateJWT, enrollSubject);
router.delete('/subjects/:subjectId/unenroll', authenticateJWT, unenrollSubject);
router.get('/subjects/enrolled', authenticateJWT, getStudentSubjects);
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
router.post('/:examId/submissions', authenticateJWT, saveSubmission);
router.get('/:examId/submissions', authenticateJWT, getMySubmissions);
router.get('/:examId/submissions/:studentId', authenticateJWT, getStudentSubmissions);
router.post('/:examId/submit', authenticateJWT, submitExam);
router.post('/:examId/withdraw', authenticateJWT, withdrawExam);

export default router;
