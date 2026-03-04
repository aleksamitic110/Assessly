import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { questionBankApi } from '../services/api';
import type { QuestionBankItem, QuestionDifficulty } from '../types';

interface ProfessorExam {
  id: string;
  name: string;
  startTime: string;
}

interface SubjectWithExams {
  id: string;
  name: string;
  description?: string;
  exams: ProfessorExam[];
}

const difficultyBadge: Record<QuestionDifficulty, string> = {
  EASY: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  HARD: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700'
};

export default function ProfessorQuestionBankPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [subject, setSubject] = useState<SubjectWithExams | null>(null);
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedExamId, setSelectedExamId] = useState(searchParams.get('examId') || '');

  const [filters, setFilters] = useState({
    search: '',
    difficulty: '' as '' | QuestionDifficulty,
    tags: '',
    includeArchived: false
  });

  const [autoForm, setAutoForm] = useState({
    count: 3,
    difficulty: '' as '' | QuestionDifficulty,
    tags: ''
  });

  const hasExams = (subject?.exams || []).length > 0;

  const loadSubject = async () => {
    if (!subjectId) return;
    const response = await api.get<SubjectWithExams[]>('/exams/subjects');
    const found = response.data.find((entry) => entry.id === subjectId) || null;
    setSubject(found);
    if (found && !selectedExamId && found.exams.length > 0) {
      setSelectedExamId(found.exams[0].id);
    }
  };

  const loadItems = async () => {
    if (!subjectId) return;
    const response = await questionBankApi.listItems(subjectId, {
      search: filters.search || undefined,
      difficulty: filters.difficulty || undefined,
      tags: filters.tags || undefined,
      includeArchived: filters.includeArchived
    });
    const normalized = response.data.map((item) => ({
      ...item,
      id: item.id || item._id || ''
    }));
    setItems(normalized);
  };

  const reloadAll = async () => {
    setIsLoading(true);
    setError('');
    try {
      await Promise.all([loadSubject(), loadItems()]);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load question bank');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void reloadAll();
  }, [subjectId]);

  useEffect(() => {
    if (!subjectId) return;
    const timer = setTimeout(() => {
      void loadItems().catch((err: any) => {
        setError(err.response?.data?.error || 'Failed to load question bank');
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [subjectId, filters.search, filters.difficulty, filters.tags, filters.includeArchived]);

  const filteredExamName = useMemo(() => {
    return subject?.exams.find((exam) => exam.id === selectedExamId)?.name || 'No exam selected';
  }, [subject, selectedExamId]);

  const handleImportItem = async (itemId: string) => {
    if (!selectedExamId) {
      setError('Select an exam first.');
      return;
    }
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await questionBankApi.importItemToExam(selectedExamId, itemId);
      setMessage(`Task "${response.data.title}" imported into "${filteredExamName}".`);
      await loadItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to import task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoGenerate = async () => {
    if (!selectedExamId) {
      setError('Select an exam first.');
      return;
    }
    if (!autoForm.count || autoForm.count < 1) {
      setError('Count must be at least 1.');
      return;
    }
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await questionBankApi.autoGenerateForExam(selectedExamId, {
        count: Number(autoForm.count),
        difficulty: autoForm.difficulty || undefined,
        tags: autoForm.tags || undefined
      });
      setMessage(`Auto-generated ${response.data.createdCount} tasks in "${filteredExamName}".`);
      await loadItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to auto-generate tasks');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleArchive = async (item: QuestionBankItem) => {
    setIsSaving(true);
    setError('');
    try {
      await questionBankApi.updateItem(item.id, {
        archived: !item.archived
      });
      await loadItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update item');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteItem = async (item: QuestionBankItem) => {
    if (!confirm(`Delete "${item.title}" from question bank?`)) return;
    setIsSaving(true);
    setError('');
    try {
      await questionBankApi.deleteItem(item.id);
      await loadItems();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete item');
    } finally {
      setIsSaving(false);
    }
  };

  if (!subjectId) {
    return <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">Invalid subject.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-20 border-b border-gray-200/60 dark:border-gray-700/60 bg-white/85 dark:bg-gray-800/85 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">Question Bank Studio</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {subject ? `${subject.name} (${items.length} items)` : 'Loading subject...'}
            </p>
          </div>
          <button
            onClick={() => navigate('/professor')}
            className="px-4 py-2 text-sm font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="px-4 py-3 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-sm">
            {error}
          </div>
        )}
        {message && (
          <div className="px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm">
            {message}
          </div>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 p-4 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white/80 dark:bg-gray-800/80 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                placeholder="Search title, description, notes"
                className="md:col-span-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <select
                value={filters.difficulty}
                onChange={(e) => setFilters((prev) => ({ ...prev, difficulty: e.target.value as '' | QuestionDifficulty }))}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">All difficulties</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
              <input
                value={filters.tags}
                onChange={(e) => setFilters((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder="Tags: dp, arrays"
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={filters.includeArchived}
                onChange={(e) => setFilters((prev) => ({ ...prev, includeArchived: e.target.checked }))}
              />
              Include archived questions
            </label>
          </div>

          <div className="p-4 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white/80 dark:bg-gray-800/80 shadow-sm space-y-3">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">Auto-generate exam tasks</div>
            <select
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={!hasExams}
            >
              {!hasExams && <option value="">No exams in subject</option>}
              {subject?.exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={autoForm.count}
                onChange={(e) => setAutoForm((prev) => ({ ...prev, count: Number(e.target.value) }))}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <select
                value={autoForm.difficulty}
                onChange={(e) => setAutoForm((prev) => ({ ...prev, difficulty: e.target.value as '' | QuestionDifficulty }))}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Any</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
              <input
                value={autoForm.tags}
                onChange={(e) => setAutoForm((prev) => ({ ...prev, tags: e.target.value }))}
                placeholder="tags"
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button
              onClick={handleAutoGenerate}
              disabled={isSaving || !selectedExamId}
              className="w-full px-3 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-60"
            >
              Generate N Tasks
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-3">
            {isLoading ? (
              <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 text-sm text-gray-500 dark:text-gray-400">
                Loading question bank...
              </div>
            ) : items.length === 0 ? (
              <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 text-sm text-gray-500 dark:text-gray-400">
                No question bank items match these filters.
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className={`p-4 rounded-2xl border bg-white/80 dark:bg-gray-800/80 shadow-sm ${
                    item.archived ? 'border-gray-200 dark:border-gray-700 opacity-75' : 'border-gray-200/70 dark:border-gray-700/70'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-gray-900 dark:text-white">{item.title}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Max points: {item.maxPoints ?? 10} •{' '}
                        Used {item.useCount} times
                        {item.lastUsedAt ? ` - Last used ${new Date(item.lastUsedAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-[10px] font-semibold border rounded-full ${difficultyBadge[item.difficulty]}`}>
                      {item.difficulty}
                    </span>
                  </div>

                  {item.description && (
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.description}</p>
                  )}

                  {item.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 text-[10px] font-semibold rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleImportItem(item.id)}
                      disabled={isSaving || !selectedExamId || item.archived}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Use In Selected Exam
                    </button>
                    <button
                      onClick={() => toggleArchive(item)}
                      disabled={isSaving}
                      className="px-3 py-1.5 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      {item.archived ? 'Restore' : 'Archive'}
                    </button>
                    <button
                      onClick={() => deleteItem(item)}
                      disabled={isSaving}
                      className="px-3 py-1.5 text-xs font-semibold border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
