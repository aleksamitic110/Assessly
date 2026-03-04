// Shared types between frontend and backend

export type UserRole = 'STUDENT' | 'PROFESSOR' | 'ADMIN';

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
  maxPoints?: number;
  subjectId?: string;
  subjectName?: string;
  status?: 'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed' | 'withdrawn' | 'submitted';
  taskCount?: number;
  actualStartTime?: number;
  endTime?: number;
  remainingSeconds?: number;
}

export interface Task {
  id: string;
  title: string;
  maxPoints?: number;
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

export interface Submission {
  taskId: string;
  taskTitle?: string;
  taskMaxPoints?: number;
  awardedPoints?: number | null;
  sourceCode: string;
  output: string;
  updatedAt?: string | null;
}

export interface SecurityEvent {
  examId: string;
  studentId: string;
  eventType: SecurityEventType;
  timestamp: string;
  details: Record<string, unknown>;
}

// Grade types
export interface Grade {
  examId: string;
  studentId: string;
  value: number;
  comment: string;
  professorId: string;
  updatedAt: string | null;
  totalAwardedPoints?: number;
  totalMaxPoints?: number;
}

// Exam Comment types (professor's feedback on student code)
export interface ExamComment {
  examId: string;
  studentId: string;
  commentId: string;
  line: number | null;
  message: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

// Student with submission info (for professor's review)
export interface ExamStudent {
  studentId: string;
  email: string;
  firstName: string;
  lastName: string;
  submittedAt: string | null;
  totalMaxPoints?: number;
  totalAwardedPoints?: number;
  grade: {
    value: number;
    comment: string;
    updatedAt: string | null;
  } | null;
}

// Chat message types (for live exam chat)
export interface ChatMessage {
  examId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  message: string;
  status: 'pending' | 'approved';
  replyTo: string | null;
  replyMessage: string | null;
  replyAuthorId: string | null;
  replyAuthorName: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface QuestionBankItem {
  id: string;
  _id?: string;
  subjectId: string;
  createdByProfessorId: string;
  sourceExamId?: string | null;
  sourceTaskId?: string | null;
  title: string;
  description?: string | null;
  starterCode?: string | null;
  testCases: string;
  pdfPath?: string | null;
  exampleInput?: string | null;
  exampleOutput?: string | null;
  notes?: string | null;
  tags: string[];
  difficulty: QuestionDifficulty;
  useCount: number;
  archived: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDifficultyStat {
  taskId: string;
  taskTitle: string;
  attempts: number;
  studentsCount: number;
  successfulStudents: number;
  successRate: number;
  errorRate: number;
  hardnessScore: number;
  taskMaxPoints?: number;
  averageAwardedPoints?: number;
  completionRate?: number;
  gradedStudents?: number;
  totalAwardedPoints?: number;
  examId?: string | null;
  examName?: string | null;
}

export interface ExamOverviewStats {
  exam: {
    id: string;
    name: string;
    subjectId: string;
    subjectName: string;
  };
  counts: {
    enrolled: number;
    worked: number;
    submitted: number;
    graded: number;
    passed: number;
    withdrawn: number;
  };
  rates: {
    workRate: number;
    submissionRate: number;
    passRateAmongGraded: number;
    passRateAmongEnrolled: number;
    withdrawalRate: number;
  };
  grades: {
    average: number;
    median: number;
    distribution: Record<string, number>;
  };
  tasks: {
    hardest: TaskDifficultyStat[];
    easiest: TaskDifficultyStat[];
  };
}

export interface SubjectOverviewStats {
  subject: {
    id: string;
    name: string;
  };
  totals: {
    exams: number;
    enrolledStudents: number;
    studentsWhoWorked: number;
    studentsWhoSubmitted: number;
    gradedCount: number;
    passedCount: number;
  };
  rates: {
    activeRate: number;
    submissionRate: number;
    passRateAmongGraded: number;
  };
  grades: {
    average: number;
    median: number;
    distribution: Record<string, number>;
  };
  exams: {
    hardest: Array<{
      examId: string;
      examName: string;
      startTime: string | null;
      submittedCount: number;
      workedCount: number;
      withdrawnCount: number;
      gradedCount: number;
      passedCount: number;
      passRate: number;
      averageGrade: number;
      hardnessScore: number;
    }>;
    easiest: Array<{
      examId: string;
      examName: string;
      startTime: string | null;
      submittedCount: number;
      workedCount: number;
      withdrawnCount: number;
      gradedCount: number;
      passedCount: number;
      passRate: number;
      averageGrade: number;
      hardnessScore: number;
    }>;
    all: Array<{
      examId: string;
      examName: string;
      startTime: string | null;
      submittedCount: number;
      workedCount: number;
      withdrawnCount: number;
      gradedCount: number;
      passedCount: number;
      passRate: number;
      averageGrade: number;
      hardnessScore: number;
    }>;
  };
  tasks: {
    hardest: TaskDifficultyStat[];
    easiest: TaskDifficultyStat[];
  };
}
