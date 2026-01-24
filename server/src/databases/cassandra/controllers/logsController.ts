import type { Request, Response } from 'express';
import {
  logExecution,
  getExecutionLogs,
  logSecurityEvent,
  getSecurityEvents,
  getSecurityEventsForStudent,
  countSecurityEvents,
  addExamComment,
  getExamComments,
  deleteExamComment,
  updateExamComment
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

// Exam Comments
export async function createExamComment(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId } = req.params;
    const { line, message } = req.body;
    const authorId = req.user?.id;
    const authorName = `${req.user?.email || 'Unknown'}`;

    if (!authorId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user?.role !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can add comments' });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Parse line number - handle null, undefined, NaN, and invalid values
    let parsedLine: number | null = null;
    if (line !== null && line !== undefined) {
      const numLine = typeof line === 'number' ? line : parseInt(String(line), 10);
      if (!Number.isNaN(numLine) && Number.isFinite(numLine) && numLine > 0) {
        parsedLine = numLine;
      }
    }

    console.log('Adding comment with:', {
      examId,
      studentId,
      parsedLine,
      message: message.substring(0, 50),
      authorId,
      authorName
    });

    const commentId = await addExamComment(
      examId,
      studentId,
      parsedLine,
      message,
      authorId,
      authorName
    );

    res.status(201).json({
      commentId,
      examId,
      studentId,
      line: parsedLine,
      message,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error creating exam comment:', error.message);
    console.error('Full error stack:', error.stack);
    res.status(500).json({ error: 'Failed to create comment', details: error.message });
  }
}

export async function fetchExamComments(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Students can only view their own comments
    if (userRole === 'STUDENT' && studentId !== userId) {
      return res.status(403).json({ error: 'You can only view your own comments' });
    }

    const comments = await getExamComments(examId, studentId);
    res.json(comments);
  } catch (error) {
    console.error('Error fetching exam comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
}

export async function removeExamComment(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId, commentId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user?.role !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can delete comments' });
    }

    await deleteExamComment(examId, studentId, commentId);
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Error deleting exam comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
}

export async function editExamComment(req: AuthenticatedRequest, res: Response) {
  try {
    const { examId, studentId, commentId } = req.params;
    const { line, message } = req.body;
    const authorId = req.user?.id;
    const authorName = `${req.user?.email || 'Unknown'}`;

    if (!authorId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user?.role !== 'PROFESSOR') {
      return res.status(403).json({ error: 'Only professors can edit comments' });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    let parsedLine: number | null = null;
    if (line !== null && line !== undefined) {
      const numLine = typeof line === 'number' ? line : parseInt(String(line), 10);
      if (!Number.isNaN(numLine) && Number.isFinite(numLine) && numLine > 0) {
        parsedLine = numLine;
      }
    }

    await updateExamComment(
      examId,
      studentId,
      commentId,
      parsedLine,
      message,
      authorId,
      authorName
    );

    res.json({
      commentId,
      examId,
      studentId,
      line: parsedLine,
      message,
      authorId,
      authorName,
      updatedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error editing exam comment:', error.message);
    res.status(500).json({ error: 'Failed to edit comment', details: error.message });
  }
}
