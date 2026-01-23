import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export const authenticateJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = (req as any).cookies?.access_token;
  const token = bearer || cookieToken;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    if (!decoded?.id || !decoded?.role) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = decoded;
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const requireRole = (...roles: string[]) => {
  const allowed = new Set(roles);
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user?.role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowed.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
};
