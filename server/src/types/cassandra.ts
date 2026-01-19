// Tipovi za Cassandra tabele (execution_logs i security_events)

export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'RUNNING';

export type SecurityEventType = 'TAB_SWITCH' | 'COPY_PASTE' | 'BLUR' | 'FOCUS' | 'SUSPICIOUS_ACTIVITY';

export type UserActivityEventType = 'REGISTER' | 'LOGIN';

// Tabela: execution_logs
// PRIMARY KEY ((exam_id, student_id), timestamp)
export interface ExecutionLog {
  examId: string;      // UUID
  studentId: string;   // UUID
  taskId: string;      // UUID
  timestamp: Date;
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

// Tabela: security_events
// PRIMARY KEY ((exam_id), timestamp)
export interface SecurityEvent {
  examId: string;      // UUID
  studentId: string;   // UUID
  eventType: SecurityEventType;
  timestamp: Date;
  details: string;     // JSON string sa dodatnim informacijama
}

// Tabela: user_activity
// PRIMARY KEY ((user_id), timestamp)
export interface UserActivityLog {
  userId: string;      // UUID
  eventType: UserActivityEventType;
  timestamp: Date;
  details: string;     // JSON string
}

// Request tipovi za API
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

// Response tipovi
export interface ExecutionLogResponse {
  examId: string;
  studentId: string;
  taskId: string;
  timestamp: string;   // ISO string
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

export interface SecurityEventResponse {
  examId: string;
  studentId: string;
  eventType: SecurityEventType;
  timestamp: string;   // ISO string
  details: Record<string, unknown>;
}
