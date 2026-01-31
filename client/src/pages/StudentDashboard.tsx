import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api, { gradeApi } from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Grade } from '../types';

// Icons
const Icons = {
  Academic: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>,
  Clock: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Archive: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>,
  Trash: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
  Refresh: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Empty: () => <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  Logout: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
};

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
    const baseClasses = "px-2.5 py-0.5 text-xs font-semibold rounded-full border";
    switch (status) {
      case 'wait_room':
        return <span className={`${baseClasses} bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700`}>Scheduled</span>;
      case 'waiting_start':
        return <span className={`${baseClasses} bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800`}>Waiting to Start</span>;
      case 'active':
        return <span className={`${baseClasses} bg-green-50 text-green-600 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800 animate-pulse`}>● Active</span>;
      case 'paused':
        return <span className={`${baseClasses} bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800`}>Paused</span>;
      case 'completed':
        return <span className={`${baseClasses} bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800`}>Completed</span>;
      case 'submitted':
        return <span className={`${baseClasses} bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800`}>Submitted</span>;
      case 'withdrawn':
        return <span className={`${baseClasses} bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800`}>Withdrawn</span>;
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 font-sans overflow-hidden">
      {/* Navbar - Fixed height */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-1.5 rounded-lg">
                <Icons.Academic />
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
            <Link
              to="/change-password"
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Change Password
            </Link>
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
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                Assessly
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 hidden sm:block">
                {user?.firstName} {user?.lastName}
              </span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-all active:scale-95"
              >
                <Icons.Logout /> Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area - Flex Row */}
      <div className="flex-1 flex overflow-hidden max-w-7xl mx-auto w-full">
        
        {/* LEFT COLUMN: Stats Pills & Welcome */}
        <aside className="w-1/4 min-w-[280px] p-6 flex flex-col gap-6 overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-800/30">
          
          <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl shadow-lg text-white p-6">
            <h1 className="text-2xl font-bold mb-2">Welcome, {user?.firstName}!</h1>
            <p className="text-indigo-100 text-sm">
              <span className="font-bold">{allExams.filter(e => e.status === 'active').length}</span> exams active.
            </p>
          </div>

          {/* Stats Pills Stacked Vertically */}
          <div className="flex flex-col gap-4">
            <StatsCard 
              title="Upcoming" 
              count={allExams.filter(e => e.status === 'wait_room' || e.status === 'waiting_start').length}
              icon={<Icons.Clock />} 
              color="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
            />
            <StatsCard 
              title="Active Now" 
              count={allExams.filter(e => e.status === 'active' || e.status === 'paused').length}
              icon={<Icons.Academic />} 
              color="bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
            />
            <StatsCard 
              title="Completed" 
              count={allExams.filter(e => ['completed', 'submitted', 'withdrawn'].includes(e.status)).length}
              icon={<Icons.Archive />} 
              color="bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
            />
          </div>

          {/* --- ALWAYS VISIBLE REFRESH BUTTON  --- */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-indigo-600 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <div className={`${isLoading ? "animate-spin" : ""}`}>
              <Icons.Refresh />
            </div>
            <span>{isLoading ? "Refreshing..." : "Refresh List"}</span>
          </button>

          {/* Existing update banner */}
          {hasUpdates && !isLoading && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl shadow-sm text-blue-900 text-xs text-center">
              Updates available.
            </div>
          )}
        </aside>

        {/* RIGHT COLUMN: Enroll + Scrollable Exam Box */}
        <main className="flex-1 flex flex-col p-6 min-w-0">
          
          {/* Enroll Section (Fixed at top of right column) */}
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
             <div className="flex items-center gap-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">Join Subject</h3>
                <div className="flex-1 flex gap-2">
                   <input
                    type="password"
                    value={enrollPassword}
                    onChange={(e) => setEnrollPassword(e.target.value)}
                    placeholder="Enter code..."
                    className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  />
                  <button
                    onClick={handleEnroll}
                    className="px-4 py-2 text-sm font-medium text-white bg-gray-900 dark:bg-indigo-600 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Join
                  </button>
                </div>
             </div>
             {(enrollMessage || enrollError) && (
                <div className={`mt-2 text-xs font-medium ${enrollError ? 'text-red-600' : 'text-green-600'}`}>
                  {enrollMessage || enrollError}
                </div>
             )}
          </div>

          {/* SCROLLABLE EXAM LIST CONTAINER */}
          <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-900/50 shadow-inner p-1">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center">
                 <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                 <p className="mt-4 text-gray-500">Loading exams...</p>
              </div>
            ) : error ? (
              <div className="p-6 text-center text-red-600">{error}</div>
            ) : subjects.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-gray-400">
                 <Icons.Empty />
                 <p className="mt-4">No subjects found</p>
               </div>
            ) : (
              <div className="space-y-4 p-4">
                {subjects.map((subject) => (
                  <div key={subject.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="bg-gray-50/80 dark:bg-gray-800/80 px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                       <h3 className="font-bold text-gray-800 dark:text-gray-200">{subject.name}</h3>
                       <button onClick={() => handleUnenroll(subject.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Icons.Trash /></button>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-gray-700">
                      {subject.exams.length === 0 ? (
                        <div className="p-4 text-center text-xs text-gray-400">No exams</div>
                      ) : (
                        subject.exams.map((exam) => (
                          <div key={exam.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-semibold text-gray-900 dark:text-white">{exam.name}</span>
                                  {getStatusBadge(exam.status)}
                                </div>
                                <div className="text-xs text-gray-500 flex gap-3">
                                  <span>{formatDateTime(exam.startTime)}</span>
                                  <span>{exam.durationMinutes} min</span>
                                </div>
                                {exam.grade && (
                                   <div className={`mt-2 inline-flex items-center gap-2 px-2 py-1 rounded border text-xs font-bold ${
                                      exam.grade.value === 5 ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'
                                   }`}>
                                      {exam.grade.value === 5 ? 'Failed' : `Grade: ${exam.grade.value}`}
                                   </div>
                                )}
                              </div>
                              
                              <div className="flex-shrink-0">
                                {exam.status === 'active' && (
                                  <button onClick={() => handleStartExam(exam.id)} className="w-full sm:w-auto px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded shadow-sm">Start</button>
                                )}
                                {(['completed', 'submitted'].includes(exam.status)) && (
                                  <button onClick={() => handleViewWork(exam.id)} className="w-full sm:w-auto px-4 py-1.5 border border-gray-300 text-gray-600 hover:text-indigo-600 hover:border-indigo-300 text-xs font-medium rounded">Review</button>
                                )}
                                {['wait_room', 'waiting_start', 'paused', 'withdrawn'].includes(exam.status) && (
                                  <span className="text-xs text-gray-400 italic">Not available</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function StatsCard({ title, count, icon, color }: { title: string, count: number, icon: React.ReactNode, color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{count}</p>
      </div>
    </div>
  );
}