import type { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }

  if (err?.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message });
  }

  const status = err?.status || 500;
  const message = status >= 500 ? 'Internal server error' : err?.message || 'Error';
  return res.status(status).json({ error: message });
};
