import { Router } from 'express';
import { getExamStats } from '../controllers/statsController.js';
import { authenticateToken } from '../../neo4j/middleware/authMiddleware.js';

const router = Router();

// Zovemo authenticateToken da osiguramo da je korisnik ulogovan
router.get('/exam/:examId', authenticateToken, getExamStats);

export default router;