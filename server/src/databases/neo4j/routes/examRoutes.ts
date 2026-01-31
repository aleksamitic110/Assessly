import { Router } from 'express';
import {
  createSubject,
  updateSubject,
  deleteSubject,
  addProfessorToSubject,
  enrollSubject,
  unenrollSubject,
  getStudentSubjects,
  getAvailableExams,
  getProfessorSubjects,
  getExamTasks,
  getExamById,
  withdrawExam,
  saveSubmission,
  runCode,
  getMySubmissions,
  getStudentSubmissions,
  submitExam,
  createExam,
  updateExam,
  deleteExam,
  createTask,
  updateTask,
  deleteTask,
  setGrade,
  getGrade,
  getExamStudents
} from '../controllers/examController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';
import { taskUpload } from '../../../middleware/upload.js';
import { validate } from '../../../middleware/validate.js';
import { uuidParam, subjectSchemas, examSchemas, taskSchemas, submissionSchemas, runSchemas } from '../../../validation/schemas.js';

const router = Router();

router.post('/subjects', authenticateJWT, requireRole('PROFESSOR'), validate({ body: subjectSchemas.create }), createSubject);
router.post('/subjects/:subjectId/professors', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam, body: subjectSchemas.addProfessor }), addProfessorToSubject);
router.put('/subjects/:subjectId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam, body: subjectSchemas.update }), updateSubject);
router.delete('/subjects/:subjectId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), deleteSubject);
router.post('/subjects/enroll', authenticateJWT, requireRole('STUDENT'), validate({ body: subjectSchemas.enroll }), enrollSubject);
router.delete('/subjects/:subjectId/unenroll', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam }), unenrollSubject);
router.get('/subjects/enrolled', authenticateJWT, requireRole('STUDENT'), getStudentSubjects);
router.post('/exams', authenticateJWT, requireRole('PROFESSOR'), validate({ body: examSchemas.create }), createExam);
router.put('/exams/:examId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam, body: examSchemas.update }), updateExam);
router.delete('/exams/:examId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), deleteExam);
router.post('/tasks', authenticateJWT, requireRole('PROFESSOR'), taskUpload.single('pdf'), validate({ body: taskSchemas.create }), createTask);
router.put('/tasks/:taskId', authenticateJWT, requireRole('PROFESSOR'), taskUpload.single('pdf'), validate({ params: uuidParam, body: taskSchemas.update }), updateTask);
router.delete('/tasks/:taskId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), deleteTask);
router.get('/', authenticateJWT, getAvailableExams);
router.get('/subjects', authenticateJWT, requireRole('PROFESSOR'), getProfessorSubjects);
router.get('/:examId', authenticateJWT, validate({ params: uuidParam }), getExamById);
router.get('/:examId/tasks', authenticateJWT, validate({ params: uuidParam }), getExamTasks);
router.post('/:examId/run', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam, body: runSchemas.run }), runCode);
router.post('/:examId/submissions', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam, body: submissionSchemas.save }), saveSubmission);
router.get('/:examId/submissions', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam }), getMySubmissions);
router.get('/:examId/submissions/:studentId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), getStudentSubmissions);
router.post('/:examId/submit', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam }), submitExam);
router.post('/:examId/withdraw', authenticateJWT, requireRole('STUDENT'), validate({ params: uuidParam }), withdrawExam);

// Grade routes
router.get('/:examId/students', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), getExamStudents);
router.post('/:examId/grade/:studentId', authenticateJWT, requireRole('PROFESSOR'), validate({ params: uuidParam }), setGrade);
router.get('/:examId/grade/:studentId', authenticateJWT, validate({ params: uuidParam }), getGrade);

export default router;
