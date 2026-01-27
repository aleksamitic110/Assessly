import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { gradeApi, commentsApi } from '../services/api';
import type { ExamStudent, Submission, ExamComment, Exam, Task } from '../types';

export default function ProfessorReviewPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exam, setExam] = useState<Exam | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [students, setStudents] = useState<ExamStudent[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<ExamStudent | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [comments, setComments] = useState<ExamComment[]>([]);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [error, setError] = useState('');

  // Grade form
  const [gradeValue, setGradeValue] = useState<number>(0);
  const [gradeComment, setGradeComment] = useState('');
  const [isSavingGrade, setIsSavingGrade] = useState(false);

  // Comment form
  const [newCommentLine, setNewCommentLine] = useState<string>('');
  const [newCommentMessage, setNewCommentMessage] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [isUpdatingComment, setIsUpdatingComment] = useState(false);

  // Load exam, tasks, and students
  const loadData = useCallback(async () => {
    if (!examId) return;
    setIsLoading(true);
    setError('');
    try {
      const [examRes, tasksRes, studentsRes] = await Promise.all([
        api.get<Exam>(`/exams/${examId}`),
        api.get<Task[]>(`/exams/${examId}/tasks`),
        gradeApi.getExamStudents(examId)
      ]);
      setExam(examRes.data);
      setTasks(tasksRes.data);
      setStudents(studentsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load student submissions and comments
  const loadStudentData = useCallback(async (student: ExamStudent) => {
    if (!examId) return;
    setIsLoadingSubmissions(true);
    setSelectedStudent(student);
    setSelectedTaskIndex(0);
    try {
      const [submissionsRes, commentsRes] = await Promise.all([
        gradeApi.getStudentSubmissions(examId, student.studentId),
        commentsApi.getComments(examId, student.studentId)
      ]);
      setSubmissions(submissionsRes.data);
      setComments(commentsRes.data);

      // Set grade form values
      if (student.grade) {
        setGradeValue(student.grade.value);
        setGradeComment(student.grade.comment || '');
      } else {
        setGradeValue(0);
        setGradeComment('');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load student data');
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [examId]);

  // Save grade
  const handleSaveGrade = async () => {
    if (!examId || !selectedStudent) return;
    if (gradeValue < 5 || gradeValue > 10) {
      setError('Ocena mora biti izmedju 5 i 10.');
      return;
    }
    setIsSavingGrade(true);
    setError('');
    try {
      await gradeApi.setGrade(examId, selectedStudent.studentId, gradeValue, gradeComment);
      // Update local state
      setStudents(prev => prev.map(s =>
        s.studentId === selectedStudent.studentId
          ? { ...s, grade: { value: gradeValue, comment: gradeComment, updatedAt: new Date().toISOString() } }
          : s
      ));
      setSelectedStudent(prev => prev ? {
        ...prev,
        grade: { value: gradeValue, comment: gradeComment, updatedAt: new Date().toISOString() }
      } : null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save grade');
    } finally {
      setIsSavingGrade(false);
    }
  };

  // Add comment
  const handleAddComment = async () => {
    if (!examId || !selectedStudent || !newCommentMessage.trim()) return;
    setIsSavingComment(true);
    setError('');
    try {
      // Parse line number properly - only send if it's a valid positive integer
      let line: number | null = null;
      if (newCommentLine.trim()) {
        const parsed = parseInt(newCommentLine.trim(), 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          line = parsed;
        }
      }
      const maxLines = currentSubmission?.sourceCode
        ? currentSubmission.sourceCode.split('\n').length
        : 0;
      if (line && maxLines && line > maxLines) {
        setError(`Line number must be between 1 and ${maxLines}.`);
        return;
      }

      const res = await commentsApi.addComment(examId, selectedStudent.studentId, line, newCommentMessage.trim());
      setComments(prev => [...prev, res.data]);
      setNewCommentLine('');
      setNewCommentMessage('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add comment');
    } finally {
      setIsSavingComment(false);
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId: string) => {
    if (!examId || !selectedStudent) return;
    try {
      await commentsApi.deleteComment(examId, selectedStudent.studentId, commentId);
      setComments(prev => prev.filter(c => c.commentId !== commentId));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete comment');
    }
  };

  const handleEditComment = async (comment: ExamComment) => {
    if (!examId || !selectedStudent) return;
    const newMessage = prompt('Edit comment:', comment.message || '');
    if (newMessage === null) return;
    const newLineInput = prompt('Line number (optional):', comment.line ? String(comment.line) : '');
    let newLine: number | null = null;
    if (newLineInput && newLineInput.trim()) {
      const parsed = parseInt(newLineInput.trim(), 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        newLine = parsed;
      }
    }

    const maxLines = currentSubmission?.sourceCode
      ? currentSubmission.sourceCode.split('\n').length
      : 0;
    if (newLine && maxLines && newLine > maxLines) {
      setError(`Line number must be between 1 and ${maxLines}.`);
      return;
    }

    setIsUpdatingComment(true);
    setError('');
    try {
      const res = await commentsApi.updateComment(examId, selectedStudent.studentId, comment.commentId, newLine, newMessage.trim());
      setComments(prev => prev.map(c => (c.commentId === comment.commentId ? res.data : c)));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update comment');
    } finally {
      setIsUpdatingComment(false);
    }
  };

  const currentSubmission = submissions[selectedTaskIndex];
  const maxLineCount = currentSubmission?.sourceCode ? currentSubmission.sourceCode.split('\n').length : 0;

  // Get the task details for the current submission
  const currentTask = tasks.find(t => t.id === currentSubmission?.taskId);

  // Render code with line numbers
  const renderCode = (code: string) => {
    const lines = code.split('\n');
    const lineComments = comments.filter(c => c.line !== null);

    return (
      <div className="font-mono text-sm">
        {lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineComment = lineComments.find(c => c.line === lineNum);
          return (
            <div key={idx}>
              <div className="flex hover:bg-gray-100 dark:hover:bg-gray-700">
                <span className="w-12 text-right pr-3 text-gray-400 select-none border-r border-gray-300 dark:border-gray-600">
                  {lineNum}
                </span>
                <pre className="flex-1 pl-3 whitespace-pre-wrap break-all">{line || ' '}</pre>
              </div>
                  {lineComment && (
                    <div className="ml-12 pl-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-medium text-yellow-700 dark:text-yellow-300">
                            {lineComment.authorName}:
                          </span>
                          <span className="ml-2 text-gray-700 dark:text-gray-300">{lineComment.message}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditComment(lineComment)}
                            className="text-xs text-blue-500 hover:text-blue-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteComment(lineComment.commentId)}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              Review: {exam?.name || 'Exam'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {exam?.subjectName}
            </p>
          </div>
          <button
            onClick={() => navigate('/professor')}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-sm underline">Dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Student List */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Students ({students.length})
              </h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {students.length === 0 ? (
                  <p className="text-sm text-gray-500">No submissions yet.</p>
                ) : (
                  students.map(student => (
                    <button
                      key={student.studentId}
                      onClick={() => loadStudentData(student)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedStudent?.studentId === student.studentId
                          ? 'bg-indigo-100 dark:bg-indigo-900 border-indigo-500'
                          : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">
                        {student.firstName} {student.lastName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {student.email}
                      </div>
                      {student.grade && (
                        <div className="mt-1 text-sm font-semibold text-green-600 dark:text-green-400">
                          Grade: {student.grade.value}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {!selectedStudent ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-500 dark:text-gray-400">
                Select a student to review their work
              </div>
            ) : isLoadingSubmissions ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center text-gray-500 dark:text-gray-400">
                Loading submissions...
              </div>
            ) : (
              <div className="space-y-6">
                {/* Student Info & Grade */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <div className="flex flex-wrap justify-between items-start gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                        {selectedStudent.firstName} {selectedStudent.lastName}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedStudent.email}
                      </p>
                      {selectedStudent.submittedAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Submitted: {new Date(selectedStudent.submittedAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    {/* Grade Form */}
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Grade</label>
                        <input
                          type="number"
                          min="5"
                          max="10"
                          value={gradeValue}
                          onChange={(e) => setGradeValue(Number(e.target.value))}
                          className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Comment</label>
                        <input
                          type="text"
                          value={gradeComment}
                          onChange={(e) => setGradeComment(e.target.value)}
                          placeholder="General comment..."
                          className="w-48 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <button
                        onClick={handleSaveGrade}
                        disabled={isSavingGrade}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {isSavingGrade ? 'Saving...' : 'Save Grade'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Task Tabs */}
                {submissions.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                    <div className="border-b border-gray-200 dark:border-gray-700">
                      <nav className="flex overflow-x-auto">
                        {submissions.map((sub, idx) => (
                          <button
                            key={sub.taskId}
                            onClick={() => setSelectedTaskIndex(idx)}
                            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
                              selectedTaskIndex === idx
                                ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {sub.taskTitle || `Task ${idx + 1}`}
                          </button>
                        ))}
                      </nav>
                    </div>

                    {/* Task Details & Code Display */}
                    <div className="p-4">
                      {currentSubmission ? (
                        <div>
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                            {currentSubmission.taskTitle}
                          </h4>

                          {/* Task Description */}
                          {currentTask && (
                            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                              <h5 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                Task Description
                              </h5>
                              {currentTask.description && (
                                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-3">
                                  {currentTask.description}
                                </p>
                              )}

                              {/* Example Input/Output */}
                              {(currentTask.exampleInput || currentTask.exampleOutput) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                                  {currentTask.exampleInput && (
                                    <div>
                                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Example Input:</span>
                                      <pre className="mt-1 p-2 bg-white dark:bg-gray-800 rounded text-xs font-mono overflow-x-auto">
                                        {currentTask.exampleInput}
                                      </pre>
                                    </div>
                                  )}
                                  {currentTask.exampleOutput && (
                                    <div>
                                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Example Output:</span>
                                      <pre className="mt-1 p-2 bg-white dark:bg-gray-800 rounded text-xs font-mono overflow-x-auto">
                                        {currentTask.exampleOutput}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Notes */}
                              {currentTask.notes && (
                                <div className="mb-3">
                                  <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Notes:</span>
                                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{currentTask.notes}</p>
                                </div>
                              )}

                              {/* PDF Link */}
                              {currentTask.pdfUrl && (
                                <a
                                  href={currentTask.pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 rounded hover:bg-blue-200 dark:hover:bg-blue-900"
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
                          <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Student's Code
                          </h5>
                          {currentSubmission.sourceCode ? (
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                              <div className="max-h-[400px] overflow-y-auto">
                                {renderCode(currentSubmission.sourceCode)}
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                              No code submitted for this task.
                            </p>
                          )}

                          {/* Output */}
                          {currentSubmission.output && (
                            <div className="mt-4">
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Output:</h5>
                              <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-sm overflow-x-auto border border-gray-200 dark:border-gray-700">
                                {currentSubmission.output}
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-gray-500">No submission data available.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Comments Section */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Add Feedback
                  </h4>

                  {/* Add Comment Form */}
                  <div className="flex gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Line # (optional){maxLineCount ? ` / max ${maxLineCount}` : ''}
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={maxLineCount || undefined}
                        value={newCommentLine}
                        onChange={(e) => setNewCommentLine(e.target.value)}
                        placeholder="Line"
                        className="w-20 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Comment</label>
                      <input
                        type="text"
                        value={newCommentMessage}
                        onChange={(e) => setNewCommentMessage(e.target.value)}
                        placeholder="Enter your feedback..."
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={handleAddComment}
                        disabled={isSavingComment || !newCommentMessage.trim()}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {isSavingComment ? 'Adding...' : 'Add Comment'}
                      </button>
                    </div>
                  </div>

                  {/* General comments (no line number) */}
                  <div className="space-y-2">
                    <h5 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      General Comments ({comments.filter(c => c.line === null).length})
                    </h5>
                    {comments
                      .filter(c => c.line === null)
                      .map(comment => (
                        <div
                          key={comment.commentId}
                          className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {comment.authorName}
                              </span>
                              <span className="ml-2 text-xs text-gray-500">
                                {new Date(comment.createdAt).toLocaleString()}
                              </span>
                              <p className="mt-1 text-gray-700 dark:text-gray-300">
                                {comment.message}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleEditComment(comment)}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteComment(comment.commentId)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    {comments.filter(c => c.line === null).length === 0 && (
                      <p className="text-sm text-gray-500 italic">No general comments yet. Add one above.</p>
                    )}
                  </div>

                  {/* Line comments summary */}
                  {comments.filter(c => c.line !== null).length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h5 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                        Line Comments ({comments.filter(c => c.line !== null).length})
                      </h5>
                      <div className="space-y-1">
                        {comments
                          .filter(c => c.line !== null)
                          .sort((a, b) => (a.line || 0) - (b.line || 0))
                          .map(comment => (
                            <div
                              key={comment.commentId}
                              className="flex items-center justify-between text-sm p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded"
                            >
                              <div>
                                <span className="font-medium text-yellow-700 dark:text-yellow-400">
                                  Line {comment.line}:
                                </span>
                                <span className="ml-2 text-gray-700 dark:text-gray-300">
                                  {comment.message}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditComment(comment)}
                                  className="text-xs text-blue-500 hover:text-blue-700"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteComment(comment.commentId)}
                                  className="text-xs text-red-500 hover:text-red-700"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
