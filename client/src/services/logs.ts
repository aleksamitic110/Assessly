import api from './api';
import type { ExecutionStatus, SecurityEventType, ExecutionLog, SecurityEvent } from '../types';

export const logsService = {
  // Log code execution (student runs code)
  async logExecution(
    examId: string,
    sourceCode: string,
    output: string,
    status: ExecutionStatus
  ): Promise<void> {
    await api.post('/logs/execution', {
      examId,
      sourceCode,
      output,
      status,
    });
  },

  // Get my execution logs for an exam
  async getMyExecutionLogs(examId: string): Promise<ExecutionLog[]> {
    const response = await api.get<ExecutionLog[]>(`/logs/execution/${examId}`);
    return response.data;
  },

  // Professor: Get student's execution logs
  async getStudentExecutionLogs(examId: string, studentId: string): Promise<ExecutionLog[]> {
    const response = await api.get<ExecutionLog[]>(`/logs/execution/${examId}/${studentId}`);
    return response.data;
  },

  // Log security event (anti-cheat)
  async logSecurityEvent(
    examId: string,
    eventType: SecurityEventType,
    details?: Record<string, unknown>
  ): Promise<void> {
    await api.post('/logs/security', {
      examId,
      eventType,
      details,
    });
  },

  // Professor: Get all security events for an exam
  async getExamSecurityEvents(examId: string): Promise<SecurityEvent[]> {
    const response = await api.get<SecurityEvent[]>(`/logs/security/${examId}`);
    return response.data;
  },

  // Professor: Get student's security events
  async getStudentSecurityEvents(
    examId: string,
    studentId: string
  ): Promise<{ events: SecurityEvent[]; totalViolations: number }> {
    const response = await api.get(`/logs/security/${examId}/${studentId}`);
    return response.data;
  },

  // Get violation count for a student
  async getViolationCount(examId: string, studentId: string): Promise<number> {
    const response = await api.get<{ count: number }>(`/logs/security/${examId}/${studentId}/count`);
    return response.data.count;
  },
};

export default logsService;
