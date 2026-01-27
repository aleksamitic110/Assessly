import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { gradeApi, commentsApi } from '../services/api';
import type { Exam, Submission, ExamComment, Grade, Task } from '../types';

export default function StudentWorkView() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exam, setExam] = useState<Exam | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [comments, setComments] = useState<ExamComment[]>([]);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Load data
  const loadData = useCallback(async () => {
    if (!examId || !user?.id) return;
    setIsLoading(true);
    setError('');
    try {
      const [examRes, tasksRes, submissionsRes, commentsRes, gradeRes] = await Promise.all([
        api.get<Exam>(`/exams/${examId}`),
        api.get<Task[]>(`/exams/${examId}/tasks`),
        api.get<Submission[]>(`/exams/${examId}/submissions`),
        commentsApi.getComments(examId, user.id),
        gradeApi.getGrade(examId, user.id)
      ]);
      setExam(examRes.data);
      setTasks(tasksRes.data);
      setSubmissions(submissionsRes.data);
      setComments(commentsRes.data);
      setGrade(gradeRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [examId, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const currentSubmission = submissions[selectedTaskIndex];
  const currentTask = tasks.find(t => t.id === currentSubmission?.taskId);

  // Get comments for the current line
  const getLineComments = (lineNum: number) => {
    return comments.filter(c => c.line === lineNum);
  };

  // General comments (no line number)
  const generalComments = comments.filter(c => c.line === null);

  // Render code with line numbers and comments
  const renderCode = (code: string) => {
    const lines = code.split('\n');

    return (
      <div className="font-mono text-sm">
        {lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineComments = getLineComments(lineNum);
          return (
            <div key={idx}>
              <div className="flex hover:bg-gray-700">
                <span className="w-12 text-right pr-3 text-gray-500 select-none border-r border-gray-700">
                  {lineNum}
                </span>
                <pre className="flex-1 pl-3 whitespace-pre-wrap break-all text-gray-200">{line || ' '}</pre>
              </div>
              {lineComments.map(comment => (
                <div
                  key={comment.commentId}
                  className="ml-12 pl-3 py-2 bg-yellow-900/30 border-l-4 border-yellow-500 text-sm"
                >
                  <span className="font-medium text-yellow-400">
                    {comment.authorName}:
                  </span>
                  <span className="ml-2 text-gray-300">{comment.message}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading your work...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 shadow border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-indigo-400">
              {exam?.name || 'Exam Review'}
            </h1>
            <p className="text-sm text-gray-400">
              {exam?.subjectName} - Your Submission
            </p>
          </div>
          <div className="flex items-center gap-4">
            {grade && (
              <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-2">
                <div className="text-2xl font-bold text-green-400">
                  {grade.value}
                </div>
                <div className="text-xs text-gray-400">Your Grade</div>
              </div>
            )}
            <button
              onClick={() => navigate('/student')}
              className="px-4 py-2 text-sm font-medium text-gray-300 border border-gray-600 rounded-lg hover:bg-gray-700"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Grade Comment */}
        {grade?.comment && (
          <div className="mb-6 bg-indigo-900/30 border border-indigo-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-indigo-400 mb-2">Professor's Comment</h3>
            <p className="text-gray-300">{grade.comment}</p>
          </div>
        )}

        {/* General Comments */}
        {generalComments.length > 0 && (
          <div className="mb-6 bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-yellow-400 mb-3">General Feedback</h3>
            <div className="space-y-2">
              {generalComments.map(comment => (
                <div key={comment.commentId} className="text-gray-300">
                  <span className="font-medium text-yellow-300">{comment.authorName}:</span>
                  <span className="ml-2">{comment.message}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Task Tabs */}
        {submissions.length > 0 ? (
          <div className="bg-gray-800 rounded-lg shadow border border-gray-700">
            <div className="border-b border-gray-700">
              <nav className="flex overflow-x-auto">
                {submissions.map((sub, idx) => (
                  <button
                    key={sub.taskId}
                    onClick={() => setSelectedTaskIndex(idx)}
                    className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
                      selectedTaskIndex === idx
                        ? 'border-b-2 border-indigo-500 text-indigo-400 bg-gray-700/50'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {sub.taskTitle || `Task ${idx + 1}`}
                  </button>
                ))}
              </nav>
            </div>

            {/* Code Display */}
            <div className="p-4">
              {currentSubmission ? (
                <div>
                  <h4 className="text-lg font-semibold text-white mb-3">
                    {currentSubmission.taskTitle}
                  </h4>

                  {/* Task Description */}
                  {currentTask && (
                    <div className="mb-4 p-4 bg-blue-900/20 rounded-lg border border-blue-800">
                      <h5 className="text-sm font-semibold text-blue-300 mb-2">
                        Task Description
                      </h5>
                      {currentTask.description && (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap mb-3">
                          {currentTask.description}
                        </p>
                      )}

                      {/* Example Input/Output */}
                      {(currentTask.exampleInput || currentTask.exampleOutput) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          {currentTask.exampleInput && (
                            <div>
                              <span className="text-xs font-medium text-blue-400">Example Input:</span>
                              <pre className="mt-1 p-2 bg-gray-900 rounded text-xs font-mono overflow-x-auto text-gray-300">
                                {currentTask.exampleInput}
                              </pre>
                            </div>
                          )}
                          {currentTask.exampleOutput && (
                            <div>
                              <span className="text-xs font-medium text-blue-400">Example Output:</span>
                              <pre className="mt-1 p-2 bg-gray-900 rounded text-xs font-mono overflow-x-auto text-gray-300">
                                {currentTask.exampleOutput}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Notes */}
                      {currentTask.notes && (
                        <div className="mb-3">
                          <span className="text-xs font-medium text-blue-400">Notes:</span>
                          <p className="mt-1 text-sm text-gray-400">{currentTask.notes}</p>
                        </div>
                      )}

                      {/* PDF Link */}
                      {currentTask.pdfUrl && (
                        <a
                          href={currentTask.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-300 bg-blue-900/50 rounded hover:bg-blue-900"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          View Task PDF
                        </a>
                      )}
                    </div>
                  )}

                  {/* Student Code */}
                  <h5 className="text-sm font-semibold text-gray-400 mb-2">Your Code</h5>
                  {currentSubmission.sourceCode ? (
                    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                      <div className="max-h-[500px] overflow-y-auto">
                        {renderCode(currentSubmission.sourceCode)}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-500">
                      No code submitted for this task.
                    </div>
                  )}

                  {/* Output */}
                  {currentSubmission.output && (
                    <div className="mt-4">
                      <h5 className="text-sm font-medium text-gray-400 mb-2">Output:</h5>
                      <pre className="bg-gray-900 border border-gray-700 p-3 rounded text-sm text-gray-300 overflow-x-auto">
                        {currentSubmission.output}
                      </pre>
                    </div>
                  )}

                  {/* Last Updated */}
                  {currentSubmission.updatedAt && (
                    <div className="mt-4 text-xs text-gray-500">
                      Last updated: {new Date(currentSubmission.updatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  No submission data available.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500">
            No submissions found for this exam.
          </div>
        )}

        {/* Line Comments Summary */}
        {comments.filter(c => c.line !== null).length > 0 && (
          <div className="mt-6 bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-yellow-400 mb-3">
              Line-by-Line Feedback ({comments.filter(c => c.line !== null).length})
            </h3>
            <div className="space-y-2">
              {comments
                .filter(c => c.line !== null)
                .sort((a, b) => (a.line || 0) - (b.line || 0))
                .map(comment => (
                  <div key={comment.commentId} className="text-sm p-2 bg-gray-800 rounded">
                    <span className="font-medium text-yellow-400">Line {comment.line}:</span>
                    <span className="ml-2 text-gray-300">{comment.message}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({comment.authorName})
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
