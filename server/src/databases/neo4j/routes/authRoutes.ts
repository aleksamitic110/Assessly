import { Router } from 'express';
import { register, login, verifyEmail, requestPasswordReset, resetPassword, changePassword } from '../controllers/authController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import { validate } from '../../../middleware/validate.js';
import { authLimiter } from '../../../middleware/rateLimit.js';
import { authSchemas, adminSchemas } from '../../../validation/schemas.js';

const router = Router();

router.post('/register', authLimiter, validate({ body: authSchemas.register }), register);
router.post('/login', authLimiter, validate({ body: authSchemas.login }), login);
router.get('/verify', validate({ query: authSchemas.verifyEmail }), verifyEmail);
router.post('/password-reset/request', authLimiter, validate({ body: authSchemas.requestPasswordReset }), requestPasswordReset);
router.post('/password-reset/confirm', authLimiter, validate({ body: authSchemas.resetPassword }), resetPassword);
router.post('/password/change', authenticateJWT, validate({ body: adminSchemas.changePassword }), changePassword);

export default router;
