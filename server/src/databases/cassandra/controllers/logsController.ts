import type { Request, Response } from 'express';
import {
  logExecution,
  getExecutionLogs,
  logSecurityEvent,
  getSecurityEvents,
  getSecurityEventsForStudent,
  countSecurityEvents
} from '../services/logsService.js';
import type { LogExecutionRequest, LogSecurityEventRequest } from '../types.js';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export async function createExecutionLog(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, sourceCode, output, status } = req.body as LogExecutionRequest;
    const studentId = req.user?.id;

    if (!studentId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!examId || !sourceCode || !status) {
      return res.status(400).json({ error: 'Missing required fields: examId, sourceCode, status' });
    }

    await logExecution(examId, studentId, sourceCode, output || '', status);
    res.status(201).json({ message: 'Execution logged successfully' });
  } catch (error) {
    console.error('Error logging execution:', error);
    res.status(500).json({ error: 'Failed to log execution' });
  }
}

export async function getMyExecutionLogs(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId } = req.params;
    const studentId = req.user?.id;

    if (!studentId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const logs = await getExecutionLogs(examId, studentId);
    res.json(logs);
  } catch (error) {
    console.error('Error fetching execution logs:', error);
    res.status(500).json({ error: 'Failed to fetch execution logs' });
  }
}

export async function getStudentExecutionLogs(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can view student logs' });
    }

    const logs = await getExecutionLogs(examId, studentId);
    res.json(logs);
  } catch (error) {
    console.error('Error fetching student execution logs:', error);
    res.status(500).json({ error: 'Failed to fetch execution logs' });
  }
}

export async function createSecurityEvent(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, eventType, details } = req.body as LogSecurityEventRequest;
    const studentId = req.user?.id;

    if (!studentId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!examId || !eventType) {
      return res.status(400).json({ error: 'Missing required fields: examId, eventType' });
    }

    await logSecurityEvent(examId, studentId, eventType, details || {});
    res.status(201).json({ message: 'Security event logged' });
  } catch (error) {
    console.error('Error logging security event:', error);
    res.status(500).json({ error: 'Failed to log security event' });
  }
}

export async function getExamSecurityEvents(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can view security events' });
    }

    const events = await getSecurityEvents(examId);
    res.json(events);
  } catch (error) {
    console.error('Error fetching security events:', error);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
}

export async function getStudentSecurityEvents(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId } = req.params;
    const userRole = req.user?.role;

    if (userRole !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can view security events' });
    }

    const events = await getSecurityEventsForStudent(examId, studentId);
    res.json({ events, totalViolations: events.length });
  } catch (error) {
    console.error('Error fetching student security events:', error);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
}

export async function getViolationCount(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId } = req.params;
    const count = await countSecurityEvents(examId, studentId);
    res.json({ count });
  } catch (error) {
    console.error('Error counting violations:', error);
    res.status(500).json({ error: 'Failed to count violations' });
  }
}
