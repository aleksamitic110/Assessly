import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam as ExamType } from '../types';

interface Subject {
  id: string;
  name: string;
  description: string;
}

interface SubjectWithExams extends Subject {
  exams: ExamType[];
}

//SOCKET Tip za alert
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
  const [subjectData, setSubjectData] = useState({ name: '', description: '' });

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

  //SOCKET: Glavna logika za profesora
  useEffect(() => {
    //Konektuj se
    connectSocket();

    //Slusaj prekrsaje (Big Brother)
    socket.on('violation_alert', (data: Alert) => {
      console.log('🚨 NEW ALERT:', data);
      setLiveAlerts((prev) => [data, ...prev]); // Dodaj novi na vrh liste
      
      // Opciono: Zvuk alarma
      new Audio('/alert.mp3').play().catch(() => {});
    });

    //Slusaj status studenata (Online/Offline)
    socket.on('student_status_update', (data) => {
      console.log(`Status: ${data.email} -> ${data.status}`);
    });

    socket.on('exam_state', (data: { examId: string; status: ExamType['status'] }) => {
      if (!data?.examId) return;
      if (data.status === 'active' || data.status === 'paused' || data.status === 'completed') {
        updateExamStatus(data.examId, data.status);
      }
    });

    return () => {
      socket.off('violation_alert');
      socket.off('student_status_update');
      socket.off('exam_state');
      disconnectSocket();
    };
  }, []);

  //SOCKET: Funkcija za pokretanje ispita
  const handleStartExam = (exam: ExamType) => {
    if(!confirm(`Da li ste sigurni da želite da pokrenete ispit "${exam.name}"?`)) return;

    // Prvo se pridruži sobi da bi dobio potvrdu
    handleMonitorExam(exam.id);

    socket.emit('start_exam', { 
      examId: exam.id, 
      durationMinutes: exam.durationMinutes 
    });
    
    updateExamStatus(exam.id, 'active');
    setMessage(`Komanda za start ispita "${exam.name}" je poslata!`);
  };

  const handlePauseExam = (exam: ExamType) => {
    socket.emit('pause_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'paused');
    setMessage(`Ispit "${exam.name}" je pauziran.`);
  };

  const handleResumeExam = (exam: ExamType) => {
    socket.emit('resume_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'active');
    setMessage(`Ispit "${exam.name}" je nastavljen.`);
  };

  const handleExtendExam = (exam: ExamType) => {
    const extra = prompt('Unesite broj minuta za produzenje:', '10');
    const extraMinutes = extra ? parseInt(extra, 10) : 0;
    if (!extraMinutes || Number.isNaN(extraMinutes) || extraMinutes <= 0) return;
    socket.emit('extend_exam', { examId: exam.id, extraMinutes });
    setMessage(`Ispit "${exam.name}" produzen za ${extraMinutes} min.`);
  };

  const handleEndExam = (exam: ExamType) => {
    if (!confirm(`Da li ste sigurni da zelite da zavrsite ispit "${exam.name}"?`)) return;
    socket.emit('end_exam', { examId: exam.id });
    updateExamStatus(exam.id, 'completed');
    setMessage(`Ispit "${exam.name}" je zavrsen.`);
  };

  const handleRestartExam = (exam: ExamType) => {
    if (!confirm(`Da li zelite da restartujete ispit "${exam.name}"?`)) return;
    socket.emit('restart_exam', { examId: exam.id, durationMinutes: exam.durationMinutes });
    updateExamStatus(exam.id, 'active');
    setMessage(`Ispit "${exam.name}" je restartovan.`);
  };

  const handleUpdateSubject = async (subject: SubjectWithExams) => {
    const name = prompt('Unesite novi naziv predmeta:', subject.name);
    if (name === null) return;
    const description = prompt('Unesite novi opis predmeta:', subject.description);
    if (description === null) return;

    try {
      const response = await api.put(`/exams/subjects/${subject.id}`, { name, description });
      setSubjects((prev) =>
        prev.map((item) =>
          item.id === subject.id ? { ...item, ...response.data } : item
        )
      );
      setMessage(`Predmet "${name}" je izmenjen.`);
    } catch (err: any) {
      console.error('Update subject error:', err);
      setError(err.response?.data?.error || 'Greska prilikom izmene predmeta');
    }
  };

  const handleDeleteSubject = async (subject: SubjectWithExams) => {
    if (!confirm(`Da li ste sigurni da zelite da obrisete predmet "${subject.name}"?`)) return;

    try {
      await api.delete(`/exams/subjects/${subject.id}`);
      setSubjects((prev) => prev.filter((item) => item.id !== subject.id));
      setMessage(`Predmet "${subject.name}" je obrisan.`);
    } catch (err: any) {
      console.error('Delete subject error:', err);
      setError(err.response?.data?.error || 'Greska prilikom brisanja predmeta');
    }
  };

  const handleUpdateExam = async (exam: ExamType) => {
    const name = prompt('Unesite novi naziv ispita:', exam.name);
    if (name === null) return;
    const startTime = prompt('Unesite novo vreme pocetka (ISO string):', exam.startTime);
    if (startTime === null) return;
    const durationInput = prompt('Unesite novo trajanje (min):', exam.durationMinutes.toString());
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
      setMessage(`Ispit "${name}" je izmenjen.`);
    } catch (err: any) {
      console.error('Update exam error:', err);
      setError(err.response?.data?.error || 'Greska prilikom izmene ispita');
    }
  };

  const handleDeleteExam = async (exam: ExamType) => {
    if (!confirm(`Da li ste sigurni da zelite da obrisete ispit "${exam.name}"?`)) return;

    try {
      await api.delete(`/exams/exams/${exam.id}`);
      setSubjects((prev) =>
        prev.map((subject) => ({
          ...subject,
          exams: subject.exams.filter((item) => item.id !== exam.id),
        }))
      );
      setMessage(`Ispit "${exam.name}" je obrisan.`);
    } catch (err: any) {
      console.error('Delete exam error:', err);
      setError(err.response?.data?.error || 'Greska prilikom brisanja ispita');
    }
  };

  //SOCKET: Funkcija za pracenje (Join Room)
  const handleMonitorExam = (examId: string) => {
    if (monitoredExams.has(examId)) return;

    socket.emit('join_exam', examId);
    setMonitoredExams(prev => new Set(prev).add(examId));
    setMessage(`Uključeno praćenje za ispit ID: ${examId.substring(0, 8)}...`);
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
          setError(err.response?.data?.error || 'Greska prilikom ucitavanja predmeta');
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
      setMessage(`Predmet "${response.data.name}" uspesno kreiran! ID: ${response.data.id}`);
      setSubjects((prev) => [...prev, { ...response.data, exams: [] }]);
      setSubjectData({ name: '', description: '' });
      setShowSubjectForm(false);
    } catch (err: any) {
      console.error('Create subject error:', err);
      setError(err.response?.data?.error || 'Greska prilikom kreiranja predmeta');
    }
  };

  // Create Exam
  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const response = await api.post('/exams/exams', examData);
      setMessage(`Ispit "${response.data.name}" uspesno kreiran! ID: ${response.data.id}`);
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
      setError(err.response?.data?.error || 'Greska prilikom kreiranja ispita');
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
              Profesor Dashboard
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
                Predmeti
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Kreirajte novi predmet koji predajete
            </p>
            <button
              onClick={() => setShowSubjectForm(!showSubjectForm)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {showSubjectForm ? 'Zatvori' : 'Kreiraj predmet'}
            </button>

            {/* Subject Form */}
            {showSubjectForm && (
              <form onSubmit={handleCreateSubject} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Naziv predmeta"
                    value={subjectData.name}
                    onChange={(e) => setSubjectData({ ...subjectData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <textarea
                    placeholder="Opis predmeta"
                    value={subjectData.description}
                    onChange={(e) => setSubjectData({ ...subjectData, description: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Sacuvaj predmet
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
                Ispiti
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Kreirajte novi ispit za studente
            </p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              {showExamForm ? 'Zatvori' : 'Kreiraj ispit'}
            </button>

            {/* Exam Form */}
            {showExamForm && (
              <form onSubmit={handleCreateExam} className="mt-4 space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Naziv ispita"
                    value={examData.name}
                    onChange={(e) => setExamData({ ...examData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    Vreme pocetka
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
                    Trajanje (minuti)
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
                    Predmet
                  </label>
                  <select
                    value={examData.subjectId}
                    onChange={(e) => setExamData({ ...examData, subjectId: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  >
                    <option value="" disabled>
                      {subjects.length > 0 ? 'Izaberite predmet' : 'Nema dostupnih predmeta'}
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
                  Sacuvaj ispit
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
                <p className="text-center text-gray-500 mt-10">Nema aktivnih prekršaja.</p>
              ) : (
                <div className="space-y-2">
                  {liveAlerts.map((alert, idx) => (
                    <div key={idx} className="p-2 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded text-sm">
                      <div className="flex justify-between font-bold text-red-700 dark:text-red-400">
                        <span>{alert.email}</span>
                        <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-gray-600 dark:text-gray-300">
                        Tip: {alert.type} | Puta: {alert.count}
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
              Ocisti logove
            </button>
          </div>
        </div>

        {/* Created Subjects List */}
        {isLoadingSubjects && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center text-gray-500 dark:text-gray-400">
            Ucitavanje predmeta...
          </div>
        )}

        {!isLoadingSubjects && subjects.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Kreirani predmeti
            </h3>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Naziv
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Opis
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Akcije
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
                              Detalji
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
                              Izmeni
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(subject)}
                              className="px-3 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50"
                            >
                              Obrisi
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedSubjectId === subject.id && (
                        <tr>
                          <td colSpan={3} className="px-6 py-4 bg-gray-50 dark:bg-gray-900/30">
                            <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                              Subject ID: <span className="text-gray-800 dark:text-gray-200">{subject.id}</span>
                            </div>
                            {subject.exams.length === 0 ? (
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                Nema ispita za ovaj predmet
                              </div>
                            ) : (
                              <ul className="space-y-2">
                                {subject.exams.map((exam) => {
                                  const status = exam.status || 'waiting_start';

                                  return (
                                    <li
                                      key={exam.id}
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
                                            {status === 'active' && 'Aktivan'}
                                            {status === 'paused' && 'Pauziran'}
                                            {status === 'completed' && 'Zavrsen'}
                                            {status === 'wait_room' && 'Ceka termin'}
                                            {status === 'waiting_start' && 'Ceka start'}
                                          </span>
                                        </div>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          ID: {exam.id} | Po??etak: {new Date(exam.startTime).toLocaleString()}
                                        </span>
                                      </div>
                                      
                                      {/*SOCKET: Actions Buttons */}
                                      <div className="flex flex-wrap gap-2 justify-end">
                                        <button 
                                          onClick={() => handleMonitorExam(exam.id)}
                                          className={`px-3 py-1 text-xs rounded border ${
                                            monitoredExams.has(exam.id) 
                                              ? 'bg-yellow-100 text-yellow-700 border-yellow-300' 
                                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                          }`}
                                        >
                                          {monitoredExams.has(exam.id) ? 'dY`? Pra??enje aktivno' : 'Prati'}
                                        </button>

                                        {(status === 'wait_room' || status === 'waiting_start') && (
                                          <button 
                                            onClick={() => handleStartExam(exam)}
                                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                                          >
                                            ?- Start
                                          </button>
                                        )}

                                        {status === 'active' && (
                                          <button 
                                            onClick={() => handlePauseExam(exam)}
                                            className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
                                          >
                                            Pauza
                                          </button>
                                        )}

                                        {status === 'paused' && (
                                          <button 
                                            onClick={() => handleResumeExam(exam)}
                                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                                          >
                                            Nastavi
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button 
                                            onClick={() => handleExtendExam(exam)}
                                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                          >
                                            Produzi
                                          </button>
                                        )}

                                        {(status === 'active' || status === 'paused') && (
                                          <button 
                                            onClick={() => handleEndExam(exam)}
                                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                          >
                                            Zavrsi
                                          </button>
                                        )}

                                        {status === 'completed' && (
                                          <button 
                                            onClick={() => handleRestartExam(exam)}
                                            className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                          >
                                            Restart
                                          </button>
                                        )}

                                        <button 
                                          onClick={() => handleUpdateExam(exam)}
                                          className="px-3 py-1 text-xs border border-indigo-300 text-indigo-600 rounded hover:bg-indigo-50"
                                        >
                                          Izmeni
                                        </button>

                                        <button 
                                          onClick={() => handleDeleteExam(exam)}
                                          className="px-3 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                                        >
                                          Obrisi
                                        </button>
                                      </div>
                                    </li>
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
