import { Fragment, useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam as ExamType, Task as TaskType } from '../types';
import ExamChatPanel from '../components/ExamChatPanel';

// --- Types ---
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

interface Alert {
  studentId: string;
  email: string;
  type: string;
  count: number;
  timestamp: number;
  examId: string;
}

// --- Icons ---
const Icons = {
  Plus: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>,
  Subject: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
  Exam: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  Alert: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  Trash: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
  Edit: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  Monitor: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>,
  Play: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Pause: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Stop: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
};

export default function ProfessorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // --- Helpers ---
  const toIsoString = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString();
  };

  // --- State ---
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

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Socket & Live State
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [monitoredExams, setMonitoredExams] = useState<Set<string>>(new Set());
  const [chatExamId, setChatExamId] = useState<string | null>(null);
  const [taskExamId, setTaskExamId] = useState<string | null>(null); // For Tasks Modal
  const [tasksByExam, setTasksByExam] = useState<Record<string, TaskType[]>>({});
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [taskError, setTaskError] = useState('');
  
  // Task Form State
  const [editingTask, setEditingTask] = useState<TaskType | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: '', description: '', starterCode: '', testCases: '[]',
    exampleInput: '', exampleOutput: '', notes: '', pdfFile: null as File | null,
  });

  // --- Derived State ---
  const alertsByExam = useMemo(() => {
    return liveAlerts.reduce<Record<string, Alert[]>>((acc, alert) => {
      const key = alert.examId || 'unknown';
      if (!acc[key]) acc[key] = [];
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

  // --- Socket Effects ---
  useEffect(() => {
    connectSocket();
    socket.on('violation_alert', (data: Alert) => {
      setLiveAlerts((prev) => [data, ...prev]);
      new Audio('/alert.mp3').play().catch(() => {});
    });
    socket.on('student_status_update', (data) => console.log(`Status: ${data.email} -> ${data.status}`));
    
    socket.on('exam_state', (data: { examId: string; status: ExamType['status'] }) => {
      if (!data?.examId) return;
      if (['active', 'paused', 'completed'].includes(data.status)) {
        setSubjects((prev) => prev.map((s) => ({
          ...s,
          exams: s.exams.map((e) => e.id === data.examId ? { ...e, status: data.status } : e)
        })));
      }
    });

    socket.on('exam_start_error', (data) => {
      if (data.reason === 'NO_TASKS') setError('Cannot start exam. Add at least one task first.');
    });

    return () => {
      socket.off('violation_alert');
      socket.off('student_status_update');
      socket.off('exam_state');
      socket.off('exam_start_error');
      disconnectSocket();
    };
  }, []);

  // --- Data Loading ---
  useEffect(() => {
    let isMounted = true;
    const loadSubjects = async () => {
      setIsLoadingSubjects(true);
      try {
        const response = await api.get<SubjectWithExams[]>('/exams/subjects');
        if (isMounted) setSubjects(response.data);
      } catch (err: any) {
        if (isMounted) setError(err.response?.data?.error || 'Error while loading subjects');
      } finally {
        if (isMounted) setIsLoadingSubjects(false);
      }
    };
    loadSubjects();
    return () => { isMounted = false; };
  }, []);

  // --- Handlers (Subjects) ---
  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await api.post('/exams/subjects', subjectData);
      setSubjects((prev) => [...prev, { ...response.data, exams: [] }]);
      setSubjectData({ name: '', description: '', password: '' });
      setShowSubjectForm(false);
      setMessage(`Subject "${response.data.name}" created.`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error creating subject');
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await api.post('/exams/exams', { ...examData, startTime: toIsoString(examData.startTime) });
      const scheduledStart = new Date(toIsoString(examData.startTime)).getTime();
      const initialStatus = scheduledStart > Date.now() ? 'wait_room' : 'waiting_start';
      
      setSubjects((prev) => prev.map((s) => 
        s.id === examData.subjectId ? { ...s, exams: [...s.exams, { ...response.data, status: initialStatus }] } : s
      ));
      setExamData({ name: '', startTime: '', durationMinutes: 60, subjectId: '' });
      setShowExamForm(false);
      setMessage(`Exam "${response.data.name}" created.`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error creating exam');
    }
  };

  const handleDeleteSubject = async (subject: SubjectWithExams) => {
    if (!confirm(`Delete subject "${subject.name}"?`)) return;
    try {
      await api.delete(`/exams/subjects/${subject.id}`);
      setSubjects((prev) => prev.filter((s) => s.id !== subject.id));
      setMessage(`Subject "${subject.name}" deleted.`);
    } catch (err) { setError('Error deleting subject'); }
  };

  // --- Handlers (Exams) ---
  const handleStartExam = (exam: ExamType) => {
    if (!(exam as ProfessorExam).taskCount) return setError('Add tasks first.');
    if (!confirm(`Start "${exam.name}"?`)) return;
    handleMonitorExam(exam.id);
    socket.emit('start_exam', { examId: exam.id, durationMinutes: exam.durationMinutes });
  };

  const handleEndExam = (exam: ExamType) => {
    if (!confirm(`End "${exam.name}"?`)) return;
    socket.emit('end_exam', { examId: exam.id });
  };

  const handleMonitorExam = (examId: string) => {
    socket.emit('join_exam', examId);
    setMonitoredExams((prev) => new Set(prev).add(examId));
  };

  const handleStopMonitorExam = (examId: string) => {
    socket.emit('leave_exam', examId);
    setMonitoredExams((prev) => {
      const next = new Set(prev);
      next.delete(examId);
      return next;
    });
  };

  const handleDeleteExam = async (exam: ExamType) => {
    if (!confirm(`Delete exam "${exam.name}"?`)) return;
    try {
      await api.delete(`/exams/exams/${exam.id}`);
      setSubjects((prev) => prev.map((s) => ({ ...s, exams: s.exams.filter((e) => e.id !== exam.id) })));
      setMessage('Exam deleted.');
    } catch { setError('Error deleting exam'); }
  };

  // --- Task Handlers (RESTORED) ---
  const resetTaskForm = () => {
    setTaskForm({
      title: '', description: '', starterCode: '', testCases: '[]',
      exampleInput: '', exampleOutput: '', notes: '', pdfFile: null,
    });
    setEditingTask(null);
  };

  const toggleTaskPanel = async (examId: string) => {
    if (taskExamId === examId) {
      setTaskExamId(null);
      resetTaskForm();
      return;
    }
    setTaskExamId(examId);
    setIsLoadingTasks(true);
    try {
      const res = await api.get<TaskType[]>(`/exams/${examId}/tasks`);
      setTasksByExam((prev) => ({ ...prev, [examId]: res.data }));
    } catch { setTaskError('Failed to load tasks'); }
    finally { setIsLoadingTasks(false); }
  };

  const handleTaskInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
      title: task.title || '', description: task.description || '', starterCode: task.starterCode || '',
      testCases: task.testCases || '[]', exampleInput: task.exampleInput || '',
      exampleOutput: task.exampleOutput || '', notes: task.notes || '', pdfFile: null,
    });
  };

  const handleSubmitTask = async (e: React.FormEvent, examId: string) => {
    e.preventDefault();
    setTaskError('');
    try { JSON.parse(taskForm.testCases || '[]'); } catch { setTaskError('Test cases must be valid JSON.'); return; }

    const formData = new FormData();
    Object.entries(taskForm).forEach(([key, value]) => {
      if (key === 'pdfFile' && value) formData.append('pdf', value as File);
      else if (value !== null && key !== 'pdfFile') formData.append(key, value as string);
    });

    try {
      if (editingTask) {
        const response = await api.put(`/exams/tasks/${editingTask.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setTasksByExam((prev) => ({ ...prev, [examId]: prev[examId].map((t) => t.id === editingTask.id ? response.data : t) }));
        setMessage('Task updated.');
      } else {
        formData.append('examId', examId);
        const response = await api.post('/exams/tasks', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setTasksByExam((prev) => ({ ...prev, [examId]: [...(prev[examId] || []), response.data] }));
        setSubjects((prev) => prev.map((s) => ({ ...s, exams: s.exams.map((e) => e.id === examId ? { ...e, taskCount: (e.taskCount || 0) + 1 } : e) })));
        setMessage('Task added.');
      }
      resetTaskForm();
    } catch (err: any) { setTaskError(err.response?.data?.error || 'Error saving task'); }
  };

  const handleDeleteTask = async (examId: string, task: TaskType) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.delete(`/exams/tasks/${task.id}`);
      setTasksByExam((prev) => ({ ...prev, [examId]: prev[examId].filter((t) => t.id !== task.id) }));
      setSubjects((prev) => prev.map((s) => ({ ...s, exams: s.exams.map((e) => e.id === examId ? { ...e, taskCount: Math.max(0, (e.taskCount || 0) - 1) } : e) })));
      setMessage('Task deleted.');
    } catch { setTaskError('Error deleting task'); }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 font-sans overflow-hidden">
      {/* Top Navbar */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 z-20">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                Assessly Professor
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{user?.firstName} {user?.lastName}</span>
              <button onClick={() => { logout(); navigate('/login'); }} className="text-sm font-medium text-red-600 hover:text-red-700">Sign out</button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Layout: 3 Columns */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT COLUMN: Actions */}
        <aside className="w-64 p-6 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 flex flex-col gap-4">
          <button 
            onClick={() => setShowSubjectForm(true)}
            className="flex flex-col items-center justify-center p-6 bg-indigo-50 dark:bg-indigo-900/20 border-2 border-dashed border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors group"
          >
            <div className="p-3 bg-indigo-100 dark:bg-indigo-800 rounded-full mb-3 group-hover:scale-110 transition-transform"><Icons.Subject /></div>
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">New Subject</span>
          </button>

          <button 
            onClick={() => setShowExamForm(true)}
            className="flex flex-col items-center justify-center p-6 bg-green-50 dark:bg-green-900/20 border-2 border-dashed border-green-200 dark:border-green-800 rounded-xl hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors group"
          >
            <div className="p-3 bg-green-100 dark:bg-green-800 rounded-full mb-3 group-hover:scale-110 transition-transform"><Icons.Exam /></div>
            <span className="font-semibold text-green-700 dark:text-green-300">New Exam</span>
          </button>
        </aside>

        {/* MIDDLE COLUMN: Content (Scrollable) */}
        <main className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900">
          {(message || error) && (
            <div className={`mb-4 px-4 py-3 rounded-lg border ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
              {message || error}
            </div>
          )}

          {isLoadingSubjects ? (
            <div className="text-center py-10 text-gray-500">Loading...</div>
          ) : subjects.length === 0 ? (
            <div className="text-center py-10 text-gray-500">No subjects created yet.</div>
          ) : (
            <div className="space-y-6">
              {subjects.map((subject) => (
                <div key={subject.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {/* Subject Header */}
                  <div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center cursor-pointer" onClick={() => setExpandedSubjectId(expandedSubjectId === subject.id ? null : subject.id)}>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {subject.name}
                        <span className="text-xs font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{subject.exams.length} exams</span>
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{subject.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteSubject(subject); }} className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50"><Icons.Trash /></button>
                      <svg className={`w-5 h-5 text-gray-400 transform transition-transform ${expandedSubjectId === subject.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>

                  {/* Exams List */}
                  {expandedSubjectId === subject.id && (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {subject.exams.length === 0 && <div className="p-4 text-center text-sm text-gray-500">No exams in this subject.</div>}
                      {subject.exams.map((exam) => (
                        <div key={exam.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-900 dark:text-white">{exam.name}</span>
                                <StatusBadge status={exam.status} />
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {new Date(exam.startTime).toLocaleString()} • {exam.durationMinutes} min • {exam.taskCount || 0} tasks
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Monitor Button */}
                              <button 
                                onClick={() => monitoredExams.has(exam.id) ? handleStopMonitorExam(exam.id) : handleMonitorExam(exam.id)}
                                className={`p-1.5 rounded-lg border transition-colors ${monitoredExams.has(exam.id) ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' : 'bg-white border-gray-200 text-gray-500 hover:text-indigo-600'}`}
                                title="Monitor Exam"
                              >
                                <Icons.Monitor />
                              </button>
                              
                              {/* Edit/Delete */}
                              <button onClick={() => handleDeleteExam(exam)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Icons.Trash /></button>
                            </div>
                          </div>

                          {/* Action Bar */}
                          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                            <button onClick={() => toggleTaskPanel(exam.id)} className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50">Tasks</button>
                            
                            {(exam.status === 'wait_room' || exam.status === 'waiting_start') && (
                              <button onClick={() => handleStartExam(exam)} disabled={!exam.taskCount} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Start</button>
                            )}
                            
                            {exam.status === 'active' && (
                              <>
                                <button className="px-3 py-1.5 text-xs font-medium bg-yellow-500 text-white rounded hover:bg-yellow-600">Pause</button>
                                <button onClick={() => handleEndExam(exam)} className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700">End</button>
                              </>
                            )}

                            <button onClick={() => navigate(`/professor/exam/${exam.id}/review`)} className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded">Results</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>

        {/* RIGHT COLUMN: Live Alerts */}
        <aside className="w-80 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Icons.Alert /> Live Alerts
              <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">{liveAlerts.length}</span>
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {liveAlerts.length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-10">No active alerts</div>
            ) : (
              liveAlerts.map((alert, idx) => (
                <div key={idx} className="p-3 bg-red-50 border-l-4 border-red-500 rounded text-sm shadow-sm">
                  <div className="flex justify-between font-bold text-red-800">
                    <span>{alert.email.split('@')[0]}</span>
                    <span className="text-xs font-normal opacity-75">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-red-700 text-xs mt-1">
                    {alert.type} • {examNameById[alert.examId] || 'Unknown Exam'}
                  </div>
                </div>
              ))
            )}
          </div>
          {liveAlerts.length > 0 && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={() => setLiveAlerts([])} className="w-full py-2 text-sm text-gray-600 hover:bg-gray-100 rounded border border-gray-300">Clear Log</button>
            </div>
          )}
        </aside>
      </div>

      {/* --- MODALS --- */}
      {/* Create Subject Modal */}
      {showSubjectForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md m-4">
            <h2 className="text-xl font-bold mb-4 dark:text-white">New Subject</h2>
            <form onSubmit={handleCreateSubject} className="space-y-4">
              <input 
                placeholder="Name" 
                value={subjectData.name} 
                onChange={e => setSubjectData({...subjectData, name: e.target.value})} 
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                required 
              />
              <textarea 
                placeholder="Description" 
                value={subjectData.description} 
                onChange={e => setSubjectData({...subjectData, description: e.target.value})} 
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
              />
              <input 
                type="password"
                placeholder="Access Password" 
                value={subjectData.password} 
                onChange={e => setSubjectData({...subjectData, password: e.target.value})} 
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                required 
              />
              <div className="flex gap-3 justify-end mt-6">
                <button type="button" onClick={() => setShowSubjectForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Exam Modal */}
      {showExamForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md m-4">
            <h2 className="text-xl font-bold mb-4 dark:text-white">New Exam</h2>
            <form onSubmit={handleCreateExam} className="space-y-4">
              <input 
                placeholder="Exam Name" 
                value={examData.name} 
                onChange={e => setExamData({...examData, name: e.target.value})} 
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                required 
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start Time</label>
                  <input 
                    type="datetime-local" 
                    value={examData.startTime} 
                    onChange={e => setExamData({...examData, startTime: e.target.value})} 
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                    required 
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Duration (min)</label>
                  <input 
                    type="number" 
                    value={examData.durationMinutes} 
                    onChange={e => setExamData({...examData, durationMinutes: parseInt(e.target.value)})} 
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                    required 
                  />
                </div>
              </div>
              <select 
                value={examData.subjectId} 
                onChange={e => setExamData({...examData, subjectId: e.target.value})} 
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                required
              >
                <option value="" disabled>Select Subject</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="flex gap-3 justify-end mt-6">
                <button type="button" onClick={() => setShowExamForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Manager Modal */}
      {taskExamId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Manage Tasks</h2>
              <button onClick={() => setTaskExamId(null)} className="text-gray-500 hover:text-gray-700">Close</button>
            </div>
            
            {/* Task Form */}
            <form onSubmit={(e) => handleSubmitTask(e, taskExamId)} className="space-y-4 mb-8 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border dark:border-gray-700">
              <input name="title" value={taskForm.title} onChange={handleTaskInputChange} placeholder="Task Title" className="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:text-white" required />
              <textarea name="description" value={taskForm.description} onChange={handleTaskInputChange} placeholder="Description" rows={2} className="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:text-white" />
              <div className="grid grid-cols-2 gap-2">
                <textarea name="exampleInput" value={taskForm.exampleInput} onChange={handleTaskInputChange} placeholder="Example Input" className="w-full px-3 py-2 border rounded font-mono text-sm dark:bg-gray-700 dark:text-white" />
                <textarea name="exampleOutput" value={taskForm.exampleOutput} onChange={handleTaskInputChange} placeholder="Example Output" className="w-full px-3 py-2 border rounded font-mono text-sm dark:bg-gray-700 dark:text-white" />
              </div>
              <textarea name="starterCode" value={taskForm.starterCode} onChange={handleTaskInputChange} placeholder="Starter Code" rows={3} className="w-full px-3 py-2 border rounded font-mono text-sm dark:bg-gray-700 dark:text-white" />
              <textarea name="testCases" value={taskForm.testCases} onChange={handleTaskInputChange} placeholder='Test Cases JSON [{"input":"1","output":"2"}]' rows={2} className="w-full px-3 py-2 border rounded font-mono text-sm dark:bg-gray-700 dark:text-white" />
              <input type="file" accept="application/pdf" onChange={handleTaskFileChange} className="text-sm dark:text-gray-300" />
              
              <div className="flex justify-end gap-2">
                {editingTask && <button type="button" onClick={resetTaskForm} className="px-3 py-1.5 text-sm border rounded">Cancel Edit</button>}
                <button type="submit" className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">{editingTask ? 'Update Task' : 'Add Task'}</button>
              </div>
            </form>

            {/* Existing Tasks List */}
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Existing Tasks</h3>
              {isLoadingTasks ? <p>Loading...</p> : (tasksByExam[taskExamId] || []).length === 0 ? <p className="text-gray-500 text-sm">No tasks added yet.</p> : (
                (tasksByExam[taskExamId] || []).map(task => (
                  <div key={task.id} className="flex justify-between items-center p-3 bg-white dark:bg-gray-800 border rounded dark:border-gray-700">
                    <span className="font-medium dark:text-gray-200">{task.title}</span>
                    <div className="flex gap-2">
                      <button onClick={() => handleEditTask(task)} className="text-xs px-2 py-1 border rounded text-indigo-600 border-indigo-200 hover:bg-indigo-50">Edit</button>
                      <button onClick={() => handleDeleteTask(taskExamId, task)} className="text-xs px-2 py-1 border rounded text-red-600 border-red-200 hover:bg-red-50">Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {chatExamId && (
        <ExamChatPanel examId={chatExamId} isProfessor={true} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    wait_room: 'bg-gray-100 text-gray-600',
    waiting_start: 'bg-blue-100 text-blue-700',
    active: 'bg-green-100 text-green-700 animate-pulse',
    paused: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-purple-100 text-purple-700',
  }[status] || 'bg-gray-100';

  const labels = {
    wait_room: 'Scheduled',
    waiting_start: 'Ready',
    active: 'Active',
    paused: 'Paused',
    completed: 'Finished',
  }[status] || status;

  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles}`}>{labels}</span>;
}