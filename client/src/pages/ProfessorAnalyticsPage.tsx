import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import api, { statsApi } from '../services/api';
import type { ExamOverviewStats, SubjectOverviewStats } from '../types';

interface SubjectRecord {
  id: string;
  name: string;
  exams: Array<{ id: string; name: string }>;
}

const gradeScale = ['5', '6', '7', '8', '9', '10'];
const axisTickColor = '#94a3b8';
const gridColor = '#334155';
const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#e2e8f0'
};

const sliceName = (value: string, max = 16) => (value.length > max ? `${value.slice(0, max)}...` : value);

export default function ProfessorAnalyticsPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [subjectStats, setSubjectStats] = useState<SubjectOverviewStats | null>(null);
  const [examStats, setExamStats] = useState<ExamOverviewStats | null>(null);
  const [subjectRecord, setSubjectRecord] = useState<SubjectRecord | null>(null);
  const [selectedExamId, setSelectedExamId] = useState(searchParams.get('examId') || '');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingExam, setIsLoadingExam] = useState(false);
  const [error, setError] = useState('');

  const loadSubjectContext = async () => {
    if (!subjectId) return;
    const response = await api.get<SubjectRecord[]>('/exams/subjects');
    const found = response.data.find((entry) => entry.id === subjectId) || null;
    setSubjectRecord(found);
    if (found && !selectedExamId && found.exams.length > 0) {
      setSelectedExamId(found.exams[0].id);
    }
  };

  const loadSubjectStats = async () => {
    if (!subjectId) return;
    const response = await statsApi.getSubjectOverview(subjectId);
    setSubjectStats(response.data);
  };

  const loadExamStats = async (examId: string) => {
    if (!examId) {
      setExamStats(null);
      return;
    }
    setIsLoadingExam(true);
    try {
      const response = await statsApi.getExamOverview(examId);
      setExamStats(response.data);
    } finally {
      setIsLoadingExam(false);
    }
  };

  useEffect(() => {
    if (!subjectId) return;
    setIsLoading(true);
    setError('');
    Promise.all([loadSubjectContext(), loadSubjectStats()])
      .catch((err: any) => {
        setError(err.response?.data?.error || 'Failed to load analytics');
      })
      .finally(() => setIsLoading(false));
  }, [subjectId]);

  useEffect(() => {
    if (!selectedExamId) return;
    void loadExamStats(selectedExamId).catch((err: any) => {
      setError(err.response?.data?.error || 'Failed to load exam analytics');
    });
  }, [selectedExamId]);

  const selectedExamName = useMemo(() => {
    return subjectRecord?.exams.find((exam) => exam.id === selectedExamId)?.name || 'Exam';
  }, [subjectRecord, selectedExamId]);

  const subjectGradeData = useMemo(
    () =>
      subjectStats
        ? gradeScale.map((grade) => ({ grade, count: subjectStats.grades.distribution[grade] || 0 }))
        : [],
    [subjectStats]
  );

  const subjectPassFailData = useMemo(() => {
    if (!subjectStats) return [] as Array<{ name: string; value: number; color: string }>;
    const passed = subjectStats.totals.passedCount;
    const failed = Math.max(0, subjectStats.totals.gradedCount - passed);
    return [
      { name: 'Passed', value: passed, color: '#10b981' },
      { name: 'Failed', value: failed, color: '#ef4444' }
    ];
  }, [subjectStats]);

  const subjectParticipationData = useMemo(() => {
    if (!subjectStats) return [] as Array<{ name: string; value: number }>;
    return [
      { name: 'Enrolled', value: subjectStats.totals.enrolledStudents },
      { name: 'Worked', value: subjectStats.totals.studentsWhoWorked },
      { name: 'Submitted', value: subjectStats.totals.studentsWhoSubmitted },
      { name: 'Graded', value: subjectStats.totals.gradedCount },
      { name: 'Passed', value: subjectStats.totals.passedCount }
    ];
  }, [subjectStats]);

  const examComparisonData = useMemo(() => {
    if (!subjectStats) return [] as Array<{ examName: string; fullExamName: string; passRate: number; averageGrade: number }>;
    return subjectStats.exams.all.map((exam) => ({
      examName: sliceName(exam.examName, 14),
      fullExamName: exam.examName,
      passRate: exam.passRate,
      averageGrade: exam.averageGrade
    }));
  }, [subjectStats]);

  const subjectHardestTaskData = useMemo(() => {
    if (!subjectStats) return [] as Array<{ taskTitle: string; hardnessScore: number; pointsRate: number }>;
    return subjectStats.tasks.hardest.map((task) => ({
      taskTitle: sliceName(task.taskTitle, 22),
      hardnessScore: task.hardnessScore,
      pointsRate: task.successRate
    }));
  }, [subjectStats]);

  const subjectEasiestTaskData = useMemo(() => {
    if (!subjectStats) return [] as Array<{ taskTitle: string; pointsRate: number; completionRate: number }>;
    return subjectStats.tasks.easiest.map((task) => ({
      taskTitle: sliceName(task.taskTitle, 22),
      pointsRate: task.successRate,
      completionRate: task.completionRate || 0
    }));
  }, [subjectStats]);

  const examPassFailData = useMemo(() => {
    if (!examStats) return [] as Array<{ name: string; value: number; color: string }>;
    const passed = examStats.counts.passed;
    const failed = Math.max(0, examStats.counts.graded - passed);
    return [
      { name: 'Passed', value: passed, color: '#10b981' },
      { name: 'Failed', value: failed, color: '#ef4444' }
    ];
  }, [examStats]);

  const examParticipationData = useMemo(() => {
    if (!examStats) return [] as Array<{ name: string; value: number }>;
    return [
      { name: 'Enrolled', value: examStats.counts.enrolled },
      { name: 'Worked', value: examStats.counts.worked },
      { name: 'Submitted', value: examStats.counts.submitted },
      { name: 'Graded', value: examStats.counts.graded },
      { name: 'Passed', value: examStats.counts.passed },
      { name: 'Withdrawn', value: examStats.counts.withdrawn }
    ];
  }, [examStats]);

  const examGradeData = useMemo(
    () =>
      examStats ? gradeScale.map((grade) => ({ grade, count: examStats.grades.distribution[grade] || 0 })) : [],
    [examStats]
  );

  const examHardestTaskData = useMemo(() => {
    if (!examStats) return [] as Array<{ taskTitle: string; hardnessScore: number; pointsRate: number }>;
    return examStats.tasks.hardest.map((task) => ({
      taskTitle: sliceName(task.taskTitle, 22),
      hardnessScore: task.hardnessScore,
      pointsRate: task.successRate
    }));
  }, [examStats]);

  const examEasiestTaskData = useMemo(() => {
    if (!examStats) return [] as Array<{ taskTitle: string; pointsRate: number; completionRate: number }>;
    return examStats.tasks.easiest.map((task) => ({
      taskTitle: sliceName(task.taskTitle, 22),
      pointsRate: task.successRate,
      completionRate: task.completionRate || 0
    }));
  }, [examStats]);

  if (!subjectId) {
    return <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">Invalid subject.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-20 border-b border-gray-200/60 dark:border-gray-700/60 bg-white/85 dark:bg-gray-800/85 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">Analytics Command Center</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{subjectStats?.subject.name || 'Loading subject...'}</p>
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

        {isLoading || !subjectStats ? (
          <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 text-sm text-gray-500 dark:text-gray-400">
            Loading analytics...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Enrolled</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{subjectStats.totals.enrolledStudents}</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Exams</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{subjectStats.totals.exams}</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Work Rate (Worked/Enrolled)</p>
                <p className="text-2xl font-black text-sky-700 dark:text-sky-300">{subjectStats.rates.activeRate}%</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Submission Rate (Submitted/Enrolled)</p>
                <p className="text-2xl font-black text-sky-700 dark:text-sky-300">{subjectStats.rates.submissionRate}%</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Avg Grade</p>
                <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{subjectStats.grades.average}</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Pass Rate</p>
                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{subjectStats.rates.passRateAmongGraded}%</p>
              </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">Pass vs Fail (Subject)</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={subjectPassFailData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2}>
                        {subjectPassFailData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">Participation Pipeline (Unique Students)</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjectParticipationData}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 12 }} />
                      <YAxis
                        tick={{ fill: axisTickColor, fontSize: 12 }}
                        allowDecimals={false}
                        label={{ value: 'Student count', angle: -90, position: 'insideLeft', fill: axisTickColor }}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">Grade Distribution (Subject)</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjectGradeData}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="grade" tick={{ fill: axisTickColor, fontSize: 12 }} />
                      <YAxis
                        tick={{ fill: axisTickColor, fontSize: 12 }}
                        allowDecimals={false}
                        label={{ value: 'Students', angle: -90, position: 'insideLeft', fill: axisTickColor }}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <article className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Exam Comparison</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Pass rate bar + average grade line</span>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={examComparisonData}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="examName" tick={{ fill: axisTickColor, fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[0, 100]} label={{ value: 'Pass %', angle: -90, position: 'insideLeft', fill: axisTickColor }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[5, 10]} label={{ value: 'Avg grade', angle: 90, position: 'insideRight', fill: axisTickColor }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="passRate" name="Pass rate (%)" fill="#10b981" radius={[6, 6, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="averageGrade" name="Average grade" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Exam Difficulty Ranking</h2>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {subjectStats.exams.all.map((exam) => (
                    <div key={exam.examId} className="p-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{exam.examName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Pass {exam.passRate}% - Avg {exam.averageGrade} - Submitted {exam.submittedCount}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Hardest Tasks (Subject, Points-Based)</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjectHardestTaskData} layout="vertical" margin={{ left: 12, right: 12 }}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis type="number" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="taskTitle" tick={{ fill: axisTickColor, fontSize: 11 }} width={150} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="hardnessScore" name="Difficulty (100 - points rate)" fill="#ef4444" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Easiest Tasks (Subject, Points-Based)</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjectEasiestTaskData} layout="vertical" margin={{ left: 12, right: 12 }}>
                      <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                      <XAxis type="number" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="taskTitle" tick={{ fill: axisTickColor, fontSize: 11 }} width={150} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="pointsRate" name="Average points rate (%)" fill="#22c55e" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </section>

            <section className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Exam Deep Dive</h2>
                <select
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {(subjectRecord?.exams || []).map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name}
                    </option>
                  ))}
                </select>
              </div>

              {!selectedExamId ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Select an exam to view detailed analytics.</div>
              ) : isLoadingExam || !examStats ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading exam analytics...</div>
              ) : (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{selectedExamName}</div>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Enrolled</div>
                        <div className="font-bold text-gray-900 dark:text-white">{examStats.counts.enrolled}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Worked</div>
                        <div className="font-bold text-gray-900 dark:text-white">{examStats.counts.worked}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Submitted</div>
                        <div className="font-bold text-gray-900 dark:text-white">{examStats.counts.submitted}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Graded</div>
                        <div className="font-bold text-gray-900 dark:text-white">{examStats.counts.graded}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Withdrawn</div>
                        <div className="font-bold text-gray-900 dark:text-white">{examStats.counts.withdrawn}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Pass Rate</div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-300">{examStats.rates.passRateAmongGraded}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Avg Grade</div>
                        <div className="font-bold text-amber-700 dark:text-amber-300">{examStats.grades.average}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <article className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/40">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Pass vs Fail (Exam)</h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={examPassFailData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                              {examPassFailData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </article>

                    <article className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/40">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Participation (Exam - Student Counts)</h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={examParticipationData}>
                            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                            <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 11 }} />
                            <YAxis
                              tick={{ fill: axisTickColor, fontSize: 12 }}
                              allowDecimals={false}
                              label={{ value: 'Student count', angle: -90, position: 'insideLeft', fill: axisTickColor }}
                            />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="value" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </article>

                    <article className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/40">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Grade Distribution (Exam)</h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={examGradeData}>
                            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                            <XAxis dataKey="grade" tick={{ fill: axisTickColor, fontSize: 12 }} />
                            <YAxis
                              tick={{ fill: axisTickColor, fontSize: 12 }}
                              allowDecimals={false}
                              label={{ value: 'Students', angle: -90, position: 'insideLeft', fill: axisTickColor }}
                            />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </article>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <article className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/40">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Hardest Tasks (Exam, Points-Based)</h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={examHardestTaskData} layout="vertical" margin={{ left: 12, right: 12 }}>
                            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                            <XAxis type="number" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[0, 100]} />
                            <YAxis type="category" dataKey="taskTitle" tick={{ fill: axisTickColor, fontSize: 11 }} width={150} />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="hardnessScore" name="Difficulty (100 - points rate)" fill="#ef4444" radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </article>

                    <article className="p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-700/40">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Easiest Tasks (Exam, Points-Based)</h3>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={examEasiestTaskData} layout="vertical" margin={{ left: 12, right: 12 }}>
                            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" opacity={0.25} />
                            <XAxis type="number" tick={{ fill: axisTickColor, fontSize: 12 }} domain={[0, 100]} />
                            <YAxis type="category" dataKey="taskTitle" tick={{ fill: axisTickColor, fontSize: 11 }} width={150} />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="pointsRate" name="Average points rate (%)" fill="#22c55e" radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </article>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
