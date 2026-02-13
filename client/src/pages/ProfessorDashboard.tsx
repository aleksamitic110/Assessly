import { Fragment, useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam as ExamType, Task as TaskType } from '../types';
import ExamChatPanel from '../components/ExamChatPanel';

interface Subject {
  id: string;
  name: string;
  description: string;
  createdBy?: string | null;
  isCreator?: boolean;
}

interface ProfessorExam extends ExamType {
  taskCount?: number;
}

interface SubjectWithExams extends Subject {
  exams: ProfessorExam[];
}

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

  const toIsoString = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString();
  };

  const toDateTimeLocal = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [subjectData, setSubjectData] = useState({ name: '', description: '', password: '' });

  const [showExamForm, setShowExamForm] = useState(false);
  const [examData, setExamData] = useState({
    name: '',
    startTime: '',
    durationMinutes: 60,
    subjectId: '',
  });

  const [subjects, setSubjects] = useState<SubjectWithExams[]>([]);
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);
  const [addProfessorEmail, setAddProfessorEmail] = useState<Record<string, string>>({});

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [monitoredExams, setMonitoredExams] = useState<Set<string>>(new Set());
  const [chatExamId, setChatExamId] = useState<string | null>(null);
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
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [subjectEditForm, setSubjectEditForm] = useState({
    name: '',
    description: '',
    password: '',
    invalidateEnrollments: false,
  });
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examEditForm, setExamEditForm] = useState({
    name: '',
    startTime: '',
    durationMinutes: 60,
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

  useEffect(() => {
    connectSocket();

    socket.on('violation_alert', (data: Alert) => {
      setLiveAlerts((prev) => [data, ...prev]);
      new Audio('/alert.mp3').play().catch(() => {});
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
      }
    });

    return () => {
      socket.off('violation_alert');
      socket.off('exam_state');
      socket.off('exam_start_error');
      disconnectSocket();
    };
  }, []);

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

  const startEditSubject = (subject: SubjectWithExams) => {
    setEditingSubjectId(subject.id);
    setSubjectEditForm({
      name: subject.name || '',
      description: subject.description || '',
      password: '',
      invalidateEnrollments: false,
    });
  };

  const cancelEditSubject = () => {
    setEditingSubjectId(null);
    setSubjectEditForm({
      name: '',
      description: '',
      password: '',
      invalidateEnrollments: false,
    });
  };

  const handleSubjectEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const target = e.target as HTMLInputElement;
      setSubjectEditForm((prev) => ({ ...prev, [name]: target.checked }));
      return;
    }
    setSubjectEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveSubject = async (subjectId: string) => {
    setError('');
    setMessage('');
    try {
      const payload: any = {
        name: subjectEditForm.name,
        description: subjectEditForm.description,
      };
      if (subjectEditForm.password.trim()) {
        payload.password = subjectEditForm.password.trim();
        payload.invalidateEnrollments = subjectEditForm.invalidateEnrollments;
      }
      const response = await api.put(`/exams/subjects/${subjectId}`, payload);
      setSubjects((prev) =>
        prev.map((item) =>
          item.id === subjectId ? { ...item, ...response.data } : item
        )
      );
      setMessage(`Subject "${response.data.name}" updated.`);
      cancelEditSubject();
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

  const handleAddProfessor = async (subjectId: string) => {
    const email = (addProfessorEmail[subjectId] || '').trim().toLowerCase();
    if (!email) {
      setError('Enter a professor email.');
      return;
    }
    setError('');
    setMessage('');
    try {
      await api.post(`/exams/subjects/${subjectId}/professors`, { email });
      setMessage(`Professor "${email}" added to subject.`);
      setAddProfessorEmail((prev) => ({ ...prev, [subjectId]: '' }));
    } catch (err: any) {
      console.error('Add professor error:', err);
      setError(err.response?.data?.error || 'Error while adding professor to subject');
    }
  };

  const startEditExam = (exam: ExamType) => {
    setEditingExamId(exam.id);
    setExamEditForm({
      name: exam.name || '',
      startTime: exam.startTime ? toDateTimeLocal(exam.startTime) : '',
      durationMinutes: exam.durationMinutes || 60,
    });
  };

  const cancelEditExam = () => {
    setEditingExamId(null);
    setExamEditForm({
      name: '',
      startTime: '',
      durationMinutes: 60,
    });
  };

  const handleExamEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setExamEditForm((prev) => ({
      ...prev,
      [name]: name === 'durationMinutes' ? Number(value) : value,
    }));
  };

  const handleSaveExam = async (examId: string) => {
    setError('');
    setMessage('');
    const durationMinutes = Number(examEditForm.durationMinutes);
    if (!examEditForm.name.trim() || !examEditForm.startTime.trim() || !durationMinutes || durationMinutes <= 0) {
      setError('Please provide a valid name, start time, and duration.');
      return;
    }
    try {
      const response = await api.put(`/exams/exams/${examId}`, {
        name: examEditForm.name.trim(),
        startTime: toIsoString(examEditForm.startTime.trim()),
        durationMinutes,
      });
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.map((item) =>
            item.id === examId ? { ...item, ...response.data } : item
          ),
        }))
      );
      setMessage(`Exam "${response.data.name}" updated.`);
      cancelEditExam();
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

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const response = await api.post('/exams/exams', {
        ...examData,
        startTime: toIsoString(examData.startTime),
      });
      setMessage(`Exam "${response.data.name}" created. ID: ${response.data.id}`);
      const scheduledStart = new Date(toIsoString(examData.startTime)).getTime();
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
    <div className="min-h-screen bg-zinc-950">
      <header className="bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-800/80 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              Assessly
            </h1>
            <div className="h-5 w-px bg-zinc-700" />
            <p className="text-sm text-zinc-400">
              Professor Dashboard
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="flex items-center gap-2 text-sm text-zinc-300 bg-zinc-800/50 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {user?.firstName} {user?.lastName}
            </span>
            <Link
              to="/change-password"
              className="px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800/50 border border-zinc-700/50 rounded-xl hover:bg-zinc-800 transition-colors"
            >
              Change Password
            </Link>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-zinc-300 border border-zinc-700/50 rounded-xl hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 shadow-sm transition-all cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {message && (
          <div className="mb-6 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {message}
          </div>
        )}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl p-6 border border-zinc-800/80 hover:border-zinc-700/80 transition-colors ring-1 ring-white/5">
            <div className="flex items-center mb-4">
              <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-zinc-100">
                Subjects
              </h3>
            </div>
            <p className="text-zinc-400 text-sm mb-4">
              Create a new subject you teach
            </p>
            <button
              onClick={() => setShowSubjectForm(!showSubjectForm)}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
            >
              {showSubjectForm ? 'Close' : 'Create subject'}
            </button>

            {showSubjectForm && (
              <form onSubmit={handleCreateSubject} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Subject name"
                    value={subjectData.name}
                    onChange={(e) => setSubjectData({ ...subjectData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <div>
                  <textarea
                    placeholder="Subject description"
                    value={subjectData.description}
                    onChange={(e) => setSubjectData({ ...subjectData, description: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <div>
                  <input
                    type="password"
                    placeholder="Subject password"
                    value={subjectData.password}
                    onChange={(e) => setSubjectData({ ...subjectData, password: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
                >
                  Save subject
                </button>
              </form>
            )}
          </div>

          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl p-6 border border-zinc-800/80 hover:border-zinc-700/80 transition-colors ring-1 ring-white/5">
            <div className="flex items-center mb-4">
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl">
                <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-zinc-100">
                Exams
              </h3>
            </div>
            <p className="text-zinc-400 text-sm mb-4">
              Create a new exam for students
            </p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-sky-500/80 rounded-xl hover:bg-sky-500 shadow-sm shadow-sky-500/20 transition-all cursor-pointer"
            >
              {showExamForm ? 'Close' : 'Create exam'}
            </button>

            {showExamForm && (
              <form onSubmit={handleCreateExam} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Exam name"
                    value={examData.name}
                    onChange={(e) => setExamData({ ...examData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Start time
                  </label>
                  <input
                    type="datetime-local"
                    value={examData.startTime}
                    onChange={(e) => setExamData({ ...examData, startTime: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={examData.durationMinutes}
                    onChange={(e) => setExamData({ ...examData, durationMinutes: parseInt(e.target.value) })}
                    min={1}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Subject
                  </label>
                  <select
                    value={examData.subjectId}
                    onChange={(e) => setExamData({ ...examData, subjectId: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
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
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
                >
                  Save exam
                </button>
              </form>
            )}
          </div>

          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl p-6 border border-zinc-800/80 flex flex-col h-96 ring-1 ring-white/5">
            <div className="flex items-center mb-4">
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl animate-pulse">
                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-zinc-100">
                Live Alerts ({liveAlerts.length})
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto bg-zinc-950 rounded-xl p-2 border border-zinc-800/80">
              {liveAlerts.length === 0 ? (
                <p className="text-center text-zinc-500 mt-10">No active alerts.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(alertsByExam)
                    .sort((a, b) => {
                      const aLatest = a[1][0]?.timestamp || 0;
                      const bLatest = b[1][0]?.timestamp || 0;
                      return bLatest - aLatest;
                    })
                    .map(([examId, alerts]) => (
                      <div key={examId} className="rounded-xl border border-zinc-800/80 bg-zinc-900/60">
                        <div className="px-3 py-2 text-xs font-semibold text-zinc-300 border-b border-zinc-800/80">
                          {examNameById[examId] || `Exam ${examId.substring(0, 8)}...`}
                        </div>
                        <div className="p-2 space-y-2">
                          {alerts.map((alert, idx) => (
                            <div key={`${alert.studentId}-${idx}`} className="p-2 bg-red-500/10 border-l-4 border-red-500 rounded text-sm">
                              <div className="flex justify-between font-bold text-red-400">
                                <span>{alert.email}</span>
                                <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <div className="text-zinc-400">
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
              className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 text-right cursor-pointer"
            >
              Clear logs
            </button>
          </div>
        </div>

        {isLoadingSubjects && (
          <div className="mt-8 bg-zinc-900/60 backdrop-blur-sm rounded-2xl p-6 text-center text-zinc-400 border border-zinc-800/80">
            <div className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading subjects...
            </div>
          </div>
        )}

        {!isLoadingSubjects && subjects.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">
              Created subjects
            </h3>
            <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl overflow-hidden border border-zinc-800/80 ring-1 ring-white/5">
              <table className="min-w-full divide-y divide-zinc-800/80">
                <thead className="bg-zinc-950/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {subjects.map((subject) => (
                    <Fragment key={subject.id}>
                      <tr>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">
                          <button
                            type="button"
                            onClick={() => toggleSubject(subject.id)}
                            className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                          >
                            {subject.id.substring(0, 8)}...
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-100">
                          <button
                            type="button"
                            onClick={() => toggleSubject(subject.id)}
                            className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                          >
                            {subject.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400">
                          <div className="flex items-center justify-between gap-3">
                            <span>{subject.description}</span>
                              <button
                              type="button"
                              onClick={() => toggleSubject(subject.id)}
                              className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                            >
                              Details
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-zinc-400">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                editingSubjectId === subject.id
                                  ? cancelEditSubject()
                                  : startEditSubject(subject)
                              }
                              className="px-3 py-1.5 text-xs rounded-lg border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10 cursor-pointer"
                            >
                              {editingSubjectId === subject.id ? 'Close edit' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(subject)}
                              className="px-3 py-1.5 text-xs rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingSubjectId === subject.id && (
                        <tr>
                          <td colSpan={4} className="px-6 py-4 bg-indigo-500/5">
                            <div className="text-sm font-semibold text-indigo-400 mb-3">
                              Edit subject
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <input
                                name="name"
                                value={subjectEditForm.name}
                                onChange={handleSubjectEditChange}
                                placeholder="Subject name"
                                className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                              />
                              <input
                                name="description"
                                value={subjectEditForm.description}
                                onChange={handleSubjectEditChange}
                                placeholder="Subject description"
                                className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                              />
                              <input
                                name="password"
                                type="password"
                                value={subjectEditForm.password}
                                onChange={handleSubjectEditChange}
                                placeholder="New subject password (optional)"
                                className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                              />
                              <label className="flex items-center gap-2 text-sm text-zinc-300">
                                <input
                                  type="checkbox"
                                  name="invalidateEnrollments"
                                  checked={subjectEditForm.invalidateEnrollments}
                                  onChange={handleSubjectEditChange}
                                  disabled={!subjectEditForm.password.trim()}
                                />
                                Invalidate current enrollments
                              </label>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveSubject(subject.id)}
                                className="px-4 py-2 text-xs text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 cursor-pointer"
                              >
                                Save subject
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditSubject}
                                className="px-4 py-2 text-xs border border-zinc-700/50 text-zinc-400 rounded-xl hover:bg-zinc-800 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {expandedSubjectId === subject.id && (
                        <tr>
                          <td colSpan={4} className="px-6 py-4 bg-zinc-950/80">
                            <div className="text-sm text-zinc-400 mb-3">
                              Subject ID: <span className="text-zinc-200">{subject.id}</span>
                            </div>
                            {subject.isCreator && (
                              <div className="mb-4">
                                <label className="block text-sm text-zinc-400 mb-1">
                                  Add professor to this subject
                                </label>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="email"
                                    placeholder="Professor email"
                                    value={addProfessorEmail[subject.id] || ''}
                                    onChange={(e) =>
                                      setAddProfessorEmail((prev) => ({ ...prev, [subject.id]: e.target.value }))
                                    }
                                    className="w-full px-3 py-2 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAddProfessor(subject.id)}
                                    className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
                                  >
                                    Add
                                  </button>
                                </div>
                                <p className="text-xs text-zinc-500 mt-2">
                                  Only the subject creator can add other professors.
                                </p>
                              </div>
                            )}
                            {subject.exams.length === 0 ? (
                              <div className="text-sm text-zinc-500">
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
                                        className="flex items-center justify-between text-sm text-zinc-300 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800/80 hover:border-zinc-700/80 transition-colors"
                                      >
                                        <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-zinc-100">{exam.name}</span>
                                          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                                            status === 'active'
                                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                              : status === 'paused'
                                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                                : status === 'completed'
                                                  ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                                                  : status === 'wait_room'
                                                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                                    : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                          }`}>
                                            {status === 'active' && 'Active'}
                                            {status === 'paused' && 'Paused'}
                                            {status === 'completed' && 'Completed'}
                                            {status === 'wait_room' && 'Inactive (scheduled)'}
                                            {status === 'waiting_start' && 'Waiting to start'}
                                          </span>
                                        </div>
                                        <span className="text-xs text-zinc-500">
                                          ID: {exam.id} | Start: {new Date(exam.startTime).toLocaleString()} | Tasks: {taskCount}
                                        </span>
                                      </div>

                                      <div className="flex flex-wrap gap-2 justify-end">
                                        <button
                                          onClick={() =>
                                            monitoredExams.has(exam.id)
                                              ? handleStopMonitorExam(exam.id)
                                              : handleMonitorExam(exam.id)
                                          }
                                          className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                                            monitoredExams.has(exam.id)
                                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                              : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800'
                                          }`}
                                        >
                                          {monitoredExams.has(exam.id) ? 'Monitoring on' : 'Monitor'}
                                        </button>

                                        {(status === 'active' || status === 'waiting_start') && (
                                          <button
                                            onClick={() => setChatExamId(chatExamId === exam.id ? null : exam.id)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                                              chatExamId === exam.id
                                                ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                                : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800'
                                            }`}
                                          >
                                            {chatExamId === exam.id ? 'Close Chat' : 'Chat'}
                                          </button>
                                        )}

                                        {(status === 'wait_room' || status === 'waiting_start') && (
                                          <button
                                            onClick={() => handleStartExam(exam)}
                                            disabled={!hasTasks}
                                            className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                                              hasTasks
                                                ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20'
                                                : 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                                            }`}
                                          >
                                            {hasTasks ? 'Start' : 'Add tasks first'}
                                          </button>
                                        )}

                                        {status === 'active' && (
                                          <button
                                            onClick={() => handlePauseExam(exam)}
                                            className="px-3 py-1.5 text-xs text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/10 cursor-pointer"
                                          >
                                            Pause
                                          </button>
                                        )}

                                        {status === 'paused' && (
                                          <button
                                            onClick={() => handleResumeExam(exam)}
                                            className="px-3 py-1.5 text-xs text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/10 cursor-pointer"
                                          >
                                            Resume
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button
                                            onClick={() => handleExtendExam(exam)}
                                            className="px-3 py-1.5 text-xs text-sky-400 border border-sky-500/20 rounded-lg hover:bg-sky-500/10 cursor-pointer"
                                          >
                                            Extend
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button
                                            onClick={() => handleEndExam(exam)}
                                            className="px-3 py-1.5 text-xs text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 cursor-pointer"
                                          >
                                            End
                                          </button>
                                        )}

                                        {status === 'completed' && (
                                          <button
                                            onClick={() => handleRestartExam(exam)}
                                            disabled={!hasTasks}
                                            className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer ${
                                              hasTasks
                                                ? 'text-violet-400 border border-violet-500/20 hover:bg-violet-500/10'
                                                : 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                                            }`}
                                          >
                                            Restart
                                          </button>
                                        )}

                                        <button
                                          onClick={() =>
                                            editingExamId === exam.id
                                              ? cancelEditExam()
                                              : startEditExam(exam)
                                          }
                                          className="px-3 py-1.5 text-xs border border-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/10 cursor-pointer"
                                        >
                                          {editingExamId === exam.id ? 'Close edit' : 'Edit'}
                                        </button>

                                        <button
                                          onClick={() => handleDeleteExam(exam)}
                                          className="px-3 py-1.5 text-xs border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
                                        >
                                          Delete
                                        </button>


                                        <button
                                          onClick={() => toggleTaskPanel(exam.id)}
                                          className="px-3 py-1.5 text-xs border border-zinc-700/50 text-zinc-400 rounded-lg hover:bg-zinc-800 cursor-pointer"
                                        >
                                          Tasks
                                        </button>

                                        <button
                                          onClick={() => navigate(`/professor/exam/${exam.id}/review`)}
                                          className="px-3 py-1.5 text-xs text-violet-400 border border-violet-500/20 rounded-lg hover:bg-violet-500/10 cursor-pointer"
                                        >
                                          Review
                                        </button>
                                      </div>
                                    </li>
                                    {editingExamId === exam.id && (
                                      <li className="bg-indigo-500/5 rounded-xl p-3 border border-indigo-500/20">
                                        <div className="text-sm font-semibold text-indigo-400 mb-3">
                                          Edit exam
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                          <input
                                            name="name"
                                            value={examEditForm.name}
                                            onChange={handleExamEditChange}
                                            placeholder="Exam name"
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <input
                                            name="startTime"
                                            type="datetime-local"
                                            value={examEditForm.startTime}
                                            onChange={handleExamEditChange}
                                            placeholder="Start time (YYYY-MM-DDTHH:mm)"
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <input
                                            name="durationMinutes"
                                            type="number"
                                            min="1"
                                            value={examEditForm.durationMinutes}
                                            onChange={handleExamEditChange}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleSaveExam(exam.id)}
                                            className="px-4 py-2 text-xs text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 cursor-pointer"
                                          >
                                            Save exam
                                          </button>
                                          <button
                                            type="button"
                                            onClick={cancelEditExam}
                                            className="px-4 py-2 text-xs border border-zinc-700/50 text-zinc-400 rounded-xl hover:bg-zinc-800 cursor-pointer"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </li>
                                    )}
                                    {taskExamId === exam.id && (
                                      <li className="bg-zinc-950/80 rounded-xl p-3 border border-zinc-800/80">
                                        <div className="text-sm font-semibold text-zinc-100 mb-3">
                                          {editingTask ? 'Edit task' : 'New task'}
                                        </div>

                                        {taskError && (
                                          <div className="mb-3 text-xs text-red-400">
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
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <textarea
                                            name="description"
                                            value={taskForm.description}
                                            onChange={handleTaskInputChange}
                                            placeholder="Task description"
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />

                                          <textarea
                                            name="exampleInput"
                                            value={taskForm.exampleInput}
                                            onChange={handleTaskInputChange}
                                            placeholder="Example input"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 font-mono focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <textarea
                                            name="exampleOutput"
                                            value={taskForm.exampleOutput}
                                            onChange={handleTaskInputChange}
                                            placeholder="Example output"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 font-mono focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <textarea
                                            name="notes"
                                            value={taskForm.notes}
                                            onChange={handleTaskInputChange}
                                            placeholder="Notes"
                                            rows={2}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <textarea
                                            name="starterCode"
                                            value={taskForm.starterCode}
                                            onChange={handleTaskInputChange}
                                            placeholder="Starter code"
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 font-mono focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <textarea
                                            name="testCases"
                                            value={taskForm.testCases}
                                            onChange={handleTaskInputChange}
                                            placeholder='Test cases JSON (npr. [{"input":"1","output":"2"}])'
                                            rows={3}
                                            className="w-full px-3 py-2 text-sm border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 font-mono focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 outline-none"
                                          />
                                          <input
                                            type="file"
                                            accept="application/pdf"
                                            onChange={handleTaskFileChange}
                                            className="text-sm text-zinc-400"
                                          />
                                          <div className="flex gap-2">
                                            <button
                                              type="submit"
                                              className="px-3 py-2 text-xs text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 cursor-pointer"
                                            >
                                              {editingTask ? 'Save changes' : 'Add task'}
                                            </button>
                                            {editingTask && (
                                              <button
                                                type="button"
                                                onClick={resetTaskForm}
                                                className="px-3 py-2 text-xs border border-zinc-700/50 text-zinc-400 rounded-xl hover:bg-zinc-800 cursor-pointer"
                                              >
                                                Cancel
                                              </button>
                                            )}
                                          </div>
                                        </form>

                                        <div className="mt-4">
                                          <div className="text-sm font-semibold text-zinc-100 mb-2">
                                            Existing tasks
                                          </div>
                                          {isLoadingTasks ? (
                                            <div className="text-xs text-zinc-500">Loading...</div>
                                          ) : (
                                            <div className="space-y-2">
                                              {(tasksByExam[exam.id] || []).length === 0 && (
                                                <div className="text-xs text-zinc-500">No tasks.</div>
                                              )}
                                              {(tasksByExam[exam.id] || []).map((task) => (
                                                <div
                                                  key={task.id}
                                                  className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs"
                                                >
                                                  <div className="flex flex-col">
                                                    <span className="font-semibold text-zinc-100">
                                                      {task.title}
                                                    </span>
                                                    {task.pdfUrl && (
                                                      <a
                                                        href={task.pdfUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-indigo-400 hover:text-indigo-300"
                                                      >
                                                        Task PDF
                                                      </a>
                                                    )}
                                                  </div>
                                                  <div className="flex gap-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => handleEditTask(task)}
                                                      className="px-2 py-1 text-xs border border-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/10 cursor-pointer"
                                                    >
                                                      Edit
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleDeleteTask(exam.id, task)}
                                                      className="px-2 py-1 text-xs border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 cursor-pointer"
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

      {chatExamId && (
        <ExamChatPanel examId={chatExamId} isProfessor={true} />
      )}
    </div>
  );
}
