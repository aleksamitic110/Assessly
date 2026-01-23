// Shared types between frontend and backend

export type UserRole = 'STUDENT' | 'PROFESSOR';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

// Exam related types
export interface Subject {
  id: string;
  name: string;
  description: string;
}

export interface Exam {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  subjectId?: string;
  subjectName?: string;
  status?: 'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed' | 'withdrawn';
  actualStartTime?: number;
  endTime?: number;
  remainingSeconds?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  testCases: string; // JSON string
  pdfUrl?: string | null;
  exampleInput?: string | null;
  exampleOutput?: string | null;
  notes?: string | null;
}

// Cassandra log types
export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'RUNNING';
export type SecurityEventType = 'TAB_SWITCH' | 'COPY_PASTE' | 'BLUR' | 'FOCUS' | 'SUSPICIOUS_ACTIVITY';

export interface ExecutionLog {
  examId: string;
  studentId: string;
  timestamp: string;
  sourceCode: string;
  output: string;
  status: ExecutionStatus;
}

export interface SecurityEvent {
  examId: string;
  studentId: string;
  eventType: SecurityEventType;
  timestamp: string;
  details: Record<string, unknown>;
}
