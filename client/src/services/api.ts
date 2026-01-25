import axios from 'axios';
import type { Grade, ExamComment, ExamStudent, Submission, ChatMessage } from '../types';

const API_URL = 'http://localhost:3000/api';

// Create axios instance with base config
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors (unauthorized)
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

// Grade API functions
export const gradeApi = {
  // Set or update a grade (professor only)
  setGrade: (examId: string, studentId: string, value: number, comment: string) =>
    api.post<Grade>(`/exams/${examId}/grade/${studentId}`, { value, comment }),

  // Get a grade
  getGrade: (examId: string, studentId: string) =>
    api.get<Grade | null>(`/exams/${examId}/grade/${studentId}`),

  // Get all students who submitted an exam (professor only)
  getExamStudents: (examId: string) =>
    api.get<ExamStudent[]>(`/exams/${examId}/students`),

  // Get student submissions (professor only)
  getStudentSubmissions: (examId: string, studentId: string) =>
    api.get<Submission[]>(`/exams/${examId}/submissions/${studentId}`),
};

// Comments API functions (Cassandra)
export const commentsApi = {
  // Add a comment to student's exam work (professor only)
  addComment: (examId: string, studentId: string, line: number | null, message: string) =>
    api.post<ExamComment>(`/logs/comments/${examId}/${studentId}`, { line, message }),

  // Get all comments for a student's exam work
  getComments: (examId: string, studentId: string) =>
    api.get<ExamComment[]>(`/logs/comments/${examId}/${studentId}`),

  // Delete a comment (professor only)
  deleteComment: (examId: string, studentId: string, commentId: string) =>
    api.delete(`/logs/comments/${examId}/${studentId}/${commentId}`),

  // Update a comment (professor only)
  updateComment: (examId: string, studentId: string, commentId: string, line: number | null, message: string) =>
    api.put<ExamComment>(`/logs/comments/${examId}/${studentId}/${commentId}`, { line, message }),
};

// Chat API functions (Cassandra - live exam chat)
export const chatApi = {
  // Get chat messages for an exam
  getMessages: (examId: string) =>
    api.get<ChatMessage[]>(`/logs/chat/${examId}`),

  // Send a chat message (student)
  sendMessage: (examId: string, message: string) =>
    api.post<ChatMessage>(`/logs/chat/${examId}`, { message }),

  // Reply to a chat message (professor only)
  replyToMessage: (examId: string, messageId: string, replyMessage: string) =>
    api.post<ChatMessage>(`/logs/chat/${examId}/${messageId}/reply`, { replyMessage }),
};

export default api;
