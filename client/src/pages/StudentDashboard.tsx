import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam } from '../types';

interface AvailableExam {
  id: string;
  name: string;
  subjectName: string;
  startTime: string;
  durationMinutes: number;
  status: 'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed' | 'withdrawn';
}

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [exams, setExams] = useState<AvailableExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);
  const joinedExamIdsRef = useRef<Set<string>>(new Set());

  const updateExamStatus = useCallback((examId: string, status: AvailableExam['status']) => {
    if (status === 'active') {
      localStorage.removeItem(`exam_withdrawn:${examId}`);
    }
    setExams((prev) =>
      prev.map((exam) => (exam.id === examId ? { ...exam, status } : exam))
    );
  }, []);

  const getExamStatus = useCallback(
    (startTime: string, durationMinutes: number): AvailableExam['status'] => {
      const start = new Date(startTime).getTime();
      if (Number.isNaN(start)) {
        return 'waiting_start';
      }
      const end = start + durationMinutes * 60 * 1000;
      const now = Date.now();
      if (now < start) return 'wait_room';
      if (now <= end) return 'active';
      return 'completed';
    },
    []
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadExams = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setError('');
    try {
      const response = await api.get<Exam[]>('/exams');
      const mapped = response.data.map((exam) => {
        const serverStatus = exam.status || getExamStatus(exam.startTime, exam.durationMinutes);
        const withdrawn = serverStatus === 'withdrawn';
        if (!withdrawn) {
          localStorage.removeItem(`exam_withdrawn:${exam.id}`);
        } else {
          localStorage.setItem(`exam_withdrawn:${exam.id}`, 'true');
        }
        return {
          id: exam.id,
          name: exam.name,
          subjectName: exam.subjectName || 'Nepoznat predmet',
          startTime: exam.startTime,
          durationMinutes: exam.durationMinutes,
          status: withdrawn ? 'withdrawn' : serverStatus,
        };
      });
      if (isMountedRef.current) {
        setExams(mapped);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.response?.data?.error || 'Greska prilikom ucitavanja ispita');
      }
    } finally {
      if (isMountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [getExamStatus]);

  useEffect(() => {
    loadExams(false);
  }, [loadExams]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadExams(true);
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadExams]);

  useEffect(() => {
    connectSocket();

    const handleExamState = (data: { examId: string; status?: AvailableExam['status'] }) => {
      if (!data?.examId || !data.status) return;
      updateExamStatus(data.examId, data.status);
    };

    socket.on('exam_state', handleExamState);

    return () => {
      socket.off('exam_state', handleExamState);
      disconnectSocket();
    };
  }, [updateExamStatus]);

  useEffect(() => {
    exams.forEach((exam) => {
      if (!joinedExamIdsRef.current.has(exam.id)) {
        socket.emit('join_exam', exam.id);
        joinedExamIdsRef.current.add(exam.id);
      }
    });
  }, [exams]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStartExam = (examId: string) => {
    navigate(`/exam/${examId}`);
  };

  const getStatusBadge = (status: AvailableExam['status']) => {
    switch (status) {
      case 'wait_room':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            Ceka termin
          </span>
        );
      case 'waiting_start':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
            Ceka start
          </span>
        );
      case 'active':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Aktivan
          </span>
        );
      case 'paused':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            Pauziran
          </span>
        );
      case 'completed':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            Zavrsen
          </span>
        );
      case 'withdrawn':
        return (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            Odustao
          </span>
        );
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('sr-RS', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
              Odjavi se
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg shadow-lg p-6 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-2">
            Dobrodosli, {user?.firstName}!
          </h2>
          <p className="opacity-90">
            Ovde mozete videti dostupne ispite i pristupiti aktivnim testovima.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Predstoeci ispiti</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {exams.filter(e => e.status === 'wait_room' || e.status === 'waiting_start').length}
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
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Aktivni ispiti</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {exams.filter(e => e.status === 'active' || e.status === 'paused').length}
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
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Zavrseni ispiti</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {exams.filter(e => e.status === 'completed' || e.status === 'withdrawn').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Exams List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Dostupni ispiti
            </h3>
          </div>

          {isLoading && (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              Ucitavanje ispita...
            </div>
          )}

          {!isLoading && error && (
            <div className="p-6 text-center text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {!isLoading && !error && exams.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              Nema dostupnih ispita
            </div>
          ) : null}

          {!isLoading && !error && exams.length > 0 ? (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {exams.map((exam) => (
                <div
                  key={exam.id}
                  className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          {exam.name}
                        </h4>
                        {getStatusBadge(exam.status)}
                      </div>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {exam.subjectName}
                      </p>
                      <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
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
                    <div>
                      {exam.status === 'active' && (
                        <button
                          onClick={() => handleStartExam(exam.id)}
                          className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                        >
                          Zapocni ispit
                        </button>
                      )}
                      {exam.status === 'wait_room' && (
                        <button
                          disabled
                          className="px-6 py-2 text-sm font-medium text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
                        >
                          Nije vreme
                        </button>
                      )}
                      {exam.status === 'waiting_start' && (
                        <button
                          disabled
                          className="px-6 py-2 text-sm font-medium text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
                        >
                          Ceka start
                        </button>
                      )}
                      {exam.status === 'paused' && (
                        <button
                          disabled
                          className="px-6 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg cursor-not-allowed"
                        >
                          Pauziran
                        </button>
                      )}
                              {exam.status === 'completed' && (
                                <button
                                  className="px-6 py-2 text-sm font-medium text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                >
                                  Vidi rezultate
                                </button>
                              )}
                              {exam.status === 'withdrawn' && (
                                <button
                                  disabled
                                  className="px-6 py-2 text-sm font-medium text-gray-500 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-not-allowed"
                                >
                                  Odustao
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
