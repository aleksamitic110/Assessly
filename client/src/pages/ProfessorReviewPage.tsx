import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { gradeApi, commentsApi } from '../services/api';
import type { ExamStudent, Submission, ExamComment, Exam, Task } from '../types';

// Icons
const Icons = {
  Back: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>,
  User: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  Check: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  Trash: () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
};

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

  // Interaction State
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  // Load exam data
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

  // Load specific student data
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

  // Computed Values
  const currentSubmission = submissions[selectedTaskIndex];
  const currentTask = tasks.find(t => t.id === currentSubmission?.taskId);
  const maxLines = currentSubmission?.sourceCode ? currentSubmission.sourceCode.split('\n').length : 0;

  const commentsByLine = useMemo(() => {
    const map: Record<number, ExamComment[]> = {};
    comments.forEach(c => {
      if (c.line) {
        if (!map[c.line]) map[c.line] = [];
        map[c.line].push(c);
      }
    });
    return map;
  }, [comments]);

  const generalComments = comments.filter(c => c.line === null);

  // --- Handlers ---

  const handleLineClick = (lineNum: number) => {
    setActiveLine(lineNum);
    setNewCommentLine(String(lineNum)); // Auto-fill form
  };

  const handleSaveGrade = async () => {
    if (!examId || !selectedStudent) return;
    setIsSavingGrade(true);
    try {
      await gradeApi.setGrade(examId, selectedStudent.studentId, gradeValue, gradeComment);
      
      const updatedGrade = { value: gradeValue, comment: gradeComment, updatedAt: new Date().toISOString() };
      setStudents(prev => prev.map(s => s.studentId === selectedStudent.studentId ? { ...s, grade: updatedGrade } : s));
      setSelectedStudent(prev => prev ? { ...prev, grade: updatedGrade } : null);
    } catch { setError('Failed to save grade'); } 
    finally { setIsSavingGrade(false); }
  };

  const handleAddComment = async () => {
    if (!examId || !selectedStudent || !newCommentMessage.trim()) return;
    setIsSavingComment(true);
    try {
      const line = newCommentLine.trim() ? parseInt(newCommentLine.trim(), 10) : null;
      const res = await commentsApi.addComment(examId, selectedStudent.studentId, line, newCommentMessage.trim());
      setComments(prev => [...prev, res.data]);
      setNewCommentMessage('');
      if(!activeLine) setNewCommentLine('');
    } catch { setError('Failed to add comment'); } 
    finally { setIsSavingComment(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!examId || !selectedStudent) return;
    try {
      await commentsApi.deleteComment(examId, selectedStudent.studentId, commentId);
      setComments(prev => prev.filter(c => c.commentId !== commentId));
    } catch { setError('Failed to delete comment'); }
  };

  if (isLoading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">Loading...</div>;

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-100 font-sans overflow-hidden">
      
      {/* Header */}
      <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/professor')} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"><Icons.Back /></button>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">{exam?.name || 'Exam Review'}</h1>
            <span className="text-xs text-gray-400">{exam?.subjectName}</span>
          </div>
        </div>
        {selectedStudent && (
          <div className="flex items-center gap-3 bg-gray-700/50 px-3 py-1.5 rounded-full border border-gray-600">
            <Icons.User />
            <span className="text-sm font-medium">{selectedStudent.firstName} {selectedStudent.lastName}</span>
            {selectedStudent.grade && <span className={`text-xs font-bold px-2 py-0.5 rounded ${selectedStudent.grade.value === 5 ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>{selectedStudent.grade.value}</span>}
          </div>
        )}
      </header>

      {/* Main Layout - 3 Columns */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT: Student List */}
        <aside className="w-64 bg-gray-850 border-r border-gray-700 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-700 font-semibold text-gray-300">Students ({students.length})</div>
          <div className="flex-1 overflow-y-auto">
            {students.map(student => (
              <button
                key={student.studentId}
                onClick={() => loadStudentData(student)}
                className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors flex justify-between items-center ${selectedStudent?.studentId === student.studentId ? 'bg-indigo-900/20 border-l-4 border-l-indigo-500' : ''}`}
              >
                <div>
                  <div className="text-sm font-medium text-gray-200">{student.firstName} {student.lastName}</div>
                  <div className="text-xs text-gray-500 truncate w-40">{student.email}</div>
                </div>
                {student.grade && (
                  <span className={`text-xs font-bold ${student.grade.value === 5 ? 'text-red-400' : 'text-green-400'}`}>{student.grade.value}</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* MIDDLE: Code Viewer */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
          {selectedStudent ? (
            <>
              {/* Task Tabs */}
              <div className="flex overflow-x-auto border-b border-gray-700 bg-gray-800 scrollbar-hide">
                {submissions.length > 0 ? submissions.map((sub, idx) => (
                  <button
                    key={sub.taskId}
                    onClick={() => { setSelectedTaskIndex(idx); setActiveLine(null); }}
                    className={`px-4 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${selectedTaskIndex === idx ? 'border-indigo-500 text-indigo-400 bg-gray-700/50' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                  >
                    {sub.taskTitle || `Task ${idx + 1}`}
                  </button>
                )) : <div className="px-4 py-3 text-xs text-gray-500">No submissions</div>}
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-y-auto font-mono text-sm relative">
                {currentSubmission?.sourceCode ? (
                  <div className="min-h-full pb-20">
                    {currentSubmission.sourceCode.split('\n').map((line, idx) => {
                      const lineNum = idx + 1;
                      const hasComments = commentsByLine[lineNum]?.length > 0;
                      const isActive = activeLine === lineNum;

                      return (
                        <div 
                          key={idx} 
                          className={`group flex relative cursor-pointer ${isActive ? 'bg-indigo-900/20' : 'hover:bg-gray-800'}`}
                          onClick={() => handleLineClick(lineNum)}
                          onMouseEnter={() => setHoverLine(lineNum)}
                          onMouseLeave={() => setHoverLine(null)}
                        >
                          <div className={`w-12 text-right pr-3 select-none border-r border-gray-700 ${hasComments ? 'text-yellow-500 font-bold bg-yellow-900/10' : 'text-gray-600 group-hover:text-gray-400'}`}>
                            {lineNum}
                          </div>
                          <div className="flex-1 pl-4 pr-4 whitespace-pre-wrap break-all text-gray-300 py-[1px]">
                            {line || <br/>}
                          </div>
                          {hasComments && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                              <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <p>No code submitted for this task.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">Select a student to start reviewing.</div>
          )}
        </div>

        {/* RIGHT: Grading & Feedback Sidebar */}
        <aside className="w-[350px] bg-gray-800 border-l border-gray-700 flex flex-col shrink-0">
          {selectedStudent ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              
              {/* Grading Box */}
              <div className="bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                <h3 className="text-xs font-bold text-gray-400 uppercase mb-3">Assessment</h3>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="w-20">
                      <label className="text-[10px] text-gray-500 mb-1 block">Grade</label>
                      <input 
                        type="number" min="5" max="10" 
                        value={gradeValue} onChange={e => setGradeValue(Number(e.target.value))}
                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-center font-bold" 
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 mb-1 block">Summary</label>
                      <input 
                        type="text" 
                        value={gradeComment} onChange={e => setGradeComment(e.target.value)}
                        placeholder="Very good work..."
                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm" 
                      />
                    </div>
                  </div>
                  <button 
                    onClick={handleSaveGrade} 
                    disabled={isSavingGrade}
                    className="w-full py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded shadow-sm"
                  >
                    {isSavingGrade ? 'Saving...' : 'Save Grade'}
                  </button>
                </div>
              </div>

              {/* Add Feedback Form */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex justify-between">
                  <span>Feedback</span>
                  {activeLine && <button onClick={() => setActiveLine(null)} className="text-[10px] text-indigo-400 hover:underline">Clear Line Selection</button>}
                </h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      placeholder="Line #" 
                      value={newCommentLine} onChange={e => setNewCommentLine(e.target.value)}
                      className={`w-20 bg-gray-900 border rounded px-2 py-1.5 text-sm ${activeLine ? 'border-indigo-500 text-indigo-400' : 'border-gray-600'}`}
                    />
                    <input 
                      type="text" 
                      placeholder="Add comment..." 
                      value={newCommentMessage} onChange={e => setNewCommentMessage(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                      className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm" 
                    />
                  </div>
                  <button 
                    onClick={handleAddComment}
                    disabled={!newCommentMessage.trim()}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded shadow-sm disabled:opacity-50"
                  >
                    Add Comment
                  </button>
                </div>
              </div>

              {/* Comments List */}
              <div className="space-y-4">
                {/* Active Line Filter */}
                {activeLine !== null && (
                  <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3">
                    <div className="text-xs font-bold text-indigo-400 mb-2">Comments on Line {activeLine}</div>
                    {commentsByLine[activeLine]?.length > 0 ? (
                      <div className="space-y-2">
                        {commentsByLine[activeLine].map(c => (
                          <div key={c.commentId} className="bg-gray-800 p-2 rounded text-sm relative group">
                            <p className="text-gray-300 pr-4">{c.message}</p>
                            <button onClick={() => handleDeleteComment(c.commentId)} className="absolute top-2 right-2 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100"><Icons.Trash /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-xs text-gray-500 italic">No comments on this line yet.</p>}
                  </div>
                )}

                {/* General Comments */}
                {generalComments.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase mb-2">General</div>
                    <div className="space-y-2">
                      {generalComments.map(c => (
                        <div key={c.commentId} className="bg-gray-700/30 p-2 rounded border border-gray-700 text-sm relative group">
                          <p className="text-gray-300 pr-4">{c.message}</p>
                          <button onClick={() => handleDeleteComment(c.commentId)} className="absolute top-2 right-2 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100"><Icons.Trash /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All Line Comments (if no specific line selected) */}
                {activeLine === null && comments.filter(c => c.line).length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase mb-2">Line Comments</div>
                    <div className="space-y-2">
                      {comments.filter(c => c.line).sort((a,b) => (a.line||0) - (b.line||0)).map(c => (
                        <div key={c.commentId} className="bg-gray-700/30 p-2 rounded border-l-2 border-yellow-500 text-sm relative group cursor-pointer hover:bg-gray-700" onClick={() => setActiveLine(c.line)}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-yellow-500">Line {c.line}</span>
                            <button onClick={(e) => {e.stopPropagation(); handleDeleteComment(c.commentId)}} className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100"><Icons.Trash /></button>
                          </div>
                          <p className="text-gray-300">{c.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm p-6 text-center">
              Select a student from the list to view their submission and add grades.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
} 