import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
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

      // Fetch grades for submitted exams
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

      // Update exams with grades
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
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            Inactive (scheduled)
          </span>
        );
      case 'waiting_start':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
            Waiting to start
          </span>
        );
      case 'active':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Active
          </span>
        );
      case 'paused':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            Paused
          </span>
        );
      case 'completed':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            Completed
          </span>
        );
      case 'submitted':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
            Submitted
          </span>
        );
      case 'withdrawn':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              Assessly
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Student Dashboard
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {hasUpdates && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 shadow-sm dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium">
                Updates available. Refresh to see the latest exam changes.
                {lastUpdateAt ? (
                  <span className="ml-2 text-xs text-blue-700/80 dark:text-blue-200/80">
                    Last change: {new Date(lastUpdateAt).toLocaleTimeString('en-US')}
                  </span>
                ) : null}
              </div>
              <button
                onClick={handleRefresh}
                className="px-3 py-2 text-xs font-semibold text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-100 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900/60 transition-colors"
              >
                Refresh now
              </button>
            </div>
          </div>
        )}
        <div className="bg-gradient-to-r from-indigo-500 to-blue-600 rounded-lg shadow-lg p-6 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-2">
            Welcome, {user?.firstName}!
          </h2>
          <p className="opacity-90">
            Manage your subjects and access available exams.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Add a subject
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Enter the subject password given by your professor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={enrollPassword}
              onChange={(e) => setEnrollPassword(e.target.value)}
              placeholder="Subject password"
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
            <button
              onClick={handleEnroll}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Add subject
            </button>
          </div>
          {enrollMessage && (
            <div className="mt-3 text-sm text-green-600 dark:text-green-400">
              {enrollMessage}
            </div>
          )}
          {enrollError && (
            <div className="mt-3 text-sm text-red-600 dark:text-red-400">
              {enrollError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Upcoming exams</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {allExams.filter(e => e.status === 'wait_room' || e.status === 'waiting_start').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active exams</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {allExams.filter(e => e.status === 'active' || e.status === 'paused').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Finished exams</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {allExams.filter(e => e.status === 'completed' || e.status === 'withdrawn' || e.status === 'submitted').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            Loading subjects...
          </div>
        )}

        {!isLoading && error && (
          <div className="p-6 text-center text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!isLoading && !error && subjects.length === 0 ? (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            You are not enrolled in any subjects.
          </div>
        ) : null}

        {!isLoading && !error && subjects.length > 0 ? (
          <div className="space-y-6">
            {subjects.map((subject) => (
              <div key={subject.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {subject.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {subject.description || 'No description'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnenroll(subject.id)}
                    className="px-3 py-2 text-xs font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Unenroll
                  </button>
                </div>

                {subject.exams.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                    No exams for this subject yet.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {subject.exams.map((exam) => (
                      <div
                        key={exam.id}
                        className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3">
                              <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                                {exam.name}
                              </h4>
                              {getStatusBadge(exam.status)}
                              {exam.grade && (
                                <span
                                  className={`px-3 py-1 text-sm font-bold rounded-full ${
                                    exam.grade.value === 5
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                      : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  }`}
                                >
                                  {exam.grade.value === 5 ? 'Ispit pao' : `Grade: ${exam.grade.value}`}
                                </span>
                              )}
                            </div>
                            {exam.grade?.comment && (
                              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 italic">
                                "{exam.grade.comment}"
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                              <span className="flex items-center">
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {formatDateTime(exam.startTime)}
                              </span>
                              <span className="flex items-center">
                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Start exam
                              </button>
                            )}
                            {exam.status === 'wait_room' && (
                              <button
                                disabled
                                className="px-6 py-2 text-sm font-medium text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
                              >
                                Inactive
                              </button>
                            )}
                            {exam.status === 'waiting_start' && (
                              <button
                                disabled
                                className="px-6 py-2 text-sm font-medium text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
                              >
                                Waiting to start
                              </button>
                            )}
                            {exam.status === 'paused' && (
                              <button
                                disabled
                                className="px-6 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg cursor-not-allowed"
                              >
                                Paused
                              </button>
                            )}
                            {(exam.status === 'completed' || exam.status === 'submitted') && (
                              <button
                                onClick={() => handleViewWork(exam.id)}
                                className="px-6 py-2 text-sm font-medium text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                              >
                                View your work
                              </button>
                            )}
                            {exam.status === 'withdrawn' && (
                              <button
                                disabled
                                className="px-6 py-2 text-sm font-medium text-gray-500 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
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
