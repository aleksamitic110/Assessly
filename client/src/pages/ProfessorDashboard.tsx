import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { Exam as ExamType } from '../types';

interface Subject {
  id: string;
  name: string;
  description: string;
}

interface SubjectWithExams extends Subject {
  exams: ExamType[];
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleSubject = (subjectId: string) => {
    setExpandedSubjectId((prev) => (prev === subjectId ? null : subjectId));
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
      setSubjects((prev) =>
        prev.map((subject) =>
          subject.id === examData.subjectId
            ? { ...subject, exams: [...subject.exams, response.data] }
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
                  <input
                    type="text"
                    placeholder="ID predmeta"
                    value={examData.subjectId}
                    onChange={(e) => setExamData({ ...examData, subjectId: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  />
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

          {/* Live Monitoring Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
                <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <h3 className="ml-3 text-lg font-semibold text-gray-900 dark:text-white">
                Live Monitoring
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Pratite studente u realnom vremenu tokom ispita
            </p>
            <button
              className="w-full px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition-colors"
              onClick={() => alert('Live monitoring ce biti implementiran sa Socket.io')}
            >
              Otvori monitoring
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
                                {subject.exams.map((exam) => (
                                  <li
                                    key={exam.id}
                                    className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300"
                                  >
                                    <div className="flex flex-col">
                                      <span>{exam.name}</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Exam ID: {exam.id}
                                      </span>
                                    </div>
                                    <span className="text-gray-500 dark:text-gray-400">
                                      {exam.startTime}
                                    </span>
                                  </li>
                                ))}
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
