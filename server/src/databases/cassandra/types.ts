export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'RUNNING';
export type SecurityEventType = 'TAB_SWITCH' | 'COPY_PASTE' | 'BLUR' | 'FOCUS' | 'SUSPICIOUS_ACTIVITY';
export type UserActivityEventType = 'REGISTER' | 'LOGIN';

export interface ExecutionLog {
  examId: string;
  studentId: string;
  taskId: string;
  timestamp: Date;
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

export interface SecurityEvent {
  examId: string;
  studentId: string;
  eventType: SecurityEventType;
  timestamp: Date;
  details: string;
}

export interface UserActivityLog {
  userId: string;
  eventType: UserActivityEventType;
  timestamp: Date;
  details: string;
}

export interface LogExecutionRequest {
  examId: string;
  taskId: string;
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

export interface LogSecurityEventRequest {
  examId: string;
  eventType: SecurityEventType;
  details?: Record<string, unknown>;
}

export interface ExecutionLogResponse {
  examId: string;
  studentId: string;
  taskId: string;
  timestamp: string;
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

export interface SecurityEventResponse {
  examId: string;
  studentId: string;
  eventType: SecurityEventType;
  timestamp: string;
  details: Record<string, unknown>;
}
