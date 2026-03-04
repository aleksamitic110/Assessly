import { Response } from 'express';
import { neo4jDriver } from '../../neo4j/driver.js';
import { GradeStat } from '../models/GradeStat.js';

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof (value as { toNumber?: () => number })?.toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const safePercent = (numerator: number, denominator: number) => {
  if (!denominator) {
    return 0;
  }
  return round2((numerator / denominator) * 100);
};

const computeMedian = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round2((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
};

const fetchExamContext = async (professorId: string, examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      OPTIONAL MATCH (st:User)-[:ENROLLED_IN]->(s)
      RETURN s.id AS subjectId,
             s.name AS subjectName,
             e.id AS examId,
             e.name AS examName,
             count(DISTINCT st) AS enrolledCount
      `,
      { professorId, examId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    return {
      subjectId: String(record.get('subjectId')),
      subjectName: String(record.get('subjectName')),
      examId: String(record.get('examId')),
      examName: String(record.get('examName')),
      enrolledCount: toNumber(record.get('enrolledCount'))
    };
  } finally {
    await session.close();
  }
};

const fetchExamParticipationCounts = async (examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      OPTIONAL MATCH (enrolled:User)-[:ENROLLED_IN]->(s)
      WITH e, count(DISTINCT enrolled) AS enrolledCount

      OPTIONAL MATCH (submitted:User)-[:SUBMITTED_EXAM]->(e)
      WITH e, enrolledCount, collect(DISTINCT submitted.id) AS submittedIds

      OPTIONAL MATCH (worker:User)-[:SUBMITTED]->(:Task)<-[:IMA_ZADATAK]-(e)
      WITH e, enrolledCount, submittedIds, collect(DISTINCT worker.id) AS workedIdsRaw

      OPTIONAL MATCH (withdrawn:User)-[:WITHDREW_EXAM]->(e)
      WITH enrolledCount,
           submittedIds,
           [id IN workedIdsRaw + submittedIds WHERE id IS NOT NULL] AS workedCandidateIds,
           collect(DISTINCT withdrawn.id) AS withdrawnIds
      RETURN enrolledCount,
             size(submittedIds) AS submittedCount,
             size(reduce(acc = [], id IN workedCandidateIds |
               CASE WHEN id IN acc THEN acc ELSE acc + id END
             )) AS workedCount,
             size([id IN withdrawnIds WHERE id IS NOT NULL AND NOT id IN submittedIds]) AS withdrawnCount
      `,
      { examId }
    );

    if (!result.records.length) {
      return {
        enrolledCount: 0,
        submittedCount: 0,
        workedCount: 0,
        withdrawnCount: 0
      };
    }

    const row = result.records[0];
    return {
      enrolledCount: toNumber(row.get('enrolledCount')),
      submittedCount: toNumber(row.get('submittedCount')),
      workedCount: toNumber(row.get('workedCount')),
      withdrawnCount: toNumber(row.get('withdrawnCount'))
    };
  } finally {
    await session.close();
  }
};

type RawTaskPointsRow = {
  taskId: string;
  taskTitle: string;
  taskMaxPoints: number;
  submittedStudents: number;
  gradedStudents: number;
  successfulStudents: number;
  totalAwardedPoints: number;
  totalPossiblePointsForGraded: number;
  examId?: string | null;
  examName?: string | null;
};

const mapTaskPointsRow = (row: RawTaskPointsRow) => {
  const taskMaxPoints = round2(toNumber(row.taskMaxPoints, 10));
  const submittedStudents = toNumber(row.submittedStudents);
  const gradedStudents = toNumber(row.gradedStudents);
  const successfulStudents = toNumber(row.successfulStudents);
  const totalAwardedPoints = round2(toNumber(row.totalAwardedPoints));
  const totalPossiblePointsForGraded = round2(toNumber(row.totalPossiblePointsForGraded));

  const scoreRate = safePercent(totalAwardedPoints, totalPossiblePointsForGraded);
  const averageAwardedPoints = gradedStudents ? round2(totalAwardedPoints / gradedStudents) : 0;
  const completionRate = safePercent(gradedStudents, submittedStudents || gradedStudents || 1);
  const hardnessScore = round2(100 - scoreRate);

  return {
    taskId: String(row.taskId),
    taskTitle: String(row.taskTitle),
    attempts: submittedStudents,
    studentsCount: submittedStudents,
    successfulStudents,
    successRate: scoreRate,
    errorRate: round2(100 - scoreRate),
    hardnessScore,
    taskMaxPoints,
    averageAwardedPoints,
    completionRate,
    gradedStudents,
    totalAwardedPoints,
    examId: row.examId ? String(row.examId) : undefined,
    examName: row.examName ? String(row.examName) : undefined
  };
};

const fetchExamTaskPointsStats = async (examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      OPTIONAL MATCH (u:User)-[r:SUBMITTED]->(t)
      WITH t,
           count(DISTINCT CASE WHEN r IS NOT NULL THEN u END) AS submittedStudents,
           count(DISTINCT CASE WHEN r.awardedPoints IS NOT NULL THEN u END) AS gradedStudents,
           count(DISTINCT CASE
             WHEN r.awardedPoints IS NOT NULL AND toFloat(r.awardedPoints) >= coalesce(toFloat(t.maxPoints), 10.0) * 0.6
             THEN u
           END) AS successfulStudents,
           sum(coalesce(toFloat(r.awardedPoints), 0.0)) AS totalAwardedPoints,
           sum(CASE WHEN r.awardedPoints IS NULL THEN 0.0 ELSE coalesce(toFloat(t.maxPoints), 10.0) END) AS totalPossiblePointsForGraded
      RETURN t.id AS taskId,
             t.title AS taskTitle,
             coalesce(toFloat(t.maxPoints), 10.0) AS taskMaxPoints,
             submittedStudents,
             gradedStudents,
             successfulStudents,
             totalAwardedPoints,
             totalPossiblePointsForGraded
      ORDER BY t.title
      `,
      { examId }
    );

    return result.records.map((record) =>
      mapTaskPointsRow({
        taskId: String(record.get('taskId')),
        taskTitle: String(record.get('taskTitle')),
        taskMaxPoints: toNumber(record.get('taskMaxPoints'), 10),
        submittedStudents: toNumber(record.get('submittedStudents')),
        gradedStudents: toNumber(record.get('gradedStudents')),
        successfulStudents: toNumber(record.get('successfulStudents')),
        totalAwardedPoints: toNumber(record.get('totalAwardedPoints')),
        totalPossiblePointsForGraded: toNumber(record.get('totalPossiblePointsForGraded'))
      })
    );
  } finally {
    await session.close();
  }
};

const fetchSubjectContext = async (professorId: string, subjectId: string) => {
  const session = neo4jDriver.session();
  try {
    const subjectResult = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      RETURN s.id AS subjectId, s.name AS subjectName
      `,
      { professorId, subjectId }
    );

    if (subjectResult.records.length === 0) {
      return null;
    }

    const examCountsResult = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (submitted:User)-[:SUBMITTED_EXAM]->(e)
      WITH e, collect(DISTINCT submitted.id) AS submittedIds

      OPTIONAL MATCH (worker:User)-[:SUBMITTED]->(:Task)<-[:IMA_ZADATAK]-(e)
      WITH e, submittedIds, collect(DISTINCT worker.id) AS workedIdsRaw

      OPTIONAL MATCH (withdrawn:User)-[:WITHDREW_EXAM]->(e)
      WITH e,
           submittedIds,
           [id IN workedIdsRaw + submittedIds WHERE id IS NOT NULL] AS workedCandidateIds,
           collect(DISTINCT withdrawn.id) AS withdrawnIds
      RETURN e.id AS examId,
             e.name AS examName,
             e.startTime AS startTime,
             size(submittedIds) AS submittedCount,
             size(reduce(acc = [], id IN workedCandidateIds |
               CASE WHEN id IN acc THEN acc ELSE acc + id END
             )) AS workedCount,
             size([id IN withdrawnIds WHERE id IS NOT NULL AND NOT id IN submittedIds]) AS withdrawnCount
      ORDER BY e.startTime
      `,
      { subjectId }
    );

    const enrolledResult = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})<-[r:ENROLLED_IN]-(:User)
      RETURN count(DISTINCT r) AS enrolledCount
      `,
      { subjectId }
    );

    const subjectRecord = subjectResult.records[0];
    return {
      subjectId: String(subjectRecord.get('subjectId')),
      subjectName: String(subjectRecord.get('subjectName')),
      enrolledCount: toNumber(enrolledResult.records[0]?.get('enrolledCount')),
      exams: examCountsResult.records.map((record) => ({
        examId: String(record.get('examId')),
        examName: String(record.get('examName')),
        startTime: record.get('startTime') ? String(record.get('startTime')) : null,
        submittedCount: toNumber(record.get('submittedCount')),
        workedCount: toNumber(record.get('workedCount')),
        withdrawnCount: toNumber(record.get('withdrawnCount'))
      }))
    };
  } finally {
    await session.close();
  }
};

const fetchSubjectParticipationTotals = async (subjectId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})
      OPTIONAL MATCH (enrolled:User)-[:ENROLLED_IN]->(s)
      WITH s, count(DISTINCT enrolled) AS enrolledCount

      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)<-[:SUBMITTED_EXAM]-(submitted:User)
      WITH s, enrolledCount, collect(DISTINCT submitted.id) AS submittedStudentIds

      OPTIONAL MATCH (s)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(:Task)<-[:SUBMITTED]-(worker:User)
      WITH enrolledCount,
           submittedStudentIds,
           [id IN collect(DISTINCT worker.id) + submittedStudentIds WHERE id IS NOT NULL] AS workedCandidateIds
      RETURN enrolledCount,
             size(submittedStudentIds) AS submittedStudents,
             size(reduce(acc = [], id IN workedCandidateIds |
               CASE WHEN id IN acc THEN acc ELSE acc + id END
             )) AS workedStudents
      `,
      { subjectId }
    );

    const row = result.records[0];
    return {
      enrolledCount: toNumber(row?.get('enrolledCount')),
      submittedStudents: toNumber(row?.get('submittedStudents')),
      workedStudents: toNumber(row?.get('workedStudents'))
    };
  } finally {
    await session.close();
  }
};

const fetchSubjectTaskPointsStats = async (subjectId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})-[:SADRZI]->(e:Exam)-[:IMA_ZADATAK]->(t:Task)
      OPTIONAL MATCH (u:User)-[r:SUBMITTED]->(t)
      WITH e, t,
           count(DISTINCT CASE WHEN r IS NOT NULL THEN u END) AS submittedStudents,
           count(DISTINCT CASE WHEN r.awardedPoints IS NOT NULL THEN u END) AS gradedStudents,
           count(DISTINCT CASE
             WHEN r.awardedPoints IS NOT NULL AND toFloat(r.awardedPoints) >= coalesce(toFloat(t.maxPoints), 10.0) * 0.6
             THEN u
           END) AS successfulStudents,
           sum(coalesce(toFloat(r.awardedPoints), 0.0)) AS totalAwardedPoints,
           sum(CASE WHEN r.awardedPoints IS NULL THEN 0.0 ELSE coalesce(toFloat(t.maxPoints), 10.0) END) AS totalPossiblePointsForGraded
      RETURN t.id AS taskId,
             t.title AS taskTitle,
             coalesce(toFloat(t.maxPoints), 10.0) AS taskMaxPoints,
             e.id AS examId,
             e.name AS examName,
             submittedStudents,
             gradedStudents,
             successfulStudents,
             totalAwardedPoints,
             totalPossiblePointsForGraded
      ORDER BY e.startTime, t.title
      `,
      { subjectId }
    );

    return result.records.map((record) =>
      mapTaskPointsRow({
        taskId: String(record.get('taskId')),
        taskTitle: String(record.get('taskTitle')),
        taskMaxPoints: toNumber(record.get('taskMaxPoints'), 10),
        examId: record.get('examId') ? String(record.get('examId')) : null,
        examName: record.get('examName') ? String(record.get('examName')) : null,
        submittedStudents: toNumber(record.get('submittedStudents')),
        gradedStudents: toNumber(record.get('gradedStudents')),
        successfulStudents: toNumber(record.get('successfulStudents')),
        totalAwardedPoints: toNumber(record.get('totalAwardedPoints')),
        totalPossiblePointsForGraded: toNumber(record.get('totalPossiblePointsForGraded'))
      })
    );
  } finally {
    await session.close();
  }
};

export const getExamStats = async (req: any, res: Response) => {
  const { examId } = req.params;

  try {
    const stats = await GradeStat.aggregate([
      { $match: { examId } },
      {
        $group: {
          _id: null,
          totalStudents: { $sum: 1 },
          passedCount: {
            $sum: { $cond: [{ $eq: ['$passed', true] }, 1, 0] }
          },
          averageGrade: { $avg: '$gradeValue' }
        }
      },
      {
        $project: {
          _id: 0,
          totalStudents: 1,
          passedCount: 1,
          averageGrade: { $round: ['$averageGrade', 2] },
          passRate: {
            $round: [
              { $multiply: [{ $divide: ['$passedCount', '$totalStudents'] }, 100] },
              2
            ]
          }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalStudents: 0,
        passedCount: 0,
        averageGrade: 0,
        passRate: 0
      });
    }

    return res.json(stats[0]);
  } catch (error) {
    console.error('Error while fetching simple exam stats:', error);
    return res.status(500).json({ error: 'Failed to fetch exam statistics' });
  }
};

export const getExamOverviewStats = async (req: any, res: Response) => {
  const { examId } = req.params;
  const professorId = req.user?.id;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can access exam analytics' });
  }

  try {
    const context = await fetchExamContext(professorId, examId);
    if (!context) {
      return res.status(403).json({ error: 'You do not have access to this exam' });
    }

    const [gradeSummary] = await GradeStat.aggregate([
      { $match: { examId } },
      {
        $group: {
          _id: null,
          gradedCount: { $sum: 1 },
          passedCount: { $sum: { $cond: ['$passed', 1, 0] } },
          averageGrade: { $avg: '$gradeValue' },
          grades: { $push: '$gradeValue' }
        }
      }
    ]);

    const gradeDistributionRows = await GradeStat.aggregate([
      { $match: { examId } },
      { $group: { _id: '$gradeValue', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const participation = await fetchExamParticipationCounts(examId);
    const taskDifficulty = (await fetchExamTaskPointsStats(examId)).sort((a, b) => b.hardnessScore - a.hardnessScore);

    const gradeDistribution: Record<string, number> = {
      '5': 0,
      '6': 0,
      '7': 0,
      '8': 0,
      '9': 0,
      '10': 0
    };
    for (const row of gradeDistributionRows) {
      const gradeKey = String(row._id);
      if (gradeDistribution[gradeKey] !== undefined) {
        gradeDistribution[gradeKey] = toNumber(row.count);
      }
    }

    const gradedCount = toNumber(gradeSummary?.gradedCount);
    const passedCount = toNumber(gradeSummary?.passedCount);
    const averageGradeRaw = Number(gradeSummary?.averageGrade || 0);
    const averageGrade = round2(averageGradeRaw);
    const medianGrade = computeMedian(Array.isArray(gradeSummary?.grades) ? gradeSummary.grades : []);

    return res.json({
      exam: {
        id: context.examId,
        name: context.examName,
        subjectId: context.subjectId,
        subjectName: context.subjectName
      },
      counts: {
        enrolled: participation.enrolledCount || context.enrolledCount,
        worked: participation.workedCount,
        submitted: participation.submittedCount,
        graded: gradedCount,
        passed: passedCount,
        withdrawn: participation.withdrawnCount
      },
      rates: {
        workRate: safePercent(participation.workedCount, participation.enrolledCount || context.enrolledCount),
        submissionRate: safePercent(participation.submittedCount, participation.enrolledCount || context.enrolledCount),
        passRateAmongGraded: safePercent(passedCount, gradedCount),
        passRateAmongEnrolled: safePercent(passedCount, participation.enrolledCount || context.enrolledCount),
        withdrawalRate: safePercent(participation.withdrawnCount, participation.enrolledCount || context.enrolledCount)
      },
      grades: {
        average: averageGrade,
        median: medianGrade,
        distribution: gradeDistribution
      },
      tasks: {
        hardest: taskDifficulty.slice(0, 5),
        easiest: [...taskDifficulty].reverse().slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Error while fetching exam overview stats:', error);
    return res.status(500).json({ error: 'Failed to fetch exam overview statistics' });
  }
};

export const getSubjectOverviewStats = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const professorId = req.user?.id;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can access subject analytics' });
  }

  try {
    const context = await fetchSubjectContext(professorId, subjectId);
    if (!context) {
      return res.status(403).json({ error: 'You do not have access to this subject' });
    }

    const examIds = context.exams.map((exam) => exam.examId);

    const gradeSummaryByExam = examIds.length
      ? await GradeStat.aggregate([
          { $match: { examId: { $in: examIds } } },
          {
            $group: {
              _id: '$examId',
              gradedCount: { $sum: 1 },
              passedCount: { $sum: { $cond: ['$passed', 1, 0] } },
              averageGrade: { $avg: '$gradeValue' }
            }
          }
        ])
      : [];

    const gradeSummaryOverall = examIds.length
      ? await GradeStat.aggregate([
          { $match: { examId: { $in: examIds } } },
          {
            $group: {
              _id: null,
              gradedCount: { $sum: 1 },
              passedCount: { $sum: { $cond: ['$passed', 1, 0] } },
              averageGrade: { $avg: '$gradeValue' },
              grades: { $push: '$gradeValue' }
            }
          }
        ])
      : [];

    const gradeDistributionRows = examIds.length
      ? await GradeStat.aggregate([
          { $match: { examId: { $in: examIds } } },
          { $group: { _id: '$gradeValue', count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ])
      : [];

    const participationTotals = await fetchSubjectParticipationTotals(subjectId);
    const taskComparisons = (await fetchSubjectTaskPointsStats(subjectId)).sort((a, b) => b.hardnessScore - a.hardnessScore);

    const gradeMapByExam = new Map<string, { gradedCount: number; passedCount: number; averageGrade: number }>(
      gradeSummaryByExam.map((row: any) => [
        String(row._id),
        {
          gradedCount: toNumber(row.gradedCount),
          passedCount: toNumber(row.passedCount),
          averageGrade: round2(Number(row.averageGrade || 0))
        }
      ])
    );

    const examComparisons = context.exams.map((exam) => {
      const grade = (gradeMapByExam.get(exam.examId) || {
        gradedCount: 0,
        passedCount: 0,
        averageGrade: 0
      }) as { gradedCount: number; passedCount: number; averageGrade: number };

      const passRate = safePercent(grade.passedCount, grade.gradedCount);
      const normalizedAverage = grade.averageGrade > 0 ? (grade.averageGrade - 5) / 5 : 0;
      const hardnessScore = round2((100 - passRate) * 0.7 + (100 - normalizedAverage * 100) * 0.3);
      return {
        examId: exam.examId,
        examName: exam.examName,
        startTime: exam.startTime,
        submittedCount: exam.submittedCount,
        workedCount: exam.workedCount,
        withdrawnCount: exam.withdrawnCount,
        gradedCount: grade.gradedCount,
        passedCount: grade.passedCount,
        passRate,
        averageGrade: grade.averageGrade,
        hardnessScore
      };
    });

    const overallGrades = gradeSummaryOverall[0] || {
      gradedCount: 0,
      passedCount: 0,
      averageGrade: 0,
      grades: []
    };

    const gradeDistribution: Record<string, number> = {
      '5': 0,
      '6': 0,
      '7': 0,
      '8': 0,
      '9': 0,
      '10': 0
    };
    for (const row of gradeDistributionRows) {
      const gradeKey = String(row._id);
      if (gradeDistribution[gradeKey] !== undefined) {
        gradeDistribution[gradeKey] = toNumber(row.count);
      }
    }

    const workedStudents = toNumber(participationTotals.workedStudents);
    const submittedStudents = toNumber(participationTotals.submittedStudents);
    const gradedCount = toNumber(overallGrades.gradedCount);
    const passedCount = toNumber(overallGrades.passedCount);
    const averageGrade = round2(Number(overallGrades.averageGrade || 0));
    const medianGrade = computeMedian(Array.isArray(overallGrades.grades) ? overallGrades.grades : []);

    return res.json({
      subject: {
        id: context.subjectId,
        name: context.subjectName
      },
      totals: {
        exams: context.exams.length,
        enrolledStudents: context.enrolledCount,
        studentsWhoWorked: workedStudents,
        studentsWhoSubmitted: submittedStudents,
        gradedCount,
        passedCount
      },
      rates: {
        activeRate: safePercent(workedStudents, context.enrolledCount),
        submissionRate: safePercent(submittedStudents, context.enrolledCount),
        passRateAmongGraded: safePercent(passedCount, gradedCount)
      },
      grades: {
        average: averageGrade,
        median: medianGrade,
        distribution: gradeDistribution
      },
      exams: {
        hardest: [...examComparisons].sort((a, b) => b.hardnessScore - a.hardnessScore).slice(0, 5),
        easiest: [...examComparisons].sort((a, b) => a.hardnessScore - b.hardnessScore).slice(0, 5),
        all: examComparisons
      },
      tasks: {
        hardest: taskComparisons.slice(0, 5),
        easiest: [...taskComparisons].reverse().slice(0, 5)
      }
    });
  } catch (error) {
    console.error('Error while fetching subject overview stats:', error);
    return res.status(500).json({ error: 'Failed to fetch subject overview statistics' });
  }
};
