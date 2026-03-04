import { Response } from 'express';
import { neo4jDriver } from '../../neo4j/driver.js';
import { GradeStat } from '../models/GradeStat.js';
import { ExamParticipation } from '../models/ExamParticipation.js';
import { TaskRunEvent } from '../models/TaskRunEvent.js';

const toNumber = (value: unknown) => {
  if (typeof (value as { toNumber?: () => number })?.toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value || 0);
};

const safePercent = (numerator: number, denominator: number) => {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
};

const computeMedian = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
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
      WITH s, e, count(DISTINCT st) AS enrolledCount
      OPTIONAL MATCH (:User)-[sub:SUBMITTED_EXAM]->(e)
      RETURN s.id AS subjectId,
             s.name AS subjectName,
             e.id AS examId,
             e.name AS examName,
             enrolledCount,
             count(DISTINCT sub) AS submittedCount
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
      enrolledCount: toNumber(record.get('enrolledCount')),
      submittedCount: toNumber(record.get('submittedCount'))
    };
  } finally {
    await session.close();
  }
};

const fetchTaskMetadataForExam = async (examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      RETURN t.id AS taskId, t.title AS taskTitle
      ORDER BY t.title
      `,
      { examId }
    );

    return result.records.map((record) => ({
      taskId: String(record.get('taskId')),
      taskTitle: String(record.get('taskTitle'))
    }));
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

    const enrolledResult = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})<-[r:ENROLLED_IN]-(:User)
      RETURN count(DISTINCT r) AS enrolledCount
      `,
      { subjectId }
    );

    const examsResult = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (:User)-[sub:SUBMITTED_EXAM]->(e)
      RETURN e.id AS examId,
             e.name AS examName,
             e.startTime AS startTime,
             count(DISTINCT sub) AS submittedCount
      ORDER BY e.startTime
      `,
      { subjectId }
    );

    const subjectRecord = subjectResult.records[0];
    return {
      subjectId: String(subjectRecord.get('subjectId')),
      subjectName: String(subjectRecord.get('subjectName')),
      enrolledCount: toNumber(enrolledResult.records[0]?.get('enrolledCount')),
      exams: examsResult.records.map((record) => ({
        examId: String(record.get('examId')),
        examName: String(record.get('examName')),
        startTime: record.get('startTime') ? String(record.get('startTime')) : null,
        submittedCount: toNumber(record.get('submittedCount'))
      }))
    };
  } finally {
    await session.close();
  }
};

const fetchTaskMetadataForSubject = async (subjectId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})-[:SADRZI]->(e:Exam)-[:IMA_ZADATAK]->(t:Task)
      RETURN t.id AS taskId, t.title AS taskTitle, e.id AS examId, e.name AS examName
      ORDER BY e.startTime, t.title
      `,
      { subjectId }
    );

    return result.records.map((record) => ({
      taskId: String(record.get('taskId')),
      taskTitle: String(record.get('taskTitle')),
      examId: String(record.get('examId')),
      examName: String(record.get('examName'))
    }));
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

    const participationSummary = await ExamParticipation.aggregate([
      { $match: { examId } },
      {
        $group: {
          _id: null,
          workedCount: { $sum: { $cond: ['$hasWorked', 1, 0] } },
          withdrawnCount: { $sum: { $cond: ['$hasWithdrawn', 1, 0] } }
        }
      }
    ]);

    const taskRunRows = await TaskRunEvent.aggregate([
      { $match: { examId } },
      {
        $group: {
          _id: '$taskId',
          attempts: { $sum: 1 },
          successRuns: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
          errorRuns: { $sum: { $cond: [{ $eq: ['$status', 'ERROR'] }, 1, 0] } },
          students: { $addToSet: '$studentId' },
          successfulStudentsRaw: {
            $addToSet: {
              $cond: [{ $eq: ['$status', 'SUCCESS'] }, '$studentId', null]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          taskId: '$_id',
          attempts: 1,
          successRuns: 1,
          errorRuns: 1,
          studentsCount: { $size: '$students' },
          successfulStudents: {
            $size: { $setDifference: ['$successfulStudentsRaw', [null]] }
          }
        }
      }
    ]);

    const taskMeta = await fetchTaskMetadataForExam(examId);
    const taskTitleById = new Map(taskMeta.map((task) => [task.taskId, task.taskTitle]));

    const taskDifficulty = taskRunRows
      .map((row: any) => {
        const studentsCount = toNumber(row.studentsCount);
        const successfulStudents = toNumber(row.successfulStudents);
        const attempts = toNumber(row.attempts);
        const errorRuns = toNumber(row.errorRuns);
        const successRate = safePercent(successfulStudents, studentsCount || 1);
        const errorRate = safePercent(errorRuns, attempts || 1);
        const hardnessScore = Math.round((100 - successRate) * 0.7 + errorRate * 0.3);
        return {
          taskId: String(row.taskId),
          taskTitle: taskTitleById.get(String(row.taskId)) || 'Unknown task',
          attempts,
          studentsCount,
          successfulStudents,
          successRate,
          errorRate,
          hardnessScore
        };
      })
      .sort((a: any, b: any) => b.hardnessScore - a.hardnessScore);

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
    const averageGrade = Math.round(averageGradeRaw * 100) / 100;
    const medianGrade = computeMedian(Array.isArray(gradeSummary?.grades) ? gradeSummary.grades : []);

    const workedCount = toNumber(participationSummary[0]?.workedCount);
    const withdrawnCount = toNumber(participationSummary[0]?.withdrawnCount);

    return res.json({
      exam: {
        id: context.examId,
        name: context.examName,
        subjectId: context.subjectId,
        subjectName: context.subjectName
      },
      counts: {
        enrolled: context.enrolledCount,
        worked: workedCount,
        submitted: context.submittedCount,
        graded: gradedCount,
        passed: passedCount,
        withdrawn: withdrawnCount
      },
      rates: {
        workRate: safePercent(workedCount, context.enrolledCount),
        submissionRate: safePercent(context.submittedCount, context.enrolledCount),
        passRateAmongGraded: safePercent(passedCount, gradedCount),
        passRateAmongEnrolled: safePercent(passedCount, context.enrolledCount),
        withdrawalRate: safePercent(withdrawnCount, context.enrolledCount)
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

    const participationByExam = examIds.length
      ? await ExamParticipation.aggregate([
          { $match: { examId: { $in: examIds } } },
          {
            $group: {
              _id: '$examId',
              workedCount: { $sum: { $cond: ['$hasWorked', 1, 0] } },
              withdrawnCount: { $sum: { $cond: ['$hasWithdrawn', 1, 0] } }
            }
          }
        ])
      : [];

    const participationOverall = await ExamParticipation.aggregate([
      { $match: { subjectId } },
      {
        $group: {
          _id: null,
          workedStudentsRaw: {
            $addToSet: {
              $cond: ['$hasWorked', '$studentId', null]
            }
          },
          submittedStudentsRaw: {
            $addToSet: {
              $cond: ['$hasSubmitted', '$studentId', null]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          workedStudents: { $size: { $setDifference: ['$workedStudentsRaw', [null]] } },
          submittedStudents: { $size: { $setDifference: ['$submittedStudentsRaw', [null]] } }
        }
      }
    ]);

    const taskRunRows = await TaskRunEvent.aggregate([
      { $match: { subjectId } },
      {
        $group: {
          _id: '$taskId',
          attempts: { $sum: 1 },
          successRuns: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
          errorRuns: { $sum: { $cond: [{ $eq: ['$status', 'ERROR'] }, 1, 0] } },
          students: { $addToSet: '$studentId' },
          successfulStudentsRaw: {
            $addToSet: {
              $cond: [{ $eq: ['$status', 'SUCCESS'] }, '$studentId', null]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          taskId: '$_id',
          attempts: 1,
          successRuns: 1,
          errorRuns: 1,
          studentsCount: { $size: '$students' },
          successfulStudents: {
            $size: { $setDifference: ['$successfulStudentsRaw', [null]] }
          }
        }
      }
    ]);

    const taskMeta = await fetchTaskMetadataForSubject(subjectId);
    const taskMetaById = new Map(
      taskMeta.map((task) => [task.taskId, { taskTitle: task.taskTitle, examId: task.examId, examName: task.examName }])
    );

    const gradeMapByExam = new Map<string, { gradedCount: number; passedCount: number; averageGrade: number }>(
      gradeSummaryByExam.map((row: any) => [
        String(row._id),
        {
          gradedCount: toNumber(row.gradedCount),
          passedCount: toNumber(row.passedCount),
          averageGrade: Math.round(Number(row.averageGrade || 0) * 100) / 100
        }
      ])
    );
    const participationMapByExam = new Map<string, { workedCount: number; withdrawnCount: number }>(
      participationByExam.map((row: any) => [
        String(row._id),
        {
          workedCount: toNumber(row.workedCount),
          withdrawnCount: toNumber(row.withdrawnCount)
        }
      ])
    );

    const examComparisons = context.exams.map((exam) => {
      const grade = (gradeMapByExam.get(exam.examId) || {
        gradedCount: 0,
        passedCount: 0,
        averageGrade: 0
      }) as { gradedCount: number; passedCount: number; averageGrade: number };
      const participation = (participationMapByExam.get(exam.examId) || {
        workedCount: 0,
        withdrawnCount: 0
      }) as { workedCount: number; withdrawnCount: number };
      const passRate = safePercent(grade.passedCount, grade.gradedCount);
      const normalizedAverage = grade.averageGrade > 0 ? (grade.averageGrade - 5) / 5 : 0;
      const hardnessScore = Math.round((100 - passRate) * 0.7 + (100 - normalizedAverage * 100) * 0.3);
      return {
        examId: exam.examId,
        examName: exam.examName,
        startTime: exam.startTime,
        submittedCount: exam.submittedCount,
        workedCount: participation.workedCount,
        withdrawnCount: participation.withdrawnCount,
        gradedCount: grade.gradedCount,
        passedCount: grade.passedCount,
        passRate,
        averageGrade: grade.averageGrade,
        hardnessScore
      };
    });

    const taskComparisons = taskRunRows
      .map((row: any) => {
        const meta = taskMetaById.get(String(row.taskId));
        const studentsCount = toNumber(row.studentsCount);
        const successfulStudents = toNumber(row.successfulStudents);
        const attempts = toNumber(row.attempts);
        const errorRuns = toNumber(row.errorRuns);
        const successRate = safePercent(successfulStudents, studentsCount || 1);
        const errorRate = safePercent(errorRuns, attempts || 1);
        const hardnessScore = Math.round((100 - successRate) * 0.7 + errorRate * 0.3);
        return {
          taskId: String(row.taskId),
          taskTitle: meta?.taskTitle || 'Unknown task',
          examId: meta?.examId || null,
          examName: meta?.examName || null,
          attempts,
          studentsCount,
          successfulStudents,
          successRate,
          errorRate,
          hardnessScore
        };
      })
      .sort((a: any, b: any) => b.hardnessScore - a.hardnessScore);

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

    const workedStudents = toNumber(participationOverall[0]?.workedStudents);
    const submittedStudents = toNumber(participationOverall[0]?.submittedStudents);
    const gradedCount = toNumber(overallGrades.gradedCount);
    const passedCount = toNumber(overallGrades.passedCount);
    const averageGrade = Math.round(Number(overallGrades.averageGrade || 0) * 100) / 100;
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
