import { Router } from 'express';
import { authenticateJWT, requireRole } from '../../neo4j/middleware/authMiddleware.js';
import { validate } from '../../../middleware/validate.js';
import { uuidParam } from '../../../validation/schemas.js';
import {
  autoGenerateTasksFromQuestionBank,
  createQuestionBankItem,
  deleteQuestionBankItem,
  importQuestionBankItemToExam,
  listQuestionBankItems,
  updateQuestionBankItem
} from '../controllers/questionBankController.js';

const router = Router();

router.use(authenticateJWT, requireRole('PROFESSOR'));

router.get('/subjects/:subjectId/items', validate({ params: uuidParam }), listQuestionBankItems);
router.post('/subjects/:subjectId/items', validate({ params: uuidParam }), createQuestionBankItem);

router.patch('/items/:itemId', updateQuestionBankItem);
router.delete('/items/:itemId', deleteQuestionBankItem);

router.post('/exams/:examId/import', validate({ params: uuidParam }), importQuestionBankItemToExam);
router.post('/exams/:examId/auto-generate', validate({ params: uuidParam }), autoGenerateTasksFromQuestionBank);

export default router;
