import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api, { gradeApi } from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam, Grade } from '../types';

interface AvailableExam {
  id: string;
  name: string;
  subjectName: string;
  startTime: string;
  durationMinutes: number;
  status: 'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed' | 'withdrawn' | 'submitted';
  grade?: Grade | null;
}

interface StudentSubject {
  id: string;
  name: string;
  description: string;
  exams: AvailableExam[];
}

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [subjects, setSubjects] = useState<StudentSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [enrollPassword, setEnrollPassword] = useState('');
  const [enrollMessage, setEnrollMessage] = useState('');
  const [enrollError, setEnrollError] = useState('');
  const [hasUpdates, setHasUpdates] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const isMountedRef = useRef(true);
  const loadStartedAtRef = useRef<number | null>(null);
  const lastUpdateAtRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef<number>(0);

  const allExams = useMemo(
    () => subjects.flatMap((subject) => subject.exams || []),
    [subjects]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSubjects = useCallback(async () => {
    const startedAt = Date.now();
    loadStartedAtRef.current = startedAt;
    setIsLoading(true);
    setError('');
    try {
      const response = await api.get<StudentSubject[]>('/exams/subjects/enrolled');
      const mapped = response.data.map((subject) => ({
        ...subject,
        exams: (subject.exams || []).map((exam) => ({
          id: exam.id,
          name: exam.name,
          subjectName: exam.subjectName || subject.name || 'Unknown subject',
          startTime: exam.startTime,
          durationMinutes: exam.durationMinutes,
          status: exam.status || 'waiting_start',
          grade: null as Grade | null,
        }))
      }));

      const submittedExams = mapped.flatMap(s => s.exams).filter(e => e.status === 'submitted');
      const gradePromises = submittedExams.map(async (exam) => {
        try {
          const gradeRes = await gradeApi.getGrade(exam.id, user?.id || '');
          return { examId: exam.id, grade: gradeRes.data };
        } catch {
          return { examId: exam.id, grade: null };
        }
      });
      const grades = await Promise.all(gradePromises);
      const gradeMap = new Map(grades.map(g => [g.examId, g.grade]));

      const mappedWithGrades = mapped.map(subject => ({
        ...subject,
        exams: subject.exams.map(exam => ({
          ...exam,
          grade: gradeMap.get(exam.id) || null
        }))
      }));

      if (isMountedRef.current) {
        setSubjects(mappedWithGrades);
        lastRefreshAtRef.current = Date.now();
        const lastUpdate = lastUpdateAtRef.current ?? 0;
        if (lastUpdate <= startedAt) {
          setHasUpdates(false);
          setLastUpdateAt(null);
          lastUpdateAtRef.current = null;
        }
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.response?.data?.error || 'Failed to load subjects');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (!user) return;

    connectSocket();
    const handleExamChanged = (payload: { examId: string; status: string; timestamp: number }) => {
      if (!payload?.examId) return;
      setHasUpdates(true);
      if (payload.timestamp) {
        setLastUpdateAt(payload.timestamp);
        lastUpdateAtRef.current = payload.timestamp;
      }
    };

    const handleChangesSnapshot = (payload: { lastChange: number | null }) => {
      if (!payload || !payload.lastChange) return;
      if (payload.lastChange > lastRefreshAtRef.current) {
        setHasUpdates(true);
        setLastUpdateAt(payload.lastChange);
        lastUpdateAtRef.current = payload.lastChange;
      }
    };

    socket.on('exam_changed', handleExamChanged);
    socket.on('changes_snapshot', handleChangesSnapshot);
    socket.emit('request_changes_snapshot');
    return () => {
      socket.off('exam_changed', handleExamChanged);
      socket.off('changes_snapshot', handleChangesSnapshot);
      disconnectSocket();
    };
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStartExam = (examId: string) => {
    navigate(`/exam/${examId}`);
  };

  const handleViewWork = (examId: string) => {
    navigate(`/exam/${examId}/review`);
  };

  const handleRefresh = async () => {
    await loadSubjects();
  };

  const handleEnroll = async () => {
    setEnrollError('');
    setEnrollMessage('');
    if (!enrollPassword.trim()) {
      setEnrollError('Please enter a subject password.');
      return;
    }
    try {
      await api.post('/exams/subjects/enroll', { password: enrollPassword.trim() });
      setEnrollPassword('');
      setEnrollMessage('Subject added. Refreshing list.');
      await loadSubjects();
    } catch (err: any) {
      setEnrollError(err.response?.data?.error || 'Failed to enroll in subject');
    }
  };

  const handleUnenroll = async (subjectId: string) => {
    if (!confirm('Are you sure you want to unenroll from this subject?')) return;
    try {
      await api.delete(`/exams/subjects/${subjectId}/unenroll`);
      await loadSubjects();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to unenroll');
    }
  };

  const getStatusBadge = (status: AvailableExam['status']) => {
    const styles: Record<string, string> = {
      wait_room: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      waiting_start: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      paused: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      completed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
      submitted: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      withdrawn: 'bg-zinc-500/10 text-zinc-500 border-zinc-600/20',
    };
    const labels: Record<string, string> = {
      wait_room: 'Inactive (scheduled)',
      waiting_start: 'Waiting to start',
      active: 'Active',
      paused: 'Paused',
      completed: 'Completed',
      submitted: 'Submitted',
      withdrawn: 'Withdrawn',
    };
    return (
      <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-800/80 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              Assessly
            </h1>
            <div className="hidden sm:block h-5 w-px bg-zinc-700" />
            <p className="hidden sm:block text-sm text-zinc-500">
              Student Dashboard
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-zinc-300">
                {user?.firstName} {user?.lastName}
              </span>
            </div>
            <Link
              to="/change-password"
              className="px-3 py-2 text-sm font-medium text-zinc-400 bg-zinc-800/50 border border-zinc-700/50 rounded-xl hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
            >
              Password
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-2 text-sm font-medium text-zinc-300 bg-zinc-800/50 border border-zinc-700/50 rounded-xl hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Updates banner */}
        {hasUpdates && (
          <div className="mb-6 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-indigo-300">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Updates available. Refresh to see the latest exam changes.
                {lastUpdateAt ? (
                  <span className="ml-2 text-xs text-indigo-400/60">
                    Last change: {new Date(lastUpdateAt).toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </div>
              <button
                onClick={handleRefresh}
                className="px-3 py-1.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/10 cursor-pointer"
              >
                Refresh now
              </button>
            </div>
          </div>
        )}

        {/* Welcome banner */}
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 rounded-2xl shadow-xl shadow-indigo-500/10 p-8 mb-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyem0wLTRWMjhIMjR2Mmgxem0tOCA2djJoLTJ2LTJoMnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-30" />
          <div className="relative">
            <h2 className="text-2xl font-bold mb-1">
              Welcome back, {user?.firstName}
            </h2>
            <p className="text-indigo-200/80 text-sm">
              Manage your subjects and access available exams.
            </p>
          </div>
        </div>

        {/* Enroll section */}
        <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-800/80 p-6 mb-8">
          <h3 className="text-base font-semibold text-zinc-100 mb-1">
            Add a subject
          </h3>
          <p className="text-sm text-zinc-500 mb-4">
            Enter the subject password given by your professor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={enrollPassword}
              onChange={(e) => setEnrollPassword(e.target.value)}
              placeholder="Subject password"
              className="flex-1 px-4 py-2.5 border border-zinc-800 rounded-xl bg-zinc-950/50 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 text-sm"
            />
            <button
              onClick={handleEnroll}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 cursor-pointer"
            >
              Add subject
            </button>
          </div>
          {enrollMessage && (
            <div className="mt-3 text-sm text-emerald-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {enrollMessage}
            </div>
          )}
          {enrollError && (
            <div className="mt-3 text-sm text-red-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {enrollError}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-800/80 p-5 hover:border-zinc-700/80 transition-colors">
            <div className="flex items-center">
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl">
                <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Upcoming</p>
                <p className="text-2xl font-bold text-zinc-100 mt-0.5">
                  {allExams.filter(e => e.status === 'wait_room' || e.status === 'waiting_start').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-800/80 p-5 hover:border-zinc-700/80 transition-colors">
            <div className="flex items-center">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Active</p>
                <p className="text-2xl font-bold text-zinc-100 mt-0.5">
                  {allExams.filter(e => e.status === 'active' || e.status === 'paused').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-800/80 p-5 hover:border-zinc-700/80 transition-colors">
            <div className="flex items-center">
              <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Finished</p>
                <p className="text-2xl font-bold text-zinc-100 mt-0.5">
                  {allExams.filter(e => e.status === 'completed' || e.status === 'withdrawn' || e.status === 'submitted').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="p-12 text-center">
            <svg className="animate-spin h-8 w-8 text-indigo-400 mx-auto mb-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-zinc-500">Loading subjects...</p>
          </div>
        )}

        {/* Error */}
        {!isLoading && error && (
          <div className="p-6 text-center text-red-400">{error}</div>
        )}

        {/* Empty state */}
        {!isLoading && !error && subjects.length === 0 ? (
          <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800/80 p-12 text-center">
            <svg className="w-12 h-12 text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-zinc-400">You are not enrolled in any subjects.</p>
            <p className="text-sm text-zinc-600 mt-1">Use the form above to add your first subject.</p>
          </div>
        ) : null}

        {/* Subject list */}
        {!isLoading && !error && subjects.length > 0 ? (
          <div className="space-y-6">
            {subjects.map((subject) => (
              <div key={subject.id} className="bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-800/80 overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100">
                      {subject.name}
                    </h3>
                    <p className="text-sm text-zinc-500">
                      {subject.description || 'No description'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnenroll(subject.id)}
                    className="px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 cursor-pointer"
                  >
                    Unenroll
                  </button>
                </div>

                {subject.exams.length === 0 ? (
                  <div className="p-8 text-center text-zinc-600 text-sm">
                    No exams for this subject yet.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/40">
                    {subject.exams.map((exam) => (
                      <div
                        key={exam.id}
                        className="p-6 hover:bg-zinc-800/20 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <h4 className="text-base font-medium text-zinc-100">
                                {exam.name}
                              </h4>
                              {getStatusBadge(exam.status)}
                              {exam.grade && (
                                <span
                                  className={`px-2.5 py-1 text-xs font-bold rounded-full border ${
                                    exam.grade.value === 5
                                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  }`}
                                >
                                  {exam.grade.value === 5 ? 'Ispit pao' : `Grade: ${exam.grade.value}`}
                                </span>
                              )}
                            </div>
                            {exam.grade?.comment && (
                              <div className="mt-1.5 text-sm text-zinc-500 italic">
                                "{exam.grade.comment}"
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
                              <span className="flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {formatDateTime(exam.startTime)}
                              </span>
                              <span className="flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1.5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {exam.durationMinutes} min
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            {exam.status === 'active' && (
                              <button
                                onClick={() => handleStartExam(exam.id)}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 rounded-xl hover:from-indigo-400 hover:to-violet-500 shadow-sm shadow-indigo-500/20 cursor-pointer"
                              >
                                Start exam
                              </button>
                            )}
                            {exam.status === 'wait_room' && (
                              <button
                                disabled
                                className="px-5 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-800/50 border border-zinc-700/50 rounded-xl cursor-not-allowed"
                              >
                                Inactive
                              </button>
                            )}
                            {exam.status === 'waiting_start' && (
                              <button
                                disabled
                                className="px-5 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-800/50 border border-zinc-700/50 rounded-xl cursor-not-allowed"
                              >
                                Waiting to start
                              </button>
                            )}
                            {exam.status === 'paused' && (
                              <button
                                disabled
                                className="px-5 py-2.5 text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl cursor-not-allowed"
                              >
                                Paused
                              </button>
                            )}
                            {(exam.status === 'completed' || exam.status === 'submitted') && (
                              <button
                                onClick={() => handleViewWork(exam.id)}
                                className="px-5 py-2.5 text-sm font-semibold text-indigo-400 border border-indigo-500/30 rounded-xl hover:bg-indigo-500/10 cursor-pointer"
                              >
                                View your work
                              </button>
                            )}
                            {exam.status === 'withdrawn' && (
                              <button
                                disabled
                                className="px-5 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-800/50 border border-zinc-700/50 rounded-xl cursor-not-allowed"
                              >
                                Withdrawn
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
