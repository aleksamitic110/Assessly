import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

type Schemas = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export const validate = (schemas: Schemas) => (req: Request, res: Response, next: NextFunction) => {
  try {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    if (schemas.query) {
      const parsedQuery = schemas.query.parse(req.query) as Record<string, unknown>;
      // Express can expose req.query as a getter-only property in some setups.
      // Mutate the existing query object to keep validated values without reassigning.
      const currentQuery = req.query as Record<string, unknown>;
      Object.keys(currentQuery).forEach((key) => delete currentQuery[key]);
      Object.assign(currentQuery, parsedQuery);
    }
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }
    next(error);
  }
};
