import axios from 'axios';
import type {
  Grade,
  ExamComment,
  ExamStudent,
  Submission,
  ChatMessage,
  ExamOverviewStats,
  QuestionBankItem,
  QuestionDifficulty,
  SubjectOverviewStats,
  Task
} from '../types';

const API_URL = import.meta.env.VITE_API_URL?.trim() || '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Automatski redirect na login ako token istekne
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const gradeApi = {
  setGrade: (examId: string, studentId: string, value: number, comment: string) =>
    api.post<Grade>(`/exams/${examId}/grade/${studentId}`, { value, comment }),

  getGrade: (examId: string, studentId: string) =>
    api.get<Grade | null>(`/exams/${examId}/grade/${studentId}`),

  getExamStudents: (examId: string) =>
    api.get<ExamStudent[]>(`/exams/${examId}/students`),

  getStudentSubmissions: (examId: string, studentId: string) =>
    api.get<Submission[]>(`/exams/${examId}/submissions/${studentId}`),
};

export const commentsApi = {
  addComment: (examId: string, studentId: string, line: number | null, message: string) =>
    api.post<ExamComment>(`/logs/comments/${examId}/${studentId}`, { line, message }),

  getComments: (examId: string, studentId: string) =>
    api.get<ExamComment[]>(`/logs/comments/${examId}/${studentId}`),

  deleteComment: (examId: string, studentId: string, commentId: string) =>
    api.delete(`/logs/comments/${examId}/${studentId}/${commentId}`),

  updateComment: (examId: string, studentId: string, commentId: string, line: number | null, message: string) =>
    api.put<ExamComment>(`/logs/comments/${examId}/${studentId}/${commentId}`, { line, message }),
};

export const chatApi = {
  getMessages: (examId: string) =>
    api.get<ChatMessage[]>(`/logs/chat/${examId}`),

  sendMessage: (examId: string, message: string) =>
    api.post<ChatMessage>(`/logs/chat/${examId}`, { message }),

  replyToMessage: (examId: string, messageId: string, replyMessage: string) =>
    api.post<ChatMessage>(`/logs/chat/${examId}/${messageId}/reply`, { replyMessage }),
};

type QuestionBankListParams = {
  search?: string;
  difficulty?: QuestionDifficulty | '';
  tags?: string;
  includeArchived?: boolean;
};

type QuestionBankPayload = {
  title: string;
  description?: string | null;
  starterCode?: string | null;
  testCases?: string;
  pdfPath?: string | null;
  exampleInput?: string | null;
  exampleOutput?: string | null;
  notes?: string | null;
  difficulty?: QuestionDifficulty;
  tags?: string | string[];
  archived?: boolean;
};

export const questionBankApi = {
  listItems: (subjectId: string, params: QuestionBankListParams = {}) =>
    api.get<QuestionBankItem[]>(`/question-bank/subjects/${subjectId}/items`, { params }),

  createItem: (subjectId: string, payload: QuestionBankPayload) =>
    api.post<QuestionBankItem>(`/question-bank/subjects/${subjectId}/items`, payload),

  updateItem: (itemId: string, payload: Partial<QuestionBankPayload>) =>
    api.patch<QuestionBankItem>(`/question-bank/items/${itemId}`, payload),

  deleteItem: (itemId: string) =>
    api.delete(`/question-bank/items/${itemId}`),

  importItemToExam: (examId: string, itemId: string) =>
    api.post<Task>(`/question-bank/exams/${examId}/import`, { itemId }),

  autoGenerateForExam: (
    examId: string,
    payload: { count: number; difficulty?: QuestionDifficulty | ''; tags?: string | string[] }
  ) => api.post<{ createdCount: number; tasks: Task[] }>(`/question-bank/exams/${examId}/auto-generate`, payload)
};

export const statsApi = {
  getExamOverview: (examId: string) =>
    api.get<ExamOverviewStats>(`/stats/exam/${examId}/overview`),

  getSubjectOverview: (subjectId: string) =>
    api.get<SubjectOverviewStats>(`/stats/subject/${subjectId}/overview`)
};

export default api;
