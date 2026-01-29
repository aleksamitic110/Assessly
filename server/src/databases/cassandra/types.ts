export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'RUNNING';
export type SecurityEventType = 'TAB_SWITCH' | 'COPY_PASTE' | 'BLUR' | 'FOCUS' | 'SUSPICIOUS_ACTIVITY';
export type UserActivityEventType =
  | 'REGISTER'
  | 'LOGIN'
  | 'EXAM_WITHDRAW'
  | 'PASSWORD_CHANGE'
  | 'ADMIN_USER_ROLE_CHANGE'
  | 'ADMIN_USER_DISABLE'
  | 'ADMIN_USER_CREATE'
  | 'ADMIN_USER_DELETE'
  | 'ADMIN_SUBJECT_CREATE'
  | 'ADMIN_SUBJECT_UPDATE'
  | 'ADMIN_SUBJECT_DELETE'
  | 'ADMIN_EXAM_CREATE'
  | 'ADMIN_EXAM_UPDATE'
  | 'ADMIN_EXAM_DELETE'
  | 'ADMIN_EXAM_RESET_STATE'
  | 'ADMIN_TASK_CREATE'
  | 'ADMIN_TASK_UPDATE'
  | 'ADMIN_TASK_DELETE';

export interface ExecutionLog {
  examId: string;
  studentId: string;
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
