import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useAuth } from '../context/AuthContext';
import logsService from '../services/logs';
import api from '../services/api';
import { socket, connectSocket, disconnectSocket } from '../services/socket';
import type { Exam, Task as TaskType } from '../types';
import ExamChatPanel from '../components/ExamChatPanel';

interface Submission {
  taskId: string;
  taskTitle?: string;
  sourceCode: string;
  output: string;
  updatedAt?: string | null;
}

type LanguageOption = {
  id: number;
  name: string;
};

const getMonacoLanguage = (languageName?: string | null) => {
  if (!languageName) return 'cpp';
  const name = languageName.toLowerCase();
  if (name.includes('typescript')) return 'typescript';
  if (name.includes('javascript')) return 'javascript';
  if (name.includes('python')) return 'python';
  if (name.includes('java')) return 'java';
  if (name.includes('c++')) return 'cpp';
  if (name.includes('c#')) return 'csharp';
  if (name === 'c' || name.startsWith('c ')) return 'c';
  if (name.includes('go')) return 'go';
  if (name.includes('ruby')) return 'ruby';
  if (name.includes('php')) return 'php';
  if (name.includes('rust')) return 'rust';
  if (name.includes('swift')) return 'swift';
  if (name.includes('kotlin')) return 'kotlin';
  if (name.includes('scala')) return 'scala';
  if (name.includes('sql')) return 'sql';
  return 'plaintext';
};

const getCommentedHello = (languageName?: string | null) => {
  if (!languageName) return '';
  const name = languageName.toLowerCase();
  const withLineComments = (prefix: string, lines: string[]) =>
    `${lines.map((line) => `${prefix} ${line}`).join('\n')}\n`;
  const withBlockComment = (start: string, end: string, lines: string[]) =>
    `${start}\n${lines.map((line) => ` ${line}`).join('\n')}\n${end}\n`;

  if (name.includes('python')) {
    return withLineComments('#', [
      'Python Hello World:',
      'print("Hello World")'
    ]);
  }
  if (name.includes('ruby')) {
    return withLineComments('#', [
      'Ruby Hello World:',
      'puts "Hello World"'
    ]);
  }
  if (name.includes('r ') || name === 'r' || name.includes(' r (')) {
    return withLineComments('#', [
      'R Hello World:',
      'print("Hello World")'
    ]);
  }
  if (name.includes('bash') || name.includes('shell')) {
    return withLineComments('#', [
      'Bash Hello World:',
      'echo "Hello World"'
    ]);
  }
  if (name.includes('sql')) {
    return withBlockComment('/*', '*/', [
      'SQL Hello World:',
      "SELECT 'Hello World';"
    ]);
  }
  if (name.includes('lua')) {
    return withBlockComment('--[[', '--]]', [
      'Lua Hello World:',
      'print("Hello World")'
    ]);
  }
  if (name.includes('haskell')) {
    return withBlockComment('{-', '-}', [
      'Haskell Hello World:',
      'main = putStrLn "Hello World"'
    ]);
  }
  if (name.includes('php')) {
    return withBlockComment('/*', '*/', [
      'PHP Hello World:',
      'echo "Hello World";'
    ]);
  }
  if (name.includes('go')) {
    return withBlockComment('/*', '*/', [
      'Go Hello World:',
      'package main',
      'import "fmt"',
      'func main() {',
      '  fmt.Println("Hello World")',
      '}'
    ]);
  }
  if (name.includes('rust')) {
    return withBlockComment('/*', '*/', [
      'Rust Hello World:',
      'fn main() {',
      '  println!("Hello World");',
      '}'
    ]);
  }
  if (name.includes('c#')) {
    return withBlockComment('/*', '*/', [
      'C# Hello World:',
      'using System;',
      'class Program {',
      '  static void Main() {',
      '    Console.WriteLine("Hello World");',
      '  }',
      '}'
    ]);
  }
  if (name.includes('kotlin')) {
    return withBlockComment('/*', '*/', [
      'Kotlin Hello World:',
      'fun main() {',
      '  println("Hello World")',
      '}'
    ]);
  }
  if (name.includes('swift')) {
    return withBlockComment('/*', '*/', [
      'Swift Hello World:',
      'import Foundation',
      'print("Hello World")'
    ]);
  }
  if (name.includes('scala')) {
    return withBlockComment('/*', '*/', [
      'Scala Hello World:',
      'object Main extends App {',
      '  println("Hello World")',
      '}'
    ]);
  }
  if (name.includes('java')) {
    return withBlockComment('/*', '*/', [
      'Java Hello World:',
      'public class Main {',
      '  public static void main(String[] args) {',
      '    System.out.println("Hello World");',
      '  }',
      '}'
    ]);
  }
  if (name.includes('javascript') || name.includes('nodejs')) {
    return withBlockComment('/*', '*/', [
      'JavaScript Hello World:',
      'console.log("Hello World");'
    ]);
  }
  if (name.includes('typescript')) {
    return withBlockComment('/*', '*/', [
      'TypeScript Hello World:',
      'const message: string = "Hello World";',
      'console.log(message);'
    ]);
  }
  if (name.includes('c++') || name.includes('clang')) {
    return withBlockComment('/*', '*/', [
      'C++ Hello World:',
      '#include <iostream>',
      'int main() {',
      '  std::cout << "Hello World" << std::endl;',
      '  return 0;',
      '}'
    ]);
  }
  if (name === 'c' || name.includes('c (gcc')) {
    return withBlockComment('/*', '*/', [
      'C Hello World:',
      '#include <stdio.h>',
      'int main() {',
      '  printf("Hello World\\n");',
      '  return 0;',
      '}'
    ]);
  }
  return withBlockComment('/*', '*/', [
    'Hello World:',
    'print("Hello World")'
  ]);
};

const buildInitialCode = (template: string, starterCode?: string | null) => {
  const starter = starterCode?.trim() ? `${starterCode.trim()}\n` : '';
  if (!template && !starter) return '';
  if (!template) return starter;
  return `${template}\n${starter}`.trimEnd() + '\n';
};

export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isReviewMode = useMemo(() => location.pathname.endsWith('/review'), [location.pathname]);

  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [currentTask, setCurrentTask] = useState<TaskType | null>(null);
  const [code, setCode] = useState('');
  const [codeByTaskId, setCodeByTaskId] = useState<Record<string, string>>({});
  const [outputByTaskId, setOutputByTaskId] = useState<Record<string, string>>({});
  const [isLoadingTask, setIsLoadingTask] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [examDetails, setExamDetails] = useState<Exam | null>(null);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [violations, setViolations] = useState(0);
  const [examStatus, setExamStatus] = useState<'wait_room' | 'waiting_start' | 'active' | 'paused' | 'completed' | 'withdrawn' | 'submitted'>('wait_room');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTaskList, setShowTaskList] = useState(true);
  const [showTaskDetails, setShowTaskDetails] = useState(true);
  const [showPdf, setShowPdf] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [leftWidth, setLeftWidth] = useState(33);
  const [outputHeight, setOutputHeight] = useState(220);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [defaultLanguageId, setDefaultLanguageId] = useState<number | null>(null);
  const [languageByTaskId, setLanguageByTaskId] = useState<Record<string, number>>({});
  const [autoTemplateByTaskId, setAutoTemplateByTaskId] = useState<Record<string, string>>({});
  const [languageError, setLanguageError] = useState('');

  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    autoSubmittedRef.current = false;
  }, [examId]);

  useEffect(() => {
    let isMounted = true;
    const loadLanguages = async () => {
      if (isReviewMode) return;
      try {
        const response = await api.get<{ languages: LanguageOption[]; defaultLanguageId: number | null }>('/judge0/languages');
        if (!isMounted) return;
        setLanguages(response.data.languages || []);
        setDefaultLanguageId(response.data.defaultLanguageId ?? null);
        setLanguageError('');
      } catch (err: any) {
        if (!isMounted) return;
        setLanguageError(err.response?.data?.error || 'Failed to load languages.');
      }
    };

    loadLanguages();
    return () => {
      isMounted = false;
    };
  }, [isReviewMode]);

  useEffect(() => {
    if (!defaultLanguageId || tasks.length === 0) return;
    setLanguageByTaskId((prev) => {
      const next = { ...prev };
      tasks.forEach((task) => {
        if (!next[task.id]) {
          next[task.id] = defaultLanguageId;
        }
      });
      return next;
    });
  }, [tasks, defaultLanguageId]);

  useEffect(() => {
    if (!defaultLanguageId || tasks.length === 0 || languages.length === 0) return;
    const defaultLanguageName = languages.find((lang) => lang.id === defaultLanguageId)?.name || null;
    const template = getCommentedHello(defaultLanguageName);
    if (!template) return;

    setCodeByTaskId((prev) => {
      let changed = false;
      const next = { ...prev };
      tasks.forEach((task) => {
        const current = (next[task.id] ?? '').trim();
        const starter = (task.starterCode ?? '').trim();
        const shouldReplace = !current || (starter && current === starter);
        if (shouldReplace) {
          next[task.id] = buildInitialCode(template, task.starterCode);
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setAutoTemplateByTaskId((prev) => {
      const next = { ...prev };
      tasks.forEach((task) => {
        next[task.id] = buildInitialCode(template, task.starterCode);
      });
      return next;
    });
  }, [tasks, defaultLanguageId, languages]);

  useEffect(() => {
    if (isReviewMode) {
      return;
    }
    if (examStatus === 'withdrawn') {
      const timeoutId = window.setTimeout(() => {
        alert('You have withdrawn from this exam.');
        navigate('/student');
      }, 800);
      return () => window.clearTimeout(timeoutId);
    }
    if (examStatus !== 'withdrawn' && examId) {
      localStorage.removeItem(`exam_withdrawn:${examId}`);
    }
  }, [examStatus, examId, isReviewMode, navigate]);

  useEffect(() => {
    if (isReviewMode) return;
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isReviewMode]);

  useEffect(() => {
    const handleWindowResize = () => {
      if (rightPanelRef.current) {
        const maxH = rightPanelRef.current.offsetHeight - 100;
        setOutputHeight((prev: number) => Math.min(Math.max(120, maxH), Math.max(120, prev)));
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const startDrag = (mode: 'vertical' | 'horizontal', _startX: number, startY: number) => {
    const snapOutputHeight = outputHeight;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = mode === 'vertical' ? 'col-resize' : 'row-resize';

    const onMouseMove = (ev: MouseEvent) => {
      ev.preventDefault();
      if (mode === 'vertical' && contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const percent = ((ev.clientX - rect.left) / rect.width) * 100;
        setLeftWidth(Math.min(60, Math.max(20, percent)));
      } else if (mode === 'horizontal') {
        const deltaY = ev.clientY - startY;
        const maxH = rightPanelRef.current ? rightPanelRef.current.offsetHeight - 100 : 600;
        setOutputHeight(Math.min(Math.max(120, maxH), Math.max(120, snapOutputHeight - deltaY)));
      }
    };

    const onMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const requestFullscreen = async () => {
    if (document.fullscreenElement || isReviewMode) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Ignore if browser blocks non-user-initiated fullscreen
    }
  };

  useEffect(() => {
    if (!examId || isReviewMode) return;

    connectSocket();
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

    return () => {
      socket.off('exam_state');
      socket.off('timer_sync');
      disconnectSocket();
    };
  }, [examId, isReviewMode]);

  useEffect(() => {
    if (isReviewMode) return;
    if (examStatus === 'active') {
      window.focus();
      requestFullscreen();
    }
  }, [examStatus, isReviewMode]);

  useEffect(() => {
    if (!currentTask) return;
    const nextCode = codeByTaskId[currentTask.id];
    if (!code.trim() && nextCode) {
      setCode(nextCode);
    }
  }, [currentTask, codeByTaskId, code]);

  useEffect(() => {
    if (!currentTask) return;
    const template = autoTemplateByTaskId[currentTask.id];
    if (!template) return;
    const starter = (currentTask.starterCode ?? '').trim();
    const current = (code ?? '').trim();
    if (!current || (starter && current === starter)) {
      setCode(template);
    }
  }, [currentTask, autoTemplateByTaskId, code]);

  useEffect(() => {
    let isMounted = true;

    const loadTasks = async () => {
      if (!examId) {
        setTaskError('Missing exam ID');
        setIsLoadingTask(false);
        return;
      }
      setIsLoadingTask(true);
      setTaskError('');
      try {
        const [examResponse, taskResponse, submissionsResponse] = await Promise.all([
          api.get<Exam>(`/exams/${examId}`),
          api.get<TaskType[]>(`/exams/${examId}/tasks`),
          api.get<Submission[]>(`/exams/${examId}/submissions`).catch(() => ({ data: [] as Submission[] }))
        ]);

        if (!isMounted) return;

        setExamDetails(examResponse.data);
        const status = examResponse.data.status || 'waiting_start';
        setExamStatus(status);
        if (status === 'submitted' && !isReviewMode) {
          navigate(`/exam/${examId}/review`);
        }
        if (status === 'withdrawn') {
          localStorage.setItem(`exam_withdrawn:${examId}`, 'true');
        } else {
          localStorage.removeItem(`exam_withdrawn:${examId}`);
        }
        if (typeof examResponse.data.remainingSeconds === 'number') {
          setTimeLeft(examResponse.data.remainingSeconds);
        } else if (status === 'active') {
          setTimeLeft(examResponse.data.durationMinutes * 60);
        } else {
          setTimeLeft(0);
        }

        const tasksData = taskResponse.data;
        const submissions = submissionsResponse.data || [];
        const submissionByTask = submissions.reduce<Record<string, Submission>>((acc, item) => {
          acc[item.taskId] = item;
          return acc;
        }, {});

        const nextCodeByTask: Record<string, string> = {};
        const nextOutputByTask: Record<string, string> = {};
        tasksData.forEach((task) => {
          const submission = submissionByTask[task.id];
          nextCodeByTask[task.id] = submission?.sourceCode || task.starterCode || '';
          nextOutputByTask[task.id] = submission?.output || '';
        });

        setTasks(tasksData);
        setCodeByTaskId(nextCodeByTask);
        setOutputByTaskId(nextOutputByTask);

        if (tasksData.length > 0) {
          const firstTask = tasksData[0];
          setCurrentTask(firstTask);
          setCode(nextCodeByTask[firstTask.id] || '');
          setOutput(nextOutputByTask[firstTask.id] || '');
        } else {
          setCurrentTask(null);
          setCode('');
          setOutput('');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setTaskError(err.response?.data?.error || 'Failed to load tasks');
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

  useEffect(() => {
    if (isReviewMode) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (examStatus !== 'active') {
          return prev;
        }
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [examStatus, isReviewMode]);

  const submitExam = async (options?: { silent?: boolean; reason?: string; redirect?: 'dashboard' | 'review' }) => {
    if (!examId || isReviewMode || autoSubmittedRef.current) return;
    if (examStatus === 'withdrawn' || examStatus === 'submitted') return;

    autoSubmittedRef.current = true;

    await Promise.all(
      tasks.map((task) => {
        const taskCode = codeByTaskId[task.id] ?? task.starterCode ?? '';
        const taskOutput = outputByTaskId[task.id] ?? '';
        return saveSubmission(task.id, taskCode, taskOutput);
      })
    );

    try {
      await logsService.logExecution(
        examId,
        code,
        options?.reason ? `Exam auto-submitted (${options.reason})` : 'Exam submitted',
        'SUCCESS'
      );
    } catch (err) {
      console.error('Failed to log submit:', err);
    }

    try {
      await api.post(`/exams/${examId}/submit`);
      setExamStatus('submitted');
      if (!options?.silent) {
        alert('Exam submitted.');
      }
      if (options?.redirect === 'review') {
        navigate(`/exam/${examId}/review`);
      } else {
        navigate('/student');
      }
    } catch (err) {
      console.error('Failed to submit exam:', err);
      autoSubmittedRef.current = false;
    }
  };

  useEffect(() => {
    if (isReviewMode) return;
    if (examStatus === 'completed') {
      void submitExam({ silent: true, reason: 'professor_end', redirect: 'review' });
    }
  }, [examStatus, isReviewMode]);

  useEffect(() => {
    if (isReviewMode) return;
    if (examStatus === 'active' && timeLeft === 0) {
      void submitExam({ silent: true, reason: 'time_expired', redirect: 'review' });
    }
  }, [examStatus, timeLeft, isReviewMode]);

  useEffect(() => {
    if (isReviewMode) return;
    const handleVisibilityChange = () => {
      if (document.hidden && examId) {
        setViolations((prev) => prev + 1);
        logsService.logSecurityEvent(examId, 'TAB_SWITCH', {
          timestamp: new Date().toISOString(),
          violations: violations + 1,
        });
        socket.emit('violation', { examId, type: 'tab_switch' });
      }
    };

    const handleBlur = () => {
      if (examId) {
        setViolations((prev) => prev + 1);
        logsService.logSecurityEvent(examId, 'BLUR', {
          timestamp: new Date().toISOString(),
        });
        socket.emit('violation', { examId, type: 'tab_blur' });
      }
    };

    const handleCopyPaste = (e: ClipboardEvent) => {
      if (examId && e.type === 'paste') {
        setViolations((prev) => prev + 1);
        logsService.logSecurityEvent(examId, 'COPY_PASTE', {
          timestamp: new Date().toISOString(),
          type: e.type,
        });
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
  }, [examId, violations, isReviewMode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRunCode = async () => {
    if (!currentTask || !examId || examStatus !== 'active' || isReviewMode) return;
    setIsRunning(true);
    setOutput('Compiling and running...\n');
    const currentCode = codeByTaskId[currentTask.id] ?? code;
    const selectedLanguageId = languageByTaskId[currentTask.id] ?? defaultLanguageId;

    if (!selectedLanguageId) {
      setOutput('Please select a language before running the code.');
      setIsRunning(false);
      return;
    }

    if (examId) {
      try {
        await logsService.logExecution(
          examId,
          currentCode,
          'Code executed',
          'RUNNING'
        );
      } catch (err) {
        console.error('Failed to log execution:', err);
      }
    }

    try {
      const response = await api.post(`/exams/${examId}/run`, {
        taskId: currentTask.id,
        sourceCode: currentCode,
        input: currentTask.exampleInput || '',
        languageId: selectedLanguageId
      });

      const result = response.data as { ok?: boolean; output?: string };
      const outputText = result?.output || 'Program finished with no output.';
      setOutput(outputText);
      setOutputByTaskId((prev) => ({ ...prev, [currentTask.id]: outputText }));

      if (examId) {
        await logsService.logExecution(
          examId,
          currentCode,
          outputText,
          result?.ok ? 'SUCCESS' : 'ERROR'
        );
      }
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to run code.';
      setOutput(message);
      if (examId) {
        await logsService.logExecution(
          examId,
          currentCode,
          message,
          'ERROR'
        );
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleSelectTask = (task: TaskType) => {
    setCurrentTask(task);
    setCode(codeByTaskId[task.id] || task.starterCode || '');
    setOutput(outputByTaskId[task.id] || '');
    if (!languageByTaskId[task.id] && defaultLanguageId) {
      setLanguageByTaskId((prev) => ({ ...prev, [task.id]: defaultLanguageId }));
    }
  };

  const saveSubmission = async (taskId: string, sourceCode: string, outputText: string) => {
    if (!examId) return;
    try {
      await api.post(`/exams/${examId}/submissions`, {
        taskId,
        sourceCode,
        output: outputText,
      });
    } catch (err) {
      console.error('Failed to save submission:', err);
    }
  };

  const handleSaveCode = async () => {
    if (!examId || !currentTask || examStatus !== 'active' || isReviewMode) return;
    setIsSaving(true);
    const currentCode = codeByTaskId[currentTask.id] ?? code;
    const currentOutput = outputByTaskId[currentTask.id] ?? output;
    try {
      await logsService.logExecution(
        examId,
        currentCode,
        'Code saved',
        'SUCCESS'
      );
      await saveSubmission(currentTask.id, currentCode, currentOutput);
      setOutput((prev) => (prev ? `${prev}
Code saved.` : 'Code saved.'));
    } catch (err) {
      console.error('Failed to save code:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!examId || !currentTask || examStatus !== 'active' || isReviewMode) {
      alert('Exam is not ready for submission.');
      return;
    }
    autoSubmittedRef.current = false;
    await submitExam({ silent: false, redirect: 'dashboard' });
  };

  const handleCancelExam = async () => {
    if (isReviewMode) return;
    if (!confirm('Are you sure you want to withdraw from this exam?')) return;
    if (examId) {
      try {
        await api.post(`/exams/${examId}/withdraw`);
      } catch (error) {
        console.error('Failed to withdraw:', error);
      } finally {
        localStorage.setItem(`exam_withdrawn:${examId}`, 'true');
        navigate('/student');
      }
    }
  };

  const currentLanguageId = currentTask
    ? languageByTaskId[currentTask.id] ?? defaultLanguageId
    : defaultLanguageId;
  const currentLanguageName = languages.find((lang) => lang.id === currentLanguageId)?.name || null;
  const monacoLanguage = getMonacoLanguage(currentLanguageName);

  const isExamLocked = examStatus !== 'active' || isReviewMode;

  return (
    <div className={`h-screen bg-gray-900 text-white flex flex-col overflow-hidden ${!isReviewMode ? 'pb-20 md:pb-0' : ''}`}
      ref={containerRef}
    >
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 shrink-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-indigo-400">Assessly</h1>
            <span className="text-gray-400">|</span>
            <span className="text-gray-300">{currentTask?.title || 'Exam'}</span>
            {examDetails && (
              <span className="text-gray-500 text-sm">({examDetails.subjectName})</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {violations > 0 && !isReviewMode && (
              <div className="flex items-center space-x-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{violations} warnings</span>
              </div>
            )}
            <div className="flex items-center space-x-3">
              <span className="text-xs uppercase tracking-wide text-gray-400">
                {examStatus === 'active' && 'Active'}
                {examStatus === 'paused' && 'Paused'}
                {examStatus === 'wait_room' && 'Not scheduled'}
                {examStatus === 'waiting_start' && 'Waiting for professor'}
                {examStatus === 'completed' && 'Completed'}
                {examStatus === 'submitted' && 'Submitted'}
                {examStatus === 'withdrawn' && 'Withdrawn'}
              </span>
              {!isReviewMode && (
                <div className={`text-lg font-mono ${timeLeft < 300 ? 'text-red-400' : 'text-green-400'}`}>
                  {formatTime(timeLeft)}
                </div>
              )}
            </div>
            <span className="text-gray-400">
              {user?.firstName} {user?.lastName}
            </span>
            {!isReviewMode && (
              <button
                type="button"
                onClick={requestFullscreen}
                className="px-3 py-2 text-xs border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
              >
                {isFullscreen ? 'Fullscreen on' : 'Fullscreen'}
              </button>
            )}
            {!isReviewMode && (
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={isExamLocked}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors"
                >
                  Submit exam
                </button>
                <button
                  onClick={handleCancelExam}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
                >
                  Withdraw
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!isReviewMode && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 px-4 py-3 flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={isExamLocked}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors"
          >
            Submit exam
          </button>
          <button
            onClick={handleCancelExam}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            Withdraw
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden" ref={contentRef}>
        <div
          className="bg-gray-800 border-r border-gray-700 p-4 overflow-y-auto"
          style={{ width: `${leftWidth}%`, flexShrink: 0 }}
        >
          {isExamLocked && !isReviewMode && (
            <div className="mb-4 rounded border border-yellow-600/40 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-200">
              {examStatus === 'wait_room' && 'Exam is not scheduled yet.'}
              {examStatus === 'waiting_start' && 'Waiting for the professor to start the exam.'}
              {examStatus === 'paused' && 'The exam is currently paused.'}
              {examStatus === 'completed' && 'The exam is completed.'}
              {examStatus === 'submitted' && 'You already submitted this exam.'}
            </div>
          )}
          {isReviewMode && (
            <div className="mb-4 rounded border border-blue-600/40 bg-blue-900/20 px-3 py-2 text-sm text-blue-200">
              Review mode: read-only view of your work.
            </div>
          )}
          <div className="mb-4 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300">
            <div className="mb-2 text-gray-400 uppercase tracking-wide">View</div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showTaskList} onChange={() => setShowTaskList((prev) => !prev)} />
                Tasks
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showTaskDetails} onChange={() => setShowTaskDetails((prev) => !prev)} />
                Details
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showPdf} onChange={() => setShowPdf((prev) => !prev)} />
                PDF
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showEditor} onChange={() => setShowEditor((prev) => !prev)} />
                Editor
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOutput} onChange={() => setShowOutput((prev) => !prev)} />
                Output
              </label>
            </div>
          </div>
          {showTaskList && tasks.length > 1 && (
            <div className="mb-4" style={{ resize: 'vertical', overflow: 'auto', minHeight: '6rem', maxHeight: '40vh' }}>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Tasks
              </h2>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => handleSelectTask(task)}
                    className={`w-full text-left px-3 py-2 rounded border text-sm ${
                      currentTask?.id === task.id
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200'
                        : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showTaskDetails && (
            <>
              <h2 className="text-lg font-semibold mb-4 text-indigo-400">Task</h2>
              <div className="prose prose-invert" style={{ resize: 'vertical', overflow: 'auto', minHeight: '10rem', maxHeight: '60vh' }}>
                {isLoadingTask && (
                  <div className="text-gray-400">Loading task...</div>
                )}
                {!isLoadingTask && taskError && (
                  <div className="text-red-400">{taskError}</div>
                )}
                {!isLoadingTask && !taskError && currentTask && (
                  <>
                    <h3 className="text-white text-xl mb-2">{currentTask.title}</h3>
                    <p className="text-gray-300 leading-relaxed">{currentTask.description}</p>
                    {showPdf && currentTask.pdfUrl && (
                      <div
                        className="mt-4 border border-gray-700 rounded-lg overflow-hidden bg-gray-900"
                        style={{ resize: 'vertical', overflow: 'auto', minHeight: '12rem', maxHeight: '60vh' }}
                      >
                        <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-700">
                          Task PDF
                        </div>
                        <iframe
                          src={currentTask.pdfUrl}
                          title="Task PDF"
                          className="w-full h-72"
                        />
                      </div>
                    )}
                  </>
                )}
                {!isLoadingTask && !taskError && !currentTask && (
                  <div className="text-gray-400">No tasks available.</div>
                )}

                {currentTask && (
                  <>
                    {(currentTask.exampleInput || currentTask.exampleOutput) && (
                      <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                        <h4 className="text-yellow-400 font-medium mb-2">Example input/output:</h4>
                        <pre className="text-sm text-gray-300 bg-gray-900 p-3 rounded whitespace-pre-wrap">
{`${currentTask.exampleInput ? `Input: ${currentTask.exampleInput}` : ''}${currentTask.exampleInput && currentTask.exampleOutput ? '\n' : ''}${currentTask.exampleOutput ? `Output: ${currentTask.exampleOutput}` : ''}`}
                        </pre>
                      </div>
                    )}

                    {currentTask.notes && (
                      <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
                        <h4 className="text-blue-400 font-medium mb-2">Notes:</h4>
                        <p className="text-gray-300 text-sm whitespace-pre-wrap">{currentTask.notes}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div
          className="w-2 bg-gray-700 cursor-col-resize hover:bg-indigo-500 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startDrag('vertical', e.clientX, e.clientY);
          }}
        />
        <div className="flex-1 flex flex-col overflow-hidden" ref={rightPanelRef}>
          {showEditor && (
            <div className="flex-1 border-b border-gray-700 min-h-0 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400">
                  <span>Language</span>
                  <select
                    className="bg-gray-900 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1"
                    value={currentLanguageId ?? ''}
                    onChange={(event) => {
                      const nextId = Number(event.target.value);
                      if (currentTask && Number.isFinite(nextId)) {
                        setLanguageByTaskId((prev) => ({ ...prev, [currentTask.id]: nextId }));
                        const nextName = languages.find((lang) => lang.id === nextId)?.name || null;
                        const template = getCommentedHello(nextName);
                        const currentCode = codeByTaskId[currentTask.id] ?? code;
                        const previousTemplate = autoTemplateByTaskId[currentTask.id];
                        if (template && (!currentCode.trim() || currentCode === previousTemplate)) {
                          const nextCode = buildInitialCode(template, currentTask.starterCode);
                          setCode(nextCode);
                          setCodeByTaskId((prev) => ({ ...prev, [currentTask.id]: nextCode }));
                          setAutoTemplateByTaskId((prev) => ({ ...prev, [currentTask.id]: nextCode }));
                        }
                      }
                    }}
                    disabled={!languages.length || isExamLocked || !currentTask}
                  >
                    {!languages.length && (
                      <option value="">Loading...</option>
                    )}
                    {languages.map((lang) => (
                      <option key={lang.id} value={lang.id}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  {languageError && (
                    <span className="text-red-400 normal-case">{languageError}</span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  language={monacoLanguage}
                  theme="vs-dark"
                  value={code}
                  onChange={(value) => {
                    const next = value || '';
                    setCode(next);
                    if (currentTask) {
                      setCodeByTaskId((prev) => ({ ...prev, [currentTask.id]: next }));
                    }
                  }}
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
            </div>
          )}

          {showEditor && showOutput && (
            <div
              className="h-2 bg-gray-800 cursor-row-resize hover:bg-indigo-500 transition-colors"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startDrag('horizontal', event.clientX, event.clientY);
              }}
            />
          )}

          {showOutput && (
            <div
              className="bg-gray-900 border-t border-gray-700"
              style={{ height: `${outputHeight}px`, flexShrink: 0 }}
            >
              <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                <span className="text-sm font-medium text-gray-400">Output</span>
                {!isReviewMode && (
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
                      {isSaving ? 'Saving...' : 'Save'}
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
                      {isRunning ? 'Running...' : 'Run code (F5)'}
                    </button>
                  </div>
                )}
              </div>
              <pre className="p-4 text-sm text-gray-300 font-mono overflow-auto h-full">
                {output || 'Click "Run code" to see output...'}
              </pre>
            </div>
          )}
          {!showEditor && !showOutput && (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
              Editor and output are hidden in view settings.
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel - only show during active exam and not in review mode */}
      {examId && !isReviewMode && (examStatus === 'active' || examStatus === 'waiting_start') && (
        <ExamChatPanel examId={examId} isProfessor={false} />
      )}
    </div>
  );
}
