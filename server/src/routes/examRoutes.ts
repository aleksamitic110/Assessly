import { Router } from 'express';
import { createSubject } from '../controllers/examController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import { createExam } from '../controllers/examController.js';
import { createTask } from '../controllers/examController.js';

const router = Router();


router.post('/subjects', authenticateJWT, createSubject);
router.post('/exams', authenticateJWT, createExam);
router.post('/tasks', authenticateJWT, createTask);

export default router;