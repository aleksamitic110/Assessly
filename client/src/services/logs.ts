import api from './api';
import type { ExecutionStatus, SecurityEventType, ExecutionLog, SecurityEvent } from '../types';

export const logsService = {
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

  async getMyExecutionLogs(examId: string): Promise<ExecutionLog[]> {
    const response = await api.get<ExecutionLog[]>(`/logs/execution/${examId}`);
    return response.data;
  },

  async getStudentExecutionLogs(examId: string, studentId: string): Promise<ExecutionLog[]> {
    const response = await api.get<ExecutionLog[]>(`/logs/execution/${examId}/${studentId}`);
    return response.data;
  },

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

  async getExamSecurityEvents(examId: string): Promise<SecurityEvent[]> {
    const response = await api.get<SecurityEvent[]>(`/logs/security/${examId}`);
    return response.data;
  },

  async getStudentSecurityEvents(
    examId: string,
    studentId: string
  ): Promise<{ events: SecurityEvent[]; totalViolations: number }> {
    const response = await api.get(`/logs/security/${examId}/${studentId}`);
    return response.data;
  },

  async getViolationCount(examId: string, studentId: string): Promise<number> {
    const response = await api.get<{ count: number }>(`/logs/security/${examId}/${studentId}/count`);
    return response.data.count;
  },
};

export default logsService;
