import { Fragment, useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam as ExamType, Task as TaskType } from '../types';

interface Subject {
  id: string;
  name: string;
  description: string;
}

interface ProfessorExam extends ExamType {
  taskCount?: number;
}

interface SubjectWithExams extends Subject {
  exams: ProfessorExam[];
}

// Socket alert type
interface Alert {
  studentId: string;
  email: string;
  type: string;
  count: number;
  timestamp: number;
  examId: string;
}

export default function ProfessorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // State for creating subject
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [subjectData, setSubjectData] = useState({ name: '', description: '', password: '' });

  // State for creating exam
  const [showExamForm, setShowExamForm] = useState(false);
  const [examData, setExamData] = useState({
    name: '',
    startTime: '',
    durationMinutes: 60,
    subjectId: '',
  });

  // State for subjects list
  const [subjects, setSubjects] = useState<SubjectWithExams[]>([]);
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);

  // Messages
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  //SOCKET STATES
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [monitoredExams, setMonitoredExams] = useState<Set<string>>(new Set());
  const [taskExamId, setTaskExamId] = useState<string | null>(null);
  const [tasksByExam, setTasksByExam] = useState<Record<string, TaskType[]>>({});
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [editingTask, setEditingTask] = useState<TaskType | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    starterCode: '',
    testCases: '[]',
    exampleInput: '',
    exampleOutput: '',
    notes: '',
    pdfFile: null as File | null,
  });

  const alertsByExam = useMemo(() => {
    return liveAlerts.reduce<Record<string, Alert[]>>((acc, alert) => {
      const key = alert.examId || 'unknown';
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(alert);
      return acc;
    }, {});
  }, [liveAlerts]);

  const examNameById = useMemo(() => {
    const map: Record<string, string> = {};
    subjects.forEach((subject) => {
      subject.exams.forEach((exam) => {
        map[exam.id] = `${exam.name} (${subject.name})`;
      });
    });
    return map;
  }, [subjects]);

  const updateExamStatus = (examId: string, status: ExamType['status']) => {
    setSubjects((prev) =>
      prev.map((subject) => ({
        ...subject,
        exams: subject.exams.map((exam) =>
          exam.id === examId ? { ...exam, status } : exam
        ),
      }))
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleSubject = (subjectId: string) => {
    setExpandedSubjectId((prev) => (prev === subjectId ? null : subjectId));
  };

  // Socket: professor live updates
  useEffect(() => {
    // Connect
    connectSocket();

    // Listen for violations
    socket.on('violation_alert', (data: Alert) => {
      console.log(' NEW ALERT:', data);
      setLiveAlerts((prev) => [data, ...prev]);

      // Optional alert sound
      new Audio('/alert.mp3').play().catch(() => {});
    });

    // Student status updates
    socket.on('student_status_update', (data) => {
      console.log(`Status: ${data.email} -> ${data.status}`);
    });

    socket.on('exam_state', (data: { examId: string; status: ExamType['status'] }) => {
      if (!data?.examId) return;
      if (data.status === 'active' || data.status === 'paused' || data.status === 'completed') {
        updateExamStatus(data.examId, data.status);
      }
    });

    socket.on('exam_start_error', (data: { examId: string; reason?: string }) => {
      if (!data?.examId) return;
      if (data.reason === 'NO_TASKS') {
        setError('Cannot start exam. Add at least one task first.');
      } else {
        setError('Unable to start exam.');
      }
    });

    return () => {
      socket.off('violation_alert');
      socket.off('student_status_update');
      socket.off('exam_state');
      socket.off('exam_start_error');
      disconnectSocket();
    };
  }, []);

  // Socket: start exam handler
  const handleStartExam = (exam: ExamType) => {
    const taskCount = (exam as ProfessorExam).taskCount || 0;
    if (!taskCount) {
      setError('Cannot start exam. Add at least one task first.');
      return;
    }
    if (!confirm(`Start exam "${exam.name}"?`)) return;

    handleMonitorExam(exam.id);

    socket.emit('start_exam', {
      examId: exam.id,
      durationMinutes: exam.durationMinutes
    });

    updateExamStatus(exam.id, 'active');
    setMessage(`Start command sent for exam "${exam.name}".`);
  };

  const handlePauseExam = (exam: ExamType) => {
    socket.emit('pause_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'paused');
    setMessage(`Exam "${exam.name}" paused.`);
  };

  const handleResumeExam = (exam: ExamType) => {
    socket.emit('resume_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'active');
    setMessage(`Exam "${exam.name}" resumed.`);
  };

  const handleExtendExam = (exam: ExamType) => {
    const extra = prompt('Enter extra minutes:', '10');
    const extraMinutes = extra ? parseInt(extra, 10) : 0;
    if (!extraMinutes || Number.isNaN(extraMinutes) || extraMinutes <= 0) return;
    socket.emit('extend_exam', { examId: exam.id, extraMinutes });
    setMessage(`Exam "${exam.name}" extended by ${extraMinutes} min.`);
  };

  const handleEndExam = (exam: ExamType) => {
    if (!confirm(`End exam "${exam.name}"?`)) return;
    socket.emit('end_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'completed');
    setMessage(`Exam "${exam.name}" ended.`);
  };

  const handleRestartExam = (exam: ExamType) => {
    const taskCount = (exam as ProfessorExam).taskCount || 0;
    if (!taskCount) {
      setError('Cannot restart exam. Add at least one task first.');
      return;
    }
    if (!confirm(`Restart exam "${exam.name}"?`)) return;
    socket.emit('restart_exam', { examId: exam.id, durationMinutes: exam.durationMinutes });
    updateExamStatus(exam.id, 'active');
    setMessage(`Exam "${exam.name}" restarted.`);
  };

  const resetTaskForm = () => {
    setTaskForm({
      title: '',
      description: '',
      starterCode: '',
      testCases: '[]',
      exampleInput: '',
      exampleOutput: '',
      notes: '',
      pdfFile: null,
    });
    setEditingTask(null);
  };

  const loadTasks = async (examId: string) => {
    setIsLoadingTasks(true);
    setTaskError('');
    try {
      const response = await api.get<TaskType[]>(`/exams/${examId}/tasks`);
      setTasksByExam((prev) => ({ ...prev, [examId]: response.data }));
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.map((exam) =>
            exam.id === examId ? { ...exam, taskCount: response.data.length } : exam
          ),
        }))
      );
    } catch (err: any) {
      setTaskError(err.response?.data?.error || 'Failed to load tasks');
    } finally {
      setIsLoadingTasks(false);
    }
  };

  const toggleTaskPanel = async (examId: string) => {
    if (taskExamId === examId) {
      setTaskExamId(null);
      resetTaskForm();
      return;
    }
    setTaskExamId(examId);
    await loadTasks(examId);
  };

  const handleTaskInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setTaskForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleTaskFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setTaskForm((prev) => ({ ...prev, pdfFile: file }));
  };

  const handleEditTask = (task: TaskType) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title || '',
      description: task.description || '',
      starterCode: task.starterCode || '',
      testCases: task.testCases || '[]',
      exampleInput: task.exampleInput || '',
      exampleOutput: task.exampleOutput || '',
      notes: task.notes || '',
      pdfFile: null,
    });
  };

  const handleSubmitTask = async (e: React.FormEvent, examId: string) => {
    e.preventDefault();
    setTaskError('');
    try {
      JSON.parse(taskForm.testCases || '[]');
    } catch {
      setTaskError('Test cases must be valid JSON.');
      return;
    }

    const formData = new FormData();
    formData.append('title', taskForm.title);
    formData.append('description', taskForm.description);
    formData.append('starterCode', taskForm.starterCode);
    formData.append('testCases', taskForm.testCases);
    formData.append('exampleInput', taskForm.exampleInput);
    formData.append('exampleOutput', taskForm.exampleOutput);
    formData.append('notes', taskForm.notes);
    if (taskForm.pdfFile) {
      formData.append('pdf', taskForm.pdfFile);
    }

    try {
      if (editingTask) {
        const response = await api.put(`/exams/tasks/${editingTask.id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setTasksByExam((prev) => ({
          ...prev,
          [examId]: (prev[examId] || []).map((task) =>
            task.id === editingTask.id ? response.data : task
          ),
        }));
        setMessage(`Task "${response.data.title}" updated.`);
      } else {
        formData.append('examId', examId);
        const response = await api.post('/exams/tasks', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setTasksByExam((prev) => ({
          ...prev,
          [examId]: [...(prev[examId] || []), response.data],
        }));
        setMessage(`Task "${response.data.title}" added.`);
        setSubjects((prev) =>
          prev.map((subject) => ({
            ...subject,
            exams: subject.exams.map((exam) =>
              exam.id === examId
                ? { ...exam, taskCount: (exam.taskCount || 0) + 1 }
                : exam
            ),
          }))
        );
      }
      resetTaskForm();
    } catch (err: any) {
      setTaskError(err.response?.data?.error || 'Error while saving task');
    }
  };

  const handleDeleteTask = async (examId: string, task: TaskType) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.delete(`/exams/tasks/${task.id}`);
      setTasksByExam((prev) => ({
        ...prev,
        [examId]: (prev[examId] || []).filter((item) => item.id !== task.id),
      }));
      setMessage(`Task "${task.title}" deleted.`);
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.map((exam) =>
            exam.id === examId
              ? { ...exam, taskCount: Math.max(0, (exam.taskCount || 0) - 1) }
              : exam
          ),
        }))
      );
    } catch (err: any) {
      setTaskError(err.response?.data?.error || 'Error while deleting task');
    }
  };

  const handleUpdateSubject = async (subject: SubjectWithExams) => {
    const name = prompt('Enter new subject name:', subject.name);
    if (name === null) return;
    const description = prompt('Enter new subject description:', subject.description);
    if (description === null) return;
    const password = prompt('Enter new subject password (leave blank to keep current):', '');
    if (password === null) return;
    const invalidateEnrollments = password
      ? confirm('Remove existing enrollments for this subjectc')
      : false;

    try {
      const response = await api.put(`/exams/subjects/${subject.id}`, {
        name,
        description,
        password: password || undefined,
        invalidateEnrollments
      });
      setSubjects((prev) =>
        prev.map((item) =>
          item.id === subject.id ? { ...item, ...response.data } : item
        )
      );
      setMessage(`Subject "${name}" updated.`);
    } catch (err: any) {
      console.error('Update subject error:', err);
      setError(err.response?.data?.error || 'Error while updating subject');
    }
  };

  const handleDeleteSubject = async (subject: SubjectWithExams) => {
    if (!confirm(`Delete subject "${subject.name}"?`)) return;

    try {
      await api.delete(`/exams/subjects/${subject.id}`);
      setSubjects((prev) => prev.filter((item) => item.id !== subject.id));
      setMessage(`Subject "${subject.name}" deleted.`);
    } catch (err: any) {
      console.error('Delete subject error:', err);
      setError(err.response?.data?.error || 'Error while deleting subject');
    }
  };

  const handleUpdateExam = async (exam: ExamType) => {
    const name = prompt('Enter new exam name:', exam.name);
    if (name === null) return;
    const startTime = prompt('Enter new start time (ISO string):', exam.startTime);
    if (startTime === null) return;
    const durationInput = prompt('Enter new duration (minutes):', exam.durationMinutes.toString());
    if (durationInput === null) return;
    const durationMinutes = parseInt(durationInput, 10);
    if (Number.isNaN(durationMinutes) || durationMinutes <= 0) return;

    try {
      const response = await api.put(`/exams/exams/${exam.id}`, {
        name,
        startTime,
        durationMinutes
      });
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.map((item) =>
            item.id === exam.id ? { ...item, ...response.data } : item
          ),
        }))
      );
      setMessage(`Exam "${name}" updated.`);
    } catch (err: any) {
      console.error('Update exam error:', err);
      setError(err.response?.data?.error || 'Error while updating exam');
    }
  };

  const handleDeleteExam = async (exam: ExamType) => {
    if (!confirm(`Delete exam "${exam.name}"?`)) return;

    try {
      await api.delete(`/exams/exams/${exam.id}`);
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.filter((item) => item.id !== exam.id),
        }))
      );
      setMessage(`Exam "${exam.name}" deleted.`);
    } catch (err: any) {
      console.error('Delete exam error:', err);
      setError(err.response?.data?.error || 'Error while deleting exam');
    }
  };

  //SOCKET: Funkcija za pracenje (Join Room)
  const handleMonitorExam = (examId: string) => {
    socket.emit('join_exam', examId);
    setMonitoredExams((prev) => {
      const next = new Set(prev);
      next.add(examId);
      return next;
    });
    setMessage(`Monitoring enabled for exam ID: ${examId.substring(0, 8)}...`);
  };

  const handleStopMonitorExam = (examId: string) => {
    socket.emit('leave_exam', examId);
    setMonitoredExams((prev) => {
      const next = new Set(prev);
      next.delete(examId);
      return next;
    });
    setMessage(`Monitoring disabled for exam ID: ${examId.substring(0, 8)}...`);
  };


  useEffect(() => {
    let isMounted = true;

    const loadSubjects = async () => {
      setIsLoadingSubjects(true);
      setError('');
      try {
        const response = await api.get<SubjectWithExams[]>('/exams/subjects');
        if (isMounted) {
          setSubjects(response.data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.response?.data?.error || 'Error while loading subjects');
        }
      } finally {
        if (isMounted) {
          setIsLoadingSubjects(false);
        }
      }
    };

    loadSubjects();
    return () => {
      isMounted = false;
    };
  }, []);

  // Create Subject
  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const response = await api.post('/exams/subjects', subjectData);
      setMessage(`Subject "${response.data.name}" created. ID: ${response.data.id}`);
      setSubjects((prev) => [...prev, { ...response.data, exams: [] }]);
      setSubjectData({ name: '', description: '', password: '' });
      setShowSubjectForm(false);
    } catch (err: any) {
      console.error('Create subject error:', err);
      setError(err.response?.data?.error || 'Error while creating subject');
    }
  };

  // Create Exam
  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const response = await api.post('/exams/exams', examData);
      setMessage(`Exam "${response.data.name}" created. ID: ${response.data.id}`);
      const scheduledStart = new Date(examData.startTime).getTime();
      const isFuture = !Number.isNaN(scheduledStart) && scheduledStart > Date.now();
      const initialStatus = isFuture ? 'wait_room' : 'waiting_start';

      setSubjects((prev) =>
        prev.map((subject) =>
          subject.id === examData.subjectId
            ? { ...subject, exams: [...subject.exams, { ...response.data, status: initialStatus }] }
            : subject
        )
      );
      setExamData({ name: '', startTime: '', durationMinutes: 60, subjectId: '' });
      setShowExamForm(false);
    } catch (err: any) {
      console.error('Create exam error:', err);
      setError(err.response?.data?.error || 'Error while creating exam');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              Assessly
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Professor Dashboard
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-gray-700 dark:text-gray-300">
              {user?.firstName} {user?.lastName}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Messages */}
        {message && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-lg">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Create Subject Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-gray-900 dark:text-white">
                Subjects
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Create a new subject you teach
            </p>
            <button
              onClick={() => setShowSubjectForm(!showSubjectForm)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {showSubjectForm ? 'Close' : 'Create subject'}
            </button>

            {/* Subject Form */}
            {showSubjectForm && (
              <form onSubmit={handleCreateSubject} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Subject name"
                    value={subjectData.name}
                    onChange={(e) => setSubjectData({ ...subjectData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <textarea
                    placeholder="Subject description"
                    value={subjectData.description}
                    onChange={(e) => setSubjectData({ ...subjectData, description: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <input
                    type="password"
                    placeholder="Subject password"
                    value={subjectData.password}
                    onChange={(e) => setSubjectData({ ...subjectData, password: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Save subject
                </button>
              </form>
            )}
          </div>

          {/* Create Exam Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-gray-900 dark:text-white">
                Exams
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Create a new exam for students
            </p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              {showExamForm ? 'Close' : 'Create exam'}
            </button>

            {/* Exam Form */}
            {showExamForm && (
              <form onSubmit={handleCreateExam} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Exam name"
                    value={examData.name}
                    onChange={(e) => setExamData({ ...examData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Start time
                  </label>
                  <input
                    type="datetime-local"
                    value={examData.startTime}
                    onChange={(e) => setExamData({ ...examData, startTime: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={examData.durationMinutes}
                    onChange={(e) => setExamData({ ...examData, durationMinutes: parseInt(e.target.value) })}
                    min={1}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Subject
                  </label>
                  <select
                    value={examData.subjectId}
                    onChange={(e) => setExamData({ ...examData, subjectId: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  >
                    <option value="" disabled>
                      {subjects.length > 0 ? 'Select a subject' : 'No subjects available'}
                    </option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Save exam
                </button>
              </form>
            )}
          </div>

          {/*SOCKET: Live Monitoring Card*/}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col h-96">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-red-100 dark:bg-red-900 rounded-lg animate-pulse">
                <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-gray-900 dark:text-white">
                Live Alerts ({liveAlerts.length})
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded p-2 border border-gray-200 dark:border-gray-700">
              {liveAlerts.length === 0 ? (
                <p className="text-center text-gray-500 mt-10">No active alerts.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(alertsByExam)
                    .sort((a, b) => {
                      const aLatest = a[1][0]?.timestamp || 0;
                      const bLatest = b[1][0]?.timestamp || 0;
                      return bLatest - aLatest;
                    })
                    .map(([examId, alerts]) => (
                      <div key={examId} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                        <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                          {examNameById[examId] || `Exam ${examId.substring(0, 8)}...`}
                        </div>
                        <div className="p-2 space-y-2">
                          {alerts.map((alert, idx) => (
                            <div key={`${alert.studentId}-${idx}`} className="p-2 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded text-sm">
                              <div className="flex justify-between font-bold text-red-700 dark:text-red-400">
                                <span>{alert.email}</span>
                                <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <div className="text-gray-600 dark:text-gray-300">
                                Type: {alert.type} | Count: {alert.count}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <button 
              onClick={() => setLiveAlerts([])}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-right"
            >
              Clear logs
            </button>
          </div>
        </div>

        {/* Created Subjects List */}
        {isLoadingSubjects && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center text-gray-500 dark:text-gray-400">
            Loading subjects...
          </div>
        )}

        {!isLoadingSubjects && subjects.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Created subjects
            </h3>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {subjects.map((subject) => (
                    <Fragment key={subject.id}>
                      <tr>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          <button
                            type="button"
                            onClick={() => toggleSubject(subject.id)}
                            className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                          >
                            {subject.id.substring(0, 8)}...
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          <button
                            type="button"
                            onClick={() => toggleSubject(subject.id)}
                            className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                          >
                            {subject.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                          <div className="flex items-center justify-between gap-3">
                            <span>{subject.description}</span>
                              <button
                              type="button"
                              onClick={() => toggleSubject(subject.id)}
                              className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                            >
                              Details
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-500 dark:text-gray-400">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleUpdateSubject(subject)}
                              className="px-3 py-1 text-xs rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(subject)}
                              className="px-3 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedSubjectId === subject.id && (
                        <tr>
                          <td colSpan={4} className="px-6 py-4 bg-gray-50 dark:bg-gray-900/30">
                            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                              Subject ID: <span className="text-gray-800 dark:text-gray-200">{subject.id}</span>
                            </div>
                            {subject.exams.length === 0 ? (
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                No exams for this subject
                              </div>
                            ) : (
                              <ul className="space-y-2">
                                {subject.exams.map((exam) => {
                                  
                                  const taskCount = exam.taskCount || 0;
                                  const hasTasks = taskCount > 0;
                                  const status = exam.status || 'waiting_start';

                                  return (
                                    <Fragment key={exam.id}>
                                      <li
                                        className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 p-3 rounded shadow-sm"
                                      >
                                        <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold">{exam.name}</span>
                                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            status === 'active'
                                              ? 'bg-green-100 text-green-700'
                                              : status === 'paused'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : status === 'completed'
                                                  ? 'bg-gray-200 text-gray-600'
                                                  : 'bg-blue-100 text-blue-700'
                                          }`}>
                                            {status === 'active' && 'Active'}
                                            {status === 'paused' && 'Paused'}
                                            {status === 'completed' && 'Completed'}
                                            {status === 'wait_room' && 'Not scheduled'}
                                            {status === 'waiting_start' && 'Waiting for professor'}
                                          </span>
                                        </div>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          ID: {exam.id} | Start: {new Date(exam.startTime).toLocaleString()} | Tasks: {taskCount}
                                        </span>
                                      </div>
                                      
                                      {/*SOCKET: Actions Buttons */}
                                      <div className="flex flex-wrap gap-2 justify-end">
                                        <button 
                                          onClick={() =>
                                            monitoredExams.has(exam.id)
                                              ? handleStopMonitorExam(exam.id)
                                              : handleMonitorExam(exam.id)
                                          }
                                          className={`px-3 py-1 text-xs rounded border ${
                                            monitoredExams.has(exam.id) 
                                              ? 'bg-yellow-100 text-yellow-700 border-yellow-300' 
                                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                          }`}
                                        >
                                          {monitoredExams.has(exam.id) ? 'Monitoring on' : 'Monitor'}
                                        </button>

                                        {(status === 'wait_room' || status === 'waiting_start') && (
                                          <button 
                                            onClick={() => handleStartExam(exam)}
                                            disabled={!hasTasks}
                                            className={`px-3 py-1 text-xs rounded ${
                                              hasTasks
                                                ? 'bg-green-600 text-white hover:bg-green-700'
                                                : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                            }`}
                                          >
                                            {hasTasks ? 'Start' : 'Add tasks first'}
                                          </button>
                                        )}

                                        {status === 'active' && (
                                          <button 
                                            onClick={() => handlePauseExam(exam)}
                                            className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
                                          >
                                            Pause
                                          </button>
                                        )}

                                        {status === 'paused' && (
                                          <button 
                                            onClick={() => handleResumeExam(exam)}
                                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                                          >
                                            Resume
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button 
                                            onClick={() => handleExtendExam(exam)}
                                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                          >
                                            Extend
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button 
                                            onClick={() => handleEndExam(exam)}
                                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                          >
                                            End
                                          </button>
                                        )}

                                        {status === 'completed' && (
                                          <button 
                                            onClick={() => handleRestartExam(exam)}
                                            disabled={!hasTasks}
                                            className={`px-3 py-1 text-xs rounded ${
                                              hasTasks
                                                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                            }`}
                                          >
                                            Restart
                                          </button>
                                        )}

                                        <button 
                                          onClick={() => handleUpdateExam(exam)}
                                          className="px-3 py-1 text-xs border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50"
                                        >
                                          Edit
                                        </button>

                                        <button 
                                          onClick={() => handleDeleteExam(exam)}
                                          className="px-3 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                                        >
                                          Delete
                                        </button>


                                        <button
                                          onClick={() => toggleTaskPanel(exam.id)}
                                          className="px-3 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                                        >
                                          Tasks
                                        </button>
                                      </div>
                                    </li>
                                    {taskExamId === exam.id && (
                                      <li className="bg-gray-50 dark:bg-gray-900/40 rounded p-3 border border-gray-200 dark:border-gray-700">
                                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                                          {editingTask ? 'Edit task' : 'New task'}
                                        </div>

                                        {taskError && (
                                          <div className="mb-3 text-xs text-red-600 dark:text-red-400">
                                            {taskError}
                                          </div>
                                        )}

                                        <form
                                          className="grid grid-cols-1 gap-3"
                                          onSubmit={(e) => handleSubmitTask(e, exam.id)}
                                        >
                                          <input
                                            name="title"
                                            value={taskForm.title}
                                            onChange={handleTaskInputChange}
                                            placeholder="Task title"
                                            required
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white"
                                          />
                                          <textarea
                                            name="description"
                                            value={taskForm.description}
                                            onChange={handleTaskInputChange}
                                            placeholder="Task description"
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white"
                                          />

                                          <textarea
                                            name="exampleInput"
                                            value={taskForm.exampleInput}
                                            onChange={handleTaskInputChange}
                                            placeholder="Example input"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white font-mono"
                                          />
                                          <textarea
                                            name="exampleOutput"
                                            value={taskForm.exampleOutput}
                                            onChange={handleTaskInputChange}
                                            placeholder="Example output"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white font-mono"
                                          />
                                          <textarea
                                            name="notes"
                                            value={taskForm.notes}
                                            onChange={handleTaskInputChange}
                                            placeholder="Notes"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white"
                                          />
                                          <textarea
                                            name="starterCode"
                                            value={taskForm.starterCode}
                                            onChange={handleTaskInputChange}
                                            placeholder="Starter code"
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white font-mono"
                                          />
                                          <textarea
                                            name="testCases"
                                            value={taskForm.testCases}
                                            onChange={handleTaskInputChange}
                                            placeholder='Test cases JSON (npr. [{"input":"1","output":"2"}])'
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white font-mono"
                                          />
                                          <input
                                            type="file"
                                            accept="application/pdf"
                                            onChange={handleTaskFileChange}
                                            className="text-sm text-gray-600 dark:text-gray-300"
                                          />
                                          <div className="flex gap-2">
                                            <button
                                              type="submit"
                                              className="px-3 py-2 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                            >
                                              {editingTask ? 'Save changes' : 'Add task'}
                                            </button>
                                            {editingTask && (
                                              <button
                                                type="button"
                                                onClick={resetTaskForm}
                                                className="px-3 py-2 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-100"
                                              >
                                                Cancel
                                              </button>
                                            )}
                                          </div>
                                        </form>

                                        <div className="mt-4">
                                          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                                            Existing tasks
                                          </div>
                                          {isLoadingTasks ? (
                                            <div className="text-xs text-gray-500">Loading...</div>
                                          ) : (
                                            <div className="space-y-2">
                                              {(tasksByExam[exam.id] || []).length === 0 && (
                                                <div className="text-xs text-gray-500">No tasks.</div>
                                              )}
                                              {(tasksByExam[exam.id] || []).map((task) => (
                                                <div
                                                  key={task.id}
                                                  className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-xs"
                                                >
                                                  <div className="flex flex-col">
                                                    <span className="font-semibold text-gray-700 dark:text-gray-200">
                                                      {task.title}
                                                    </span>
                                                    {task.pdfUrl && (
                                                      <a
                                                        href={task.pdfUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-indigo-600 hover:text-indigo-500"
                                                      >
                                                        Task PDF
                                                      </a>
                                                    )}
                                                  </div>
                                                  <div className="flex gap-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => handleEditTask(task)}
                                                      className="px-2 py-1 text-xs border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50"
                                                    >
                                                      Edit
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleDeleteTask(exam.id, task)}
                                                      className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                                                    >
                                                      Delete
                                                    </button>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </li>
                                    )}
                                    </Fragment>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
