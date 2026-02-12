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
    switch (status) {
      case 'wait_room':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-sky-900/40 text-sky-400 border border-sky-800/40">
            Inactive (scheduled)
          </span>
        );
      case 'waiting_start':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-violet-900/40 text-violet-400 border border-violet-800/40">
            Waiting to start
          </span>
        );
      case 'active':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">
            Active
          </span>
        );
      case 'paused':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
            Paused
          </span>
        );
      case 'completed':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-800/60 text-gray-400 border border-gray-700/40">
            Completed
          </span>
        );
      case 'submitted':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-violet-900/40 text-violet-400 border border-violet-800/40">
            Submitted
          </span>
        );
      case 'withdrawn':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-800/60 text-gray-500 border border-gray-700/40">
            Withdrawn
          </span>
        );
    }
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
    <div className="min-h-screen bg-[#0a0a12]">
      <header className="bg-[#13131f]/95 backdrop-blur-sm border-b border-[#2a2a3e] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Assessly
            </h1>
            <p className="text-sm text-gray-400">
              Student Dashboard
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-300 hidden sm:inline">
              {user?.firstName} {user?.lastName}
            </span>
            <Link
              to="/change-password"
              className="px-3 py-2 text-sm font-medium text-gray-300 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl hover:bg-[#252540] transition-colors"
            >
              Change Password
            </Link>
            <button
              onClick={handleLogout}
              className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-500 transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {hasUpdates && (
          <div className="mb-6 rounded-xl border border-sky-800/50 bg-sky-900/20 px-4 py-3 text-sky-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium flex items-center gap-2">
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Updates available. Refresh to see the latest exam changes.
                {lastUpdateAt ? (
                  <span className="ml-2 text-xs text-sky-300/80">
                    Last change: {new Date(lastUpdateAt).toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </div>
              <button
                onClick={handleRefresh}
                className="px-3 py-1.5 text-xs font-semibold text-sky-300 border border-sky-700 rounded-lg hover:bg-sky-900/40 transition-colors cursor-pointer"
              >
                Refresh now
              </button>
            </div>
          </div>
        )}
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 rounded-2xl shadow-lg shadow-emerald-500/20 p-8 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-2">
            Welcome, {user?.firstName}!
          </h2>
          <p className="opacity-80">
            Manage your subjects and access available exams.
          </p>
        </div>

        <div className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-1">
            Add a subject
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Enter the subject password given by your professor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={enrollPassword}
              onChange={(e) => setEnrollPassword(e.target.value)}
              placeholder="Subject password"
              className="flex-1 px-4 py-2.5 border border-[#2a2a3e] rounded-xl bg-[#1a1a2e] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
            />
            <button
              onClick={handleEnroll}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500 shadow-sm shadow-emerald-500/20 transition-all cursor-pointer"
            >
              Add subject
            </button>
          </div>
          {enrollMessage && (
            <div className="mt-3 text-sm text-emerald-400 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {enrollMessage}
            </div>
          )}
          {enrollError && (
            <div className="mt-3 text-sm text-red-400 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {enrollError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          <div className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] p-6 hover:border-[#3a3a5e] transition-colors">
            <div className="flex items-center">
              <div className="p-3 bg-sky-900/40 rounded-xl">
                <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-400">Upcoming exams</p>
                <p className="text-2xl font-bold text-white">
                  {allExams.filter(e => e.status === 'wait_room' || e.status === 'waiting_start').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] p-6 hover:border-[#3a3a5e] transition-colors">
            <div className="flex items-center">
              <div className="p-3 bg-emerald-900/40 rounded-xl">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-400">Active exams</p>
                <p className="text-2xl font-bold text-white">
                  {allExams.filter(e => e.status === 'active' || e.status === 'paused').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] p-6 hover:border-[#3a3a5e] transition-colors">
            <div className="flex items-center">
              <div className="p-3 bg-violet-900/40 rounded-xl">
                <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-400">Finished exams</p>
                <p className="text-2xl font-bold text-white">
                  {allExams.filter(e => e.status === 'completed' || e.status === 'withdrawn' || e.status === 'submitted').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="p-12 text-center">
            <svg className="animate-spin h-8 w-8 text-emerald-400 mx-auto mb-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-400">Loading subjects...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="p-6 text-center text-red-400">
            {error}
          </div>
        )}

        {!isLoading && !error && subjects.length === 0 ? (
          <div className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] p-12 text-center">
            <svg className="w-12 h-12 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-gray-400">You are not enrolled in any subjects.</p>
            <p className="text-sm text-gray-500 mt-1">Use the form above to add your first subject.</p>
          </div>
        ) : null}

        {!isLoading && !error && subjects.length > 0 ? (
          <div className="space-y-6">
            {subjects.map((subject) => (
              <div key={subject.id} className="bg-[#13131f] rounded-2xl border border-[#2a2a3e] overflow-hidden">
                <div className="px-6 py-4 border-b border-[#2a2a3e] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {subject.name}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {subject.description || 'No description'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnenroll(subject.id)}
                    className="px-3 py-1.5 text-xs font-medium text-red-400 border border-red-800/60 rounded-lg hover:bg-red-900/20 transition-colors cursor-pointer"
                  >
                    Unenroll
                  </button>
                </div>

                {subject.exams.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    No exams for this subject yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#2a2a3e]/60">
                    {subject.exams.map((exam) => (
                      <div
                        key={exam.id}
                        className="p-6 hover:bg-[#1a1a2e]/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3">
                              <h4 className="text-lg font-medium text-white">
                                {exam.name}
                              </h4>
                              {getStatusBadge(exam.status)}
                              {exam.grade && (
                                <span
                                  className={`px-3 py-1 text-sm font-bold rounded-full ${
                                    exam.grade.value === 5
                                      ? 'bg-red-900/40 text-red-400 border border-red-800/40'
                                      : 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40'
                                  }`}
                                >
                                  {exam.grade.value === 5 ? 'Ispit pao' : `Grade: ${exam.grade.value}`}
                                </span>
                              )}
                            </div>
                            {exam.grade?.comment && (
                              <div className="mt-1.5 text-sm text-gray-400 italic">
                                "{exam.grade.comment}"
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-400">
                              <span className="flex items-center">
                                <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {formatDateTime(exam.startTime)}
                              </span>
                              <span className="flex items-center">
                                <svg className="w-4 h-4 mr-1.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                className="px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500 shadow-sm shadow-emerald-500/20 transition-all cursor-pointer"
                              >
                                Start exam
                              </button>
                            )}
                            {exam.status === 'wait_room' && (
                              <button
                                disabled
                                className="px-6 py-2.5 text-sm font-medium text-gray-500 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl cursor-not-allowed"
                              >
                                Inactive
                              </button>
                            )}
                            {exam.status === 'waiting_start' && (
                              <button
                                disabled
                                className="px-6 py-2.5 text-sm font-medium text-gray-500 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl cursor-not-allowed"
                              >
                                Waiting to start
                              </button>
                            )}
                            {exam.status === 'paused' && (
                              <button
                                disabled
                                className="px-6 py-2.5 text-sm font-medium text-amber-400 bg-amber-900/20 border border-amber-800/40 rounded-xl cursor-not-allowed"
                              >
                                Paused
                              </button>
                            )}
                            {(exam.status === 'completed' || exam.status === 'submitted') && (
                              <button
                                onClick={() => handleViewWork(exam.id)}
                                className="px-6 py-2.5 text-sm font-semibold text-violet-400 border border-violet-700/60 rounded-xl hover:bg-violet-900/20 transition-colors cursor-pointer"
                              >
                                View your work
                              </button>
                            )}
                            {exam.status === 'withdrawn' && (
                              <button
                                disabled
                                className="px-6 py-2.5 text-sm font-medium text-gray-500 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl cursor-not-allowed"
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
