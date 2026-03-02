import { Router } from 'express';
import { getExamStats } from '../controllers/statsController.js';
import { authenticateJWT } from '../../neo4j/middleware/authMiddleware.js';

const router = Router();

// Zovemo authenticateJWT da osiguramo da je korisnik ulogovan
router.get('/exam/:examId', authenticateJWT, getExamStats);

export default router;
