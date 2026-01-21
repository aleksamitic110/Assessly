import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useAuth } from '../context/AuthContext';
import logsService from '../services/logs';
import api from '../services/api';
//Importujemo socket servis
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam, Task as TaskType } from '../types';

export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Exam state
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [currentTask, setCurrentTask] = useState<TaskType | null>(null);
  const [code, setCode] = useState('');
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [examDetails, setExamDetails] = useState<Exam | null>(null);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [violations, setViolations] = useState(0);
  const [examStatus, setExamStatus] = useState<'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed'>('wait_room');

  // Anti-cheat refs
  const lastActivityRef = useRef<number>(Date.now());

  //SOCKET: Glavna logika za povezivanje i tajmer
  useEffect(() => {
    if (!examId) return;

    //Konektujemo se na socket
    connectSocket();

    //Ulazimo u sobu ispita
    socket.emit('join_exam', examId);

    socket.on('exam_state', (data: { status: string; remainingMilliseconds?: number }) => {
      if (!data) return;
      if (data.status === 'active' || data.status === 'paused' || data.status === 'completed') {
        setExamStatus(data.status);
      }
      if (typeof data.remainingMilliseconds === 'number') {
        const secondsLeft = Math.floor(data.remainingMilliseconds / 1000);
        setTimeLeft(secondsLeft > 0 ? secondsLeft : 0);
      }
    });

    socket.on('timer_sync', (data: { remainingMilliseconds: number }) => {
      const secondsLeft = Math.floor(data.remainingMilliseconds / 1000);
      setTimeLeft(secondsLeft > 0 ? secondsLeft : 0);
    });

    // Ciscenje pri izlasku
    return () => {
      socket.off('exam_state');
      socket.off('timer_sync');
      disconnectSocket();
    };
  }, [examId]);

  useEffect(() => {
    let isMounted = true;

    const loadTasks = async () => {
      if (!examId) {
        setTaskError('Nedostaje ID ispita');
        setIsLoadingTask(false);
        return;
      }
      setIsLoadingTask(true);
      setTaskError('');
      try {
        const [examResponse, taskResponse] = await Promise.all([
          api.get<Exam>(`/exams/${examId}`),
          api.get<TaskType[]>(`/exams/${examId}/tasks`)
        ]);

        if (!isMounted) return;

        setExamDetails(examResponse.data);
        const status = examResponse.data.status || 'waiting_start';
        setExamStatus(status);
        if (typeof examResponse.data.remainingSeconds === 'number') {
          setTimeLeft(examResponse.data.remainingSeconds);
        } else if (status === 'active') {
          setTimeLeft(examResponse.data.durationMinutes * 60);
        } else {
          setTimeLeft(0);
        }

        setTasks(taskResponse.data);
        if (taskResponse.data.length > 0) {
          setCurrentTask(taskResponse.data[0]);
          setCode(taskResponse.data[0].starterCode || '');
        } else {
          setCurrentTask(null);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setTaskError(err.response?.data?.error || 'Greska prilikom ucitavanja zadataka');
      } finally {
        if (isMounted) {
          setIsLoadingTask(false);
        }
      }
    };

    loadTasks();
    return () => {
      isMounted = false;
    };
  }, [examId]);

  // Timer (Lokalni ticker - sluzi da odbrojava sekunde izmedju sync-ova)
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (examStatus !== 'active') {
          return prev;
        }
        if (prev <= 0) {
          clearInterval(timer);
          // handleSubmit(); // Opciono: Automatska predaja kad istekne vreme
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStatus]);

  // Anti-cheat: Tab switch detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && examId) {
        setViolations((prev) => prev + 1);
        
        //Cassandra Log
        logsService.logSecurityEvent(examId, 'TAB_SWITCH', {
          timestamp: new Date().toISOString(),
          violations: violations + 1,
        });

        //SOCKET Live Professor Alert
        socket.emit('violation', { examId, type: 'tab_switch' });
      }
    };

    const handleBlur = () => {
      if (examId) {
        setViolations((prev) => prev + 1);
        
        // Cassandra Log
        logsService.logSecurityEvent(examId, 'BLUR', {
          timestamp: new Date().toISOString(),
        });

        // SOCKET Tvoj Alarm
        socket.emit('violation', { examId, type: 'tab_blur' });
      }
    };

    const handleCopyPaste = (e: ClipboardEvent) => {
      if (examId && e.type === 'paste') {
        setViolations((prev) => prev + 1);
        
        // Cassandra Log
        logsService.logSecurityEvent(examId, 'COPY_PASTE', {
          timestamp: new Date().toISOString(),
          type: e.type,
        });

        //SOCKET Alarm
        socket.emit('violation', { examId, type: 'copy_paste' });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('paste', handleCopyPaste);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('paste', handleCopyPaste);
    };
  }, [examId, violations]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRunCode = async () => {
    if (!currentTask || !examId || examStatus !== 'active') return;
    setIsRunning(true);
    setOutput('Kompajliranje i pokretanje...\n');

    // Log execution to Cassandra
    if (examId) {
      try {
        await logsService.logExecution(
          examId,
          currentTask.id,
          code,
          'Kod pokrenut',
          'RUNNING'
        );
      } catch (err) {
        console.error('Failed to log execution:', err);
      }
    }

    // Simulate code execution
    setTimeout(() => {
      const mockOutput = `Pre sortiranja: 64 34 25 12 22 11 90
Posle sortiranja: 11 12 22 25 34 64 90

Program uspesno izvrsen.
Vreme izvrsavanja: 0.003s`;
      setOutput(mockOutput);
      setIsRunning(false);

      // Log successful execution
      if (examId) {
        logsService.logExecution(
          examId,
          currentTask.id,
          code,
          mockOutput,
          'SUCCESS'
        );
      }
    }, 2000);
  };

  const handleSaveCode = async () => {
    if (!examId || !currentTask || examStatus !== 'active') return;
    setIsSaving(true);
    try {
      await logsService.logExecution(
        examId,
        currentTask.id,
        code,
        'Kod sacuvan',
        'SUCCESS'
      );
      setOutput((prev) => (prev ? `${prev}\nKod sacuvan.` : 'Kod sacuvan.'));
    } catch (err) {
      console.error('Failed to save code:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!examId || !currentTask || examStatus !== 'active') {
      alert('Ispit nije spreman za predaju.');
      return;
    }

    if (examId && currentTask && examStatus === 'active') {
      await logsService.logExecution(
        examId,
        currentTask.id,
        code,
        'Ispit predat',
        'SUCCESS'
      );
      alert('Ispit je uspesno predat!');
    }
    navigate('/student');
  };

  const isExamLocked = examStatus !== 'active';

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-indigo-400">Assessly</h1>
            <span className="text-gray-400">|</span>
            <span className="text-gray-300">{currentTask?.title || 'Ispit'}</span>
            {examDetails && (
              <span className="text-gray-500 text-sm">({examDetails.subjectName})</span>
            )}
          </div>
          <div className="flex items-center space-x-6">
            {/* Violations counter */}
            {violations > 0 && (
              <div className="flex items-center space-x-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{violations} upozorenja</span>
              </div>
            )}
            <div className="flex items-center space-x-3">
              <span className="text-xs uppercase tracking-wide text-gray-400">
                {examStatus === 'active' && 'Aktivan'}
                {examStatus === 'paused' && 'Pauziran'}
                {examStatus === 'wait_room' && 'Ceka termin'}
                {examStatus === 'waiting_start' && 'Ceka start'}
                {examStatus === 'completed' && 'Zavrsen'}
              </span>
              {/* Timer */}
              <div className={`text-lg font-mono ${timeLeft < 300 ? 'text-red-400' : 'text-green-400'}`}>
                {formatTime(timeLeft)}
              </div>
            </div>
            {/* User info */}
            <span className="text-gray-400">
              {user?.firstName} {user?.lastName}
            </span>
            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={isExamLocked}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors"
            >
              Predaj ispit
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Left panel - Task description */}
        <div className="w-1/3 bg-gray-800 border-r border-gray-700 p-4 overflow-y-auto">
          {isExamLocked && (
            <div className="mb-4 rounded border border-yellow-600/40 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-200">
              {examStatus === 'wait_room' && 'Ispit jos nije usao u termin.'}
              {examStatus === 'waiting_start' && 'Ispit jos nije pokrenut od strane profesora.'}
              {examStatus === 'paused' && 'Ispit je trenutno pauziran.'}
              {examStatus === 'completed' && 'Ispit je zavrsen.'}
            </div>
          )}
          <h2 className="text-lg font-semibold mb-4 text-indigo-400">Zadatak</h2>
          <div className="prose prose-invert">
            {isLoadingTask && (
              <div className="text-gray-400">Ucitavanje zadatka...</div>
            )}
            {!isLoadingTask && taskError && (
              <div className="text-red-400">{taskError}</div>
            )}
            {!isLoadingTask && !taskError && currentTask && (
              <>
                <h3 className="text-white text-xl mb-2">{currentTask.title}</h3>
                <p className="text-gray-300 leading-relaxed">{currentTask.description}</p>
              </>
            )}
            {!isLoadingTask && !taskError && !currentTask && (
              <div className="text-gray-400">Nema dostupnih zadataka.</div>
            )}

            {currentTask && (
              <>
                <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                  <h4 className="text-yellow-400 font-medium mb-2">Primer ulaza/izlaza:</h4>
                  <pre className="text-sm text-gray-300 bg-gray-900 p-3 rounded">
{`Ulaz: [64, 34, 25, 12, 22, 11, 90]
Izlaz: [11, 12, 22, 25, 34, 64, 90]`}
                  </pre>
                </div>

                <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
                  <h4 className="text-blue-400 font-medium mb-2">Napomena:</h4>
                  <ul className="text-gray-300 text-sm list-disc list-inside space-y-1">
                    <li>Mozete koristiti bilo koji algoritam sortiranja</li>
                    <li>Funkcija treba da menja originalni niz (in-place)</li>
                    <li>Ne koristite ugradjene funkcije za sortiranje</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right panel - Editor and Output */}
        <div className="flex-1 flex flex-col">
          {/* Monaco Editor */}
          <div className="flex-1 border-b border-gray-700">
            <Editor
              height="100%"
              defaultLanguage="cpp"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              options={{
                readOnly: isLoadingTask || !!taskError || isExamLocked,
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                wordWrap: 'on',
              }}
            />
          </div>

          {/* Output panel */}
          <div className="h-48 bg-gray-900 border-t border-gray-700">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
              <span className="text-sm font-medium text-gray-400">Output</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSaveCode}
                  disabled={isSaving || !currentTask || isExamLocked}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    isSaving || !currentTask || isExamLocked
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isSaving ? 'Cuvanje...' : 'Sacuvaj'}
                </button>
                <button
                  onClick={handleRunCode}
                  disabled={isRunning || !currentTask || isExamLocked}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    isRunning || !currentTask || isExamLocked
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isRunning ? 'Izvrsavanje...' : 'Pokreni kod (F5)'}
                </button>
              </div>
            </div>
            <pre className="p-4 text-sm text-gray-300 font-mono overflow-auto h-full">
              {output || 'Kliknite "Pokreni kod" da vidite rezultat...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
