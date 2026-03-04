import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { neo4jDriver } from '../driver.js';
import { redisClient } from '../../redis/client.js';
import { logUserActivity } from '../../cassandra/services/logsService.js';
import { autoSubmitExam } from '../services/autoSubmitService.js';
import { emitExamChanged } from '../../redis/services/socketService.js';
import { runCppCode } from '../../../services/codeRunner.js';
import { getDefaultLanguageId, isJudge0Configured, runJudge0Code } from '../../../services/judge0.js';
import fs from 'fs/promises';
import path from 'path';

import { GradeStat } from '../../mongodb/models/GradeStat.js';
import {
  logTaskRunEvent,
  markExamSubmitted,
  markExamWithdrawn,
  markExamWorked
} from '../../mongodb/services/analyticsTrackingService.js';
import {
  normalizeQuestionMaxPoints,
  shouldSaveToQuestionBank,
  upsertQuestionBankItemFromTask
} from '../../mongodb/services/questionBankService.js';

const STATE_TTL_SECONDS = 60 * 60 * 24;

const resolveExamState = async (examId: string, scheduledStartTime?: string) => {
  const [status, endTimeRaw, startTimeRaw, remainingRaw] = await redisClient.mGet([
    `exam:${examId}:status`,
    `exam:${examId}:end_time`,
    `exam:${examId}:start_time`,
    `exam:${examId}:remaining_ms`
  ]);

  const startTime = startTimeRaw ? parseInt(startTimeRaw, 10) : undefined;
  const endTime = endTimeRaw ? parseInt(endTimeRaw, 10) : undefined;
  const now = Date.now();
  const scheduledStartMs = scheduledStartTime ? new Date(scheduledStartTime).getTime() : NaN;

  if (status === 'active' && endTime) {
    const remainingMs = Math.max(0, endTime - now);
    if (remainingMs === 0) {
      await redisClient.set(`exam:${examId}:status`, 'completed', { EX: STATE_TTL_SECONDS });
      void autoSubmitExam(examId).catch((error) => {
        console.error('Auto submit failed:', error);
      });
      return { status: 'completed', actualStartTime: startTime, endTime, remainingSeconds: 0 };
    }
    return { status: 'active', actualStartTime: startTime, endTime, remainingSeconds: Math.ceil(remainingMs / 1000) };
  }

  if (status === 'active') {
    return { status: 'active', actualStartTime: startTime, endTime, remainingSeconds: 0 };
  }

  if (status === 'paused') {
    const remainingMs = Math.max(0, parseInt(remainingRaw || '0', 10));
    return { status: 'paused', actualStartTime: startTime, endTime, remainingSeconds: Math.ceil(remainingMs / 1000) };
  }

  if (status === 'completed') {
    return { status: 'completed', actualStartTime: startTime, endTime, remainingSeconds: 0 };
  }

  if (!Number.isNaN(scheduledStartMs) && now < scheduledStartMs) {
    return { status: 'wait_room', actualStartTime: startTime, endTime, remainingSeconds: 0 };
  }

  return { status: 'waiting_start', actualStartTime: startTime, endTime, remainingSeconds: 0 };
};

const getWithdrawnKey = (examId: string, studentId: string) => `exam:${examId}:withdrawn:${studentId}`;
const getSessionKey = (examId: string) => `exam:${examId}:session_id`;

const hasSubmittedExam = async (session: any, examId: string, studentId: string) => {
  const result = await session.run(
    `
    MATCH (u:User {id: $studentId})-[r:SUBMITTED_EXAM]->(e:Exam {id: $examId})
    RETURN count(r) AS submitCount
    `,
    { studentId, examId }
  );
  const countRaw = result.records[0]?.get('submitCount');
  const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
  return count > 0;
};

const fetchSubjectIdForExam = async (examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN s.id AS subjectId
      LIMIT 1
      `,
      { examId }
    );
    if (!result.records.length) {
      return null;
    }
    return String(result.records[0].get('subjectId'));
  } finally {
    await session.close();
  }
};

const findSubjectsByEnrollmentCode = async (
  session: any,
  enrollmentCode: string,
  options?: { excludeSubjectId?: string }
) => {
  const subjectsResult = await session.run(
    `
    MATCH (s:Subject)
    WHERE s.passwordHash IS NOT NULL
    RETURN s
    `
  );

  const matches: Array<Record<string, any>> = [];
  for (const record of subjectsResult.records) {
    const subject = record.get('s')?.properties;
    if (!subject) {
      continue;
    }

    const subjectId = String(subject.id || '');
    if (options?.excludeSubjectId && subjectId === options.excludeSubjectId) {
      continue;
    }

    const passwordHash = String(subject.passwordHash || '');
    if (!passwordHash) {
      continue;
    }

    const isMatch = await bcrypt.compare(enrollmentCode, passwordHash);
    if (isMatch) {
      matches.push(subject);
    }
  }

  return matches;
};

const shouldTreatAsWithdrawn = async (examId: string, studentId: string) => {
  const [withdrawnRaw, sessionId] = await redisClient.mGet([
    getWithdrawnKey(examId, studentId),
    getSessionKey(examId)
  ]);

  if (!withdrawnRaw) {
    return false;
  }

  if (sessionId && withdrawnRaw !== sessionId) {
    await redisClient.del(getWithdrawnKey(examId, studentId));
    const relationSession = neo4jDriver.session();
    try {
      const relationResult = await relationSession.run(
        `
        MATCH (u:User {id: $studentId}), (e:Exam {id: $examId})
        OPTIONAL MATCH (u)-[w:WITHDREW_EXAM]->(e)
        OPTIONAL MATCH (u)-[s:SUBMITTED_EXAM]->(e)
        RETURN count(w) AS withdrawnCount, count(s) AS submittedCount
        `,
        { studentId, examId }
      );
      const withdrawnCount = toNumber(relationResult.records[0]?.get('withdrawnCount'));
      const submittedCount = toNumber(relationResult.records[0]?.get('submittedCount'));
      return withdrawnCount > 0 && submittedCount === 0;
    } finally {
      await relationSession.close();
    }
  }

  const relationSession = neo4jDriver.session();
  try {
    const relationResult = await relationSession.run(
      `
      MATCH (u:User {id: $studentId}), (e:Exam {id: $examId})
      OPTIONAL MATCH (u)-[w:WITHDREW_EXAM]->(e)
      OPTIONAL MATCH (u)-[s:SUBMITTED_EXAM]->(e)
      RETURN count(w) AS withdrawnCount, count(s) AS submittedCount
      `,
      { studentId, examId }
    );

    const withdrawnCount = toNumber(relationResult.records[0]?.get('withdrawnCount'));
    const submittedCount = toNumber(relationResult.records[0]?.get('submittedCount'));
    if (submittedCount > 0 || withdrawnCount === 0) {
      await redisClient.del(getWithdrawnKey(examId, studentId));
      return false;
    }
    return true;
  } finally {
    await relationSession.close();
  }
};

const normalizeMaxPoints = (value: unknown, fallback = 10) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
};

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof (value as { toNumber?: () => number })?.toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const hasStudentSubmittedExam = async (session: any, examId: string, studentId: string) => {
  const submittedResult = await session.run(
    `
    MATCH (u:User {id: $studentId})-[se:SUBMITTED_EXAM]->(e:Exam {id: $examId})
    RETURN count(se) AS submittedCount
    `,
    { examId, studentId }
  );
  const submittedCount = toNumber(submittedResult.records[0]?.get('submittedCount'));
  return submittedCount > 0;
};

const fetchStudentExamPointsSummary = async (session: any, examId: string, studentId: string) => {
  const pointsResult = await session.run(
    `
    MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
    OPTIONAL MATCH (u:User {id: $studentId})-[r:SUBMITTED]->(t)
    RETURN sum(coalesce(toFloat(t.maxPoints), 10.0)) AS totalMaxPoints,
           sum(coalesce(toFloat(r.awardedPoints), 0.0)) AS totalAwardedPoints
    `,
    { examId, studentId }
  );
  return {
    totalMaxPoints: Math.round(toNumber(pointsResult.records[0]?.get('totalMaxPoints')) * 100) / 100,
    totalAwardedPoints: Math.round(toNumber(pointsResult.records[0]?.get('totalAwardedPoints')) * 100) / 100
  };
};

export const createSubject = async (req: any, res: Response) => {
  const { name, description, password } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const enrollmentCode = String(password || '').trim();
    if (!enrollmentCode) {
      return res.status(400).json({ error: 'Subject code is required' });
    }

    const duplicateSubjects = await findSubjectsByEnrollmentCode(session, enrollmentCode);
    if (duplicateSubjects.length > 0) {
      return res.status(409).json({ error: 'Subject code is already in use. Choose a different code.' });
    }

    const passwordHash = await bcrypt.hash(enrollmentCode, 10);
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})
      CREATE (s:Subject {id: $id, name: $name, description: $description, passwordHash: $passwordHash, createdBy: $professorId})
      CREATE (p)-[:PREDAJE]->(s)
      RETURN s
      `,
      { professorId, id, name, description, passwordHash }
    );

    const subject = result.records[0].get('s').properties;
    delete subject.passwordHash;
    res.status(201).json({ ...subject, isCreator: true });
    emitExamChanged(subject.id, 'subject_created');
  } catch (error) {
    res.status(500).json({ error: 'Error while creating subject' });
  } finally {
    await session.close();
  }
};

export const updateSubject = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const { name, description, password, invalidateEnrollments } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    let passwordHash: string | null = null;
    if (typeof password === 'string') {
      const enrollmentCode = password.trim();
      if (!enrollmentCode) {
        return res.status(400).json({ error: 'Subject code cannot be empty' });
      }

      const duplicateSubjects = await findSubjectsByEnrollmentCode(session, enrollmentCode, { excludeSubjectId: subjectId });
      if (duplicateSubjects.length > 0) {
        return res.status(409).json({ error: 'Subject code is already in use. Choose a different code.' });
      }

      passwordHash = await bcrypt.hash(enrollmentCode, 10);
    }

    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      SET s.name = COALESCE($name, s.name),
          s.description = COALESCE($description, s.description),
          s.passwordHash = COALESCE($passwordHash, s.passwordHash)
      RETURN s
      `,
      { professorId, subjectId, name, description, passwordHash }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    if (invalidateEnrollments) {
      await session.run(
        `
        MATCH (s:Subject {id: $subjectId})<-[r:ENROLLED_IN]-(:User)
        DELETE r
        `,
        { subjectId }
      );
    }

    const subject = result.records[0].get('s').properties;
    delete subject.passwordHash;
    res.json(subject);
    emitExamChanged(subject.id, 'subject_updated');
  } catch (error) {
    res.status(500).json({ error: 'Error while updating subject' });
  } finally {
    await session.close();
  }
};

export const deleteSubject = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const examsResult = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      RETURN collect(e.id) AS examIds
      `,
      { professorId, subjectId }
    );

    if (examsResult.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const examIds: string[] = examsResult.records[0].get('examIds') || [];
    if (examIds.length > 0) {
      await Promise.all(
        examIds.map((examId) =>
          redisClient.del([
            `exam:${examId}:status`,
            `exam:${examId}:start_time`,
            `exam:${examId}:end_time`,
            `exam:${examId}:remaining_ms`,
            `exam:${examId}:duration_seconds`
          ])
        )
      );
    }

    await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      DETACH DELETE t, e, s
      `,
      { professorId, subjectId }
    );

    res.json({ message: 'Subject deleted' });
    emitExamChanged(subjectId, 'subject_deleted');
  } catch (error) {
    res.status(500).json({ error: 'Error while deleting subject' });
  } finally {
    await session.close();
  }
};

export const enrollSubject = async (req: any, res: Response) => {
  const { password } = req.body;
  const studentId = req.user?.id;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can enroll' });
  }
  const enrollmentCode = String(password || '').trim();
  if (!enrollmentCode) {
    return res.status(400).json({ error: 'Subject code is required' });
  }

  const session = neo4jDriver.session();
  try {
    const matchedSubjects = await findSubjectsByEnrollmentCode(session, enrollmentCode);
    if (matchedSubjects.length === 0) {
      return res.status(401).json({ error: 'Invalid subject code' });
    }
    if (matchedSubjects.length > 1) {
      return res.status(409).json({ error: 'Subject code is not unique. Contact your professor/admin.' });
    }
    const matchedSubject = matchedSubjects[0];

    const enrollResult = await session.run(
      `
      MATCH (u:User {id: $studentId}), (s:Subject {id: $subjectId})
      MERGE (u)-[:ENROLLED_IN]->(s)
      RETURN s
      `,
      { studentId, subjectId: matchedSubject.id }
    );

    const subject = enrollResult.records[0]?.get('s')?.properties || matchedSubject;
    delete subject.passwordHash;
    res.json(subject);
  } catch (error) {
    res.status(500).json({ error: 'Error while enrolling in subject' });
  } finally {
    await session.close();
  }
};

export const unenrollSubject = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const studentId = req.user?.id;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can unenroll' });
  }

  const session = neo4jDriver.session();
  try {
    await session.run(
      `
      MATCH (u:User {id: $studentId})-[r:ENROLLED_IN]->(s:Subject {id: $subjectId})
      DELETE r
      `,
      { studentId, subjectId }
    );

    res.json({ message: 'Unenrolled' });
  } catch (error) {
    res.status(500).json({ error: 'Error while unenrolling' });
  } finally {
    await session.close();
  }
};

export const getStudentSubjects = async (req: any, res: Response) => {
  const studentId = req.user?.id;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can access subjects' });
  }

  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(s:Subject)
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (u)-[sub:SUBMITTED_EXAM]->(e)
      RETURN s, collect({ exam: e, submitted: sub IS NOT NULL }) AS examData
      ORDER BY s.name
      `,
      { studentId }
    );

    const subjects = [];
    for (const record of result.records) {
      const subject = record.get('s').properties;
      const examData = (record.get('examData') || [])
        .filter((item: any) => item.exam != null);

      const seenIds = new Set<string>();
      const uniqueExamData: any[] = [];
      for (const item of examData) {
        const eid = item.exam.properties.id;
        if (!seenIds.has(eid)) {
          seenIds.add(eid);
          uniqueExamData.push(item);
        }
      }

      const exams = uniqueExamData.map((item: any) => ({
        id: item.exam.properties.id,
        name: item.exam.properties.name,
        startTime: item.exam.properties.startTime,
        durationMinutes: Number(item.exam.properties.durationMinutes),
        maxPoints: normalizeMaxPoints(item.exam.properties.maxPoints, 100),
        subjectId: subject.id,
        subjectName: subject.name,
        _submitted: item.submitted
      }));

      const examsWithStatus = await Promise.all(exams.map(async (exam: any) => {
        if (exam._submitted) {
          return { ...exam, status: 'submitted', remainingSeconds: 0, _submitted: undefined };
        }

        const [state, withdrawn] = await Promise.all([
          resolveExamState(exam.id, exam.startTime),
          shouldTreatAsWithdrawn(exam.id, studentId)
        ]);

        if (withdrawn) {
          return { ...exam, status: 'withdrawn', remainingSeconds: 0, _submitted: undefined };
        }

        const { _submitted, ...rest } = exam;
        return { ...rest, ...state };
      }));

      delete subject.passwordHash;
      subjects.push({
        id: subject.id,
        name: subject.name,
        description: subject.description,
        exams: examsWithStatus
      });
    }

    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching subjects' });
  } finally {
    await session.close();
  }
};

export const createExam = async (req: any, res: Response) => {
  const { subjectId, name, startTime, durationMinutes, maxPoints } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const normalizedExamMaxPoints = normalizeMaxPoints(maxPoints, 100);
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      CREATE (e:Exam {
        id: $id,
        name: $name,
        startTime: $startTime,
        durationMinutes: $durationMinutes,
        maxPoints: $maxPoints
      })
      CREATE (s)-[:SADRZI]->(e)
      RETURN e
      `,
      { professorId, subjectId, id, name, startTime, durationMinutes, maxPoints: normalizedExamMaxPoints }
    );

    if (result.records.length === 0) {
      return res.status(403).json({ error: 'You can only create exams for your subjects' });
    }

    const exam = result.records[0].get('e').properties;
    res.status(201).json({
      ...exam,
      maxPoints: normalizeMaxPoints(exam.maxPoints, normalizedExamMaxPoints)
    });
    emitExamChanged(subjectId, 'exam_created');
  } catch (error) {
    res.status(500).json({ error: 'Error while creating exam' });
  } finally {
    await session.close();
  }
};

export const updateExam = async (req: any, res: Response) => {
  const { examId } = req.params;
  const { name, startTime, durationMinutes, maxPoints } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const normalizedExamMaxPoints = maxPoints !== undefined ? normalizeMaxPoints(maxPoints, 100) : null;
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      SET e.name = COALESCE($name, e.name),
          e.startTime = COALESCE($startTime, e.startTime),
          e.durationMinutes = COALESCE($durationMinutes, e.durationMinutes),
          e.maxPoints = COALESCE($maxPoints, e.maxPoints)
      RETURN e
      `,
      { professorId, examId, name, startTime, durationMinutes, maxPoints: normalizedExamMaxPoints }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const exam = result.records[0].get('e').properties;
    res.json({
      ...exam,
      maxPoints: normalizeMaxPoints(exam.maxPoints, 100)
    });
    emitExamChanged(examId, 'exam_updated');
  } catch (error) {
    res.status(500).json({ error: 'Error while updating exam' });
  } finally {
    await session.close();
  }
};

export const deleteExam = async (req: any, res: Response) => {
  const { examId } = req.params;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      DETACH DELETE t, e
      RETURN count(e) AS deletedCount
      `,
      { professorId, examId }
    );

    const deletedCount = result.records[0]?.get('deletedCount')?.toNumber?.() ?? result.records[0]?.get('deletedCount');
    if (!deletedCount) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    await redisClient.del([
      `exam:${examId}:status`,
      `exam:${examId}:start_time`,
      `exam:${examId}:end_time`,
      `exam:${examId}:remaining_ms`,
      `exam:${examId}:duration_seconds`
    ]);

    res.json({ message: 'Exam deleted' });
    emitExamChanged(examId, 'exam_deleted');
  } catch (error) {
    res.status(500).json({ error: 'Error while deleting exam' });
  } finally {
    await session.close();
  }
};

export const createTask = async (req: any, res: Response) => {
  const {
    examId,
    title,
    maxPoints,
    description,
    starterCode,
    testCases,
    exampleInput,
    exampleOutput,
    notes,
    saveToQuestionBank,
    bankDifficulty,
    bankTags
  } = req.body;
  const professorId = req.user.id;
  const pdfFile = req.file as Express.Multer.File | undefined;
  const pdfPath = pdfFile ? `/uploads/tasks/${pdfFile.filename}` : null;
  const session = neo4jDriver.session();

  try {
    const normalizedTaskMaxPoints = normalizeMaxPoints(maxPoints, 10);
    const id = uuidv4();
    const normalizedTestCases = typeof testCases === 'string' ? testCases : JSON.stringify(testCases || []);
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      CREATE (t:Task {
        id: $id,
        title: $title,
        maxPoints: $maxPoints,
        description: $description,
        starterCode: $starterCode,
        testCases: $testCases,
        pdfPath: $pdfPath,
        exampleInput: $exampleInput,
        exampleOutput: $exampleOutput,
        notes: $notes
      })
      CREATE (e)-[:IMA_ZADATAK]->(t)
      RETURN t, s.id AS subjectId
      `,
      {
        professorId,
        examId,
        id,
        title,
        maxPoints: normalizedTaskMaxPoints,
        description,
        starterCode,
        testCases: normalizedTestCases,
        pdfPath,
        exampleInput: exampleInput || null,
        exampleOutput: exampleOutput || null,
        notes: notes || null
      }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const task = result.records[0].get('t').properties;
    const subjectId = String(result.records[0].get('subjectId'));

    if (shouldSaveToQuestionBank(saveToQuestionBank)) {
      try {
        await upsertQuestionBankItemFromTask({
          subjectId,
          createdByProfessorId: professorId,
          sourceExamId: examId,
          sourceTaskId: id,
          title: String(task.title || title),
          maxPoints: normalizeQuestionMaxPoints(task.maxPoints, normalizedTaskMaxPoints),
          description: (task.description as string | null) || null,
          starterCode: (task.starterCode as string | null) || null,
          testCases: String(task.testCases || normalizedTestCases || '[]'),
          pdfPath: (task.pdfPath as string | null) || null,
          exampleInput: (task.exampleInput as string | null) || null,
          exampleOutput: (task.exampleOutput as string | null) || null,
          notes: (task.notes as string | null) || null,
          difficulty: bankDifficulty,
          tags: bankTags
        });
      } catch (mongoError) {
        console.error('Failed to store task in question bank:', mongoError);
      }
    }

    const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
    res.status(201).json({
      ...task,
      maxPoints: normalizeMaxPoints(task.maxPoints, normalizedTaskMaxPoints),
      pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null,
      savedToQuestionBank: shouldSaveToQuestionBank(saveToQuestionBank)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error while creating task' });
  } finally {
    await session.close();
  }
};

export const updateTask = async (req: any, res: Response) => {
  const { taskId } = req.params;
  const {
    title,
    maxPoints,
    description,
    starterCode,
    testCases,
    exampleInput,
    exampleOutput,
    notes,
    saveToQuestionBank,
    bankDifficulty,
    bankTags
  } = req.body;
  const professorId = req.user.id;
  const pdfFile = req.file as Express.Multer.File | undefined;
  const session = neo4jDriver.session();

  try {
    const existing = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)-[:SADRZI]->(e:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      RETURN t, s.id AS subjectId, e.id AS examId
      `,
      { professorId, taskId }
    );

    if (existing.records.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const current = existing.records[0].get('t').properties;
    const subjectId = String(existing.records[0].get('subjectId'));
    const examId = String(existing.records[0].get('examId'));
    let pdfPath = current.pdfPath || null;

    if (pdfFile) {
      if (pdfPath) {
        const absolute = path.join(process.cwd(), pdfPath.replace(/^\//, ''));
        await fs.unlink(absolute).catch(() => {});
      }
      pdfPath = `/uploads/tasks/${pdfFile.filename}`;
    }

    const normalizedTaskMaxPoints = maxPoints !== undefined ? normalizeMaxPoints(maxPoints, 10) : null;
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      SET t.title = COALESCE($title, t.title),
          t.maxPoints = COALESCE($maxPoints, t.maxPoints),
          t.description = COALESCE($description, t.description),
          t.starterCode = COALESCE($starterCode, t.starterCode),
          t.testCases = COALESCE($testCases, t.testCases),
          t.pdfPath = COALESCE($pdfPath, t.pdfPath),
          t.exampleInput = COALESCE($exampleInput, t.exampleInput),
          t.exampleOutput = COALESCE($exampleOutput, t.exampleOutput),
          t.notes = COALESCE($notes, t.notes)
      RETURN t
      `,
      {
        professorId,
        taskId,
        title,
        maxPoints: normalizedTaskMaxPoints,
        description,
        starterCode,
        testCases: typeof testCases === 'string' ? testCases : testCases ? JSON.stringify(testCases) : null,
        pdfPath,
        exampleInput: exampleInput || null,
        exampleOutput: exampleOutput || null,
        notes: notes || null
      }
    );

    const task = result.records[0].get('t').properties;

    if (shouldSaveToQuestionBank(saveToQuestionBank)) {
      try {
        await upsertQuestionBankItemFromTask({
          subjectId,
          createdByProfessorId: professorId,
          sourceExamId: examId,
          sourceTaskId: taskId,
          title: String(task.title || title),
          maxPoints: normalizeQuestionMaxPoints(task.maxPoints, 10),
          description: (task.description as string | null) || null,
          starterCode: (task.starterCode as string | null) || null,
          testCases: String(task.testCases || '[]'),
          pdfPath: (task.pdfPath as string | null) || null,
          exampleInput: (task.exampleInput as string | null) || null,
          exampleOutput: (task.exampleOutput as string | null) || null,
          notes: (task.notes as string | null) || null,
          difficulty: bankDifficulty,
          tags: bankTags
        });
      } catch (mongoError) {
        console.error('Failed to update question bank item from task:', mongoError);
      }
    }

    const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
    res.json({
      ...task,
      maxPoints: normalizeMaxPoints(task.maxPoints, 10),
      pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null,
      savedToQuestionBank: shouldSaveToQuestionBank(saveToQuestionBank)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error while updating task' });
  } finally {
    await session.close();
  }
};

export const deleteTask = async (req: any, res: Response) => {
  const { taskId } = req.params;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      RETURN t
      `,
      { professorId, taskId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.records[0].get('t').properties;
    if (task.pdfPath) {
      const absolute = path.join(process.cwd(), String(task.pdfPath).replace(/^\//, ''));
      await fs.unlink(absolute).catch(() => {});
    }

    await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      DETACH DELETE t
      `,
      { professorId, taskId }
    );

    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error while deleting task' });
  } finally {
    await session.close();
  }
};

export const getAvailableExams = async (req: any, res: Response) => {
  const session = neo4jDriver.session();

  try {
    const isStudent = req.user?.role === 'STUDENT' && req.user?.id;
    const result = await session.run(
      isStudent
        ? `
          MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(s:Subject)-[:SADRZI]->(e:Exam)
          RETURN e, s
          ORDER BY e.startTime
          `
        : `
          MATCH (s:Subject)-[]->(e:Exam)
          RETURN e, s
          ORDER BY e.startTime
          `,
      isStudent ? { studentId: req.user.id } : {}
    );

    const exams = result.records.map(record => {
      const exam = record.get('e').properties;
      const subject = record.get('s').properties;
      return {
        id: exam.id,
        name: exam.name,
        startTime: exam.startTime,
        durationMinutes: Number(exam.durationMinutes),
        maxPoints: normalizeMaxPoints(exam.maxPoints, 100),
        subjectId: subject.id,
        subjectName: subject.name
      };
    });

    const examsWithStatus = [];
    for (const exam of exams) {
      const state = await resolveExamState(exam.id, exam.startTime);
      if (req.user?.role === 'STUDENT' && req.user?.id) {
        const submitted = await hasSubmittedExam(session, exam.id, req.user.id);
        if (submitted) {
          examsWithStatus.push({ ...exam, status: 'submitted', remainingSeconds: 0 });
          continue;
        }
        const withdrawn = await shouldTreatAsWithdrawn(exam.id, req.user.id);
        if (withdrawn) {
          examsWithStatus.push({ ...exam, status: 'withdrawn', remainingSeconds: 0 });
          continue;
        }
      }
      examsWithStatus.push({ ...exam, ...state });
    }

    res.json(examsWithStatus);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching exams' });
  } finally {
    await session.close();
  }
};

export const getExamById = async (req: any, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    if (req.user?.role === 'STUDENT' && req.user?.id) {
      const access = await session.run(
        `
        MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
        RETURN count(e) AS examCount
        `,
        { studentId: req.user.id, examId }
      );
      const countRaw = access.records[0]?.get('examCount');
      const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
      if (!count) {
        return res.status(403).json({ error: 'You are not enrolled in this subject' });
      }
    }

    const result = await session.run(
      `
      MATCH (s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN e, s
      `,
      { examId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const exam = result.records[0].get('e').properties;
    const subject = result.records[0].get('s').properties;

    const state = await resolveExamState(exam.id, exam.startTime);
    if (req.user?.role === 'STUDENT' && req.user?.id) {
      const submitted = await hasSubmittedExam(session, exam.id, req.user.id);
      if (submitted) {
        return res.json({
          id: exam.id,
          name: exam.name,
          startTime: exam.startTime,
          durationMinutes: Number(exam.durationMinutes),
          maxPoints: normalizeMaxPoints(exam.maxPoints, 100),
          subjectId: subject.id,
          subjectName: subject.name,
          status: 'submitted',
          remainingSeconds: 0
        });
      }
      const withdrawn = await shouldTreatAsWithdrawn(exam.id, req.user.id);
      if (withdrawn) {
        return res.json({
          id: exam.id,
          name: exam.name,
          startTime: exam.startTime,
          durationMinutes: Number(exam.durationMinutes),
          maxPoints: normalizeMaxPoints(exam.maxPoints, 100),
          subjectId: subject.id,
          subjectName: subject.name,
          status: 'withdrawn',
          remainingSeconds: 0
        });
      }
    }

    res.json({
      id: exam.id,
      name: exam.name,
      startTime: exam.startTime,
      durationMinutes: Number(exam.durationMinutes),
      maxPoints: normalizeMaxPoints(exam.maxPoints, 100),
      subjectId: subject.id,
      subjectName: subject.name,
      ...state
    });
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching exam' });
  } finally {
    await session.close();
  }
};

export const getProfessorSubjects = async (req: any, res: Response) => {
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      RETURN s, e, count(t) AS taskCount
      ORDER BY s.name
      `,
      { professorId }
    );

    const subjectsMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      createdBy: string | null;
      isCreator: boolean;
      exams: any[];
    }>();

    for (const record of result.records) {
      const subject = record.get('s').properties;
      const exam = record.get('e');
      const taskCountRaw = record.get('taskCount');
      const taskCount = typeof taskCountRaw?.toNumber === 'function' ? taskCountRaw.toNumber() : Number(taskCountRaw || 0);

      if (!subjectsMap.has(subject.id)) {
        subjectsMap.set(subject.id, {
          id: subject.id,
          name: subject.name,
          description: subject.description,
          createdBy: subject.createdBy || null,
          isCreator: subject.createdBy === professorId || !subject.createdBy,
          exams: []
        });
      }

      if (exam) {
        const examProps = exam.properties;
        subjectsMap.get(subject.id)!.exams.push({
          id: examProps.id,
          name: examProps.name,
          startTime: examProps.startTime,
          durationMinutes: Number(examProps.durationMinutes),
          maxPoints: normalizeMaxPoints(examProps.maxPoints, 100),
          subjectId: subject.id,
          subjectName: subject.name,
          taskCount
        });
      }
    }

    const subjects = await Promise.all(
      Array.from(subjectsMap.values()).map(async (subject) => ({
        ...subject,
        exams: await Promise.all(
          subject.exams.map(async (exam) => ({
            ...exam,
            ...(await resolveExamState(exam.id, exam.startTime))
          }))
        )
      }))
    );

    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching subjects' });
  } finally {
    await session.close();
  }
};

export const addProfessorToSubject = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const { email } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (owner:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      WHERE s.createdBy = $professorId OR s.createdBy IS NULL
      MATCH (p:User {email: $email, role: 'PROFESSOR'})
      MERGE (p)-[:PREDAJE]->(s)
      SET s.createdBy = COALESCE(s.createdBy, $professorId)
      RETURN p, s
      `,
      { professorId, subjectId, email }
    );

    if (result.records.length === 0) {
      return res.status(403).json({ error: 'Only the subject creator can add professors' });
    }

    res.json({ message: 'Professor added to subject' });
  } catch (error) {
    res.status(500).json({ error: 'Error while adding professor to subject' });
  } finally {
    await session.close();
  }
};

export const getExamTasks = async (req: any, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    if (req.user?.role === 'STUDENT' && req.user?.id) {
      const access = await session.run(
        `
        MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
        RETURN count(e) AS examCount
        `,
        { studentId: req.user.id, examId }
      );
      const countRaw = access.records[0]?.get('examCount');
      const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
      if (!count) {
        return res.status(403).json({ error: 'You are not enrolled in this subject' });
      }
    }

    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      RETURN t
      ORDER BY t.title
      `,
      { examId }
    );

    const tasks = result.records.map(record => {
      const task = record.get('t').properties;
      const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
      return {
        id: task.id,
        title: task.title,
        maxPoints: normalizeMaxPoints(task.maxPoints, 10),
        description: task.description,
        starterCode: task.starterCode,
        testCases: task.testCases,
        pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null,
        exampleInput: task.exampleInput || null,
        exampleOutput: task.exampleOutput || null,
        notes: task.notes || null
      };
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching tasks' });
  } finally {
    await session.close();
  }
};

export const runCode = async (req: any, res: Response) => {
  const { examId } = req.params;
  const { taskId, sourceCode, input, languageId } = req.body;
  const studentId = req.user?.id;
  let subjectId: string | null = null;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can run code' });
  }
  if (!taskId || sourceCode === undefined) {
    return res.status(400).json({ error: 'Missing required fields: taskId, sourceCode' });
  }

  const session = neo4jDriver.session();
  try {
    const access = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount, head(collect(s.id)) AS subjectId
      `,
      { studentId, examId }
    );
    const countRaw = access.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }
    const subjectIdRaw = access.records[0]?.get('subjectId');
    subjectId = subjectIdRaw ? String(subjectIdRaw) : null;

    const taskCheck = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      RETURN t
      `,
      { examId, taskId }
    );
    if (taskCheck.records.length === 0) {
      return res.status(404).json({ error: 'Task not found for exam' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Error while validating exam access' });
  } finally {
    await session.close();
  }

  try {
    if (isJudge0Configured()) {
      const resolvedLanguageId = languageId ?? await getDefaultLanguageId();
      if (!resolvedLanguageId) {
        return res.status(400).json({ error: 'Language is required to run code.' });
      }
      const result = await runJudge0Code({
        sourceCode: String(sourceCode),
        input: String(input || ''),
        languageId: Number(resolvedLanguageId)
      });

      if (subjectId) {
        await Promise.allSettled([
          markExamWorked({ examId, subjectId, studentId }),
          logTaskRunEvent({
            examId,
            subjectId,
            studentId,
            taskId: String(taskId),
            status: result?.ok ? 'SUCCESS' : 'ERROR'
          })
        ]);
      }

      return res.json(result);
    }

    const result = await runCppCode(String(sourceCode), String(input || ''));
    if (subjectId) {
      await Promise.allSettled([
        markExamWorked({ examId, subjectId, studentId }),
        logTaskRunEvent({
          examId,
          subjectId,
          studentId,
          taskId: String(taskId),
          status: result?.ok ? 'SUCCESS' : 'ERROR'
        })
      ]);
    }
    res.json(result);
  } catch (error) {
    if (subjectId) {
      await Promise.allSettled([
        markExamWorked({ examId, subjectId, studentId }),
        logTaskRunEvent({
          examId,
          subjectId,
          studentId,
          taskId: String(taskId),
          status: 'ERROR'
        })
      ]);
    }
    res.status(500).json({ error: 'Error while running code' });
  }
};

export const saveSubmission = async (req: any, res: Response) => {
  const { examId } = req.params;
  const { taskId, sourceCode, output } = req.body;
  const studentId = req.user?.id;
  let subjectId: string | null = null;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can save submissions' });
  }
  if (!taskId || sourceCode === undefined) {
    return res.status(400).json({ error: 'Missing required fields: taskId, sourceCode' });
  }

  const session = neo4jDriver.session();
  try {
    const access = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount, head(collect(s.id)) AS subjectId
      `,
      { studentId, examId }
    );
    const countRaw = access.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }
    const subjectIdRaw = access.records[0]?.get('subjectId');
    subjectId = subjectIdRaw ? String(subjectIdRaw) : null;

    const result = await session.run(
      `
      MATCH (u:User {id: $studentId})
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      MERGE (u)-[r:SUBMITTED]->(t)
      SET r.sourceCode = $sourceCode,
          r.output = $output,
          r.updatedAt = datetime()
      RETURN t.id AS taskId, r.sourceCode AS sourceCode, r.output AS output, r.updatedAt AS updatedAt
      `,
      { studentId, examId, taskId, sourceCode, output: output || '' }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Task not found for exam' });
    }

    const record = result.records[0];
    if (subjectId) {
      await markExamWorked({ examId, subjectId, studentId }).catch((mongoError) => {
        console.error('Failed to update participation after saveSubmission:', mongoError);
      });
    }
    res.json({
      taskId: record.get('taskId'),
      sourceCode: record.get('sourceCode'),
      output: record.get('output'),
      updatedAt: record.get('updatedAt')?.toString?.() || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Error while saving submission' });
  } finally {
    await session.close();
  }
};

export const getMySubmissions = async (req: any, res: Response) => {
  const { examId } = req.params;
  const studentId = req.user?.id;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can view submissions' });
  }

  const session = neo4jDriver.session();
  try {
    const access = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount
      `,
      { studentId, examId }
    );
    const countRaw = access.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }

    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      OPTIONAL MATCH (u:User {id: $studentId})-[r:SUBMITTED]->(t)
      RETURN t, r
      ORDER BY t.title
      `,
      { examId, studentId }
    );

    const submissions = result.records.map(record => {
      const task = record.get('t').properties;
      const rel = record.get('r');
      return {
        taskId: task.id,
        taskTitle: task.title,
        taskMaxPoints: normalizeMaxPoints(task.maxPoints, 10),
        awardedPoints: rel?.properties?.awardedPoints !== undefined && rel?.properties?.awardedPoints !== null
          ? Number(rel.properties.awardedPoints)
          : null,
        sourceCode: rel?.properties?.sourceCode || '',
        output: rel?.properties?.output || '',
        updatedAt: rel?.properties?.updatedAt || null
      };
    });

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching submissions' });
  } finally {
    await session.close();
  }
};

export const getStudentSubmissions = async (req: any, res: Response) => {
  const { examId, studentId } = req.params;
  const professorId = req.user?.id;

  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can view student submissions' });
  }
  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const session = neo4jDriver.session();
  try {
    const accessCheck = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount
      `,
      { professorId, examId }
    );
    if (!toNumber(accessCheck.records[0]?.get('examCount'))) {
      return res.status(403).json({ error: 'You do not have access to this exam' });
    }

    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      OPTIONAL MATCH (u:User {id: $studentId})-[r:SUBMITTED]->(t)
      RETURN t, r
      ORDER BY t.title
      `,
      { examId, studentId }
    );

    const submissions = result.records.map(record => {
      const task = record.get('t').properties;
      const rel = record.get('r');
      return {
        taskId: task.id,
        taskTitle: task.title,
        taskMaxPoints: normalizeMaxPoints(task.maxPoints, 10),
        awardedPoints: rel?.properties?.awardedPoints !== undefined && rel?.properties?.awardedPoints !== null
          ? Number(rel.properties.awardedPoints)
          : null,
        sourceCode: rel?.properties?.sourceCode || '',
        output: rel?.properties?.output || '',
        updatedAt: rel?.properties?.updatedAt || null
      };
    });

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching submissions' });
  } finally {
    await session.close();
  }
};

export const submitExam = async (req: any, res: Response) => {
  const { examId } = req.params;
  const studentId = req.user?.id;
  let subjectId: string | null = null;

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can submit exams' });
  }

  const session = neo4jDriver.session();
  try {
    const access = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount, head(collect(s.id)) AS subjectId
      `,
      { studentId, examId }
    );
    const countRaw = access.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }
    const subjectIdRaw = access.records[0]?.get('subjectId');
    subjectId = subjectIdRaw ? String(subjectIdRaw) : null;

    await session.run(
      `
      MATCH (u:User {id: $studentId}), (e:Exam {id: $examId})
      MERGE (u)-[r:SUBMITTED_EXAM]->(e)
      SET r.submittedAt = datetime()
      WITH u, e
      OPTIONAL MATCH (u)-[w:WITHDREW_EXAM]->(e)
      DELETE w
      `,
      { studentId, examId }
    );

    await redisClient.del(getWithdrawnKey(examId, studentId));

    if (subjectId) {
      await markExamSubmitted({ examId, subjectId, studentId }).catch((mongoError) => {
        console.error('Failed to update participation after submitExam:', mongoError);
      });
    }

    res.json({ message: 'Submitted' });
  } catch (error) {
    res.status(500).json({ error: 'Error while submitting exam' });
  } finally {
    await session.close();
  }
};

export const withdrawExam = async (req: any, res: Response) => {
  const { examId } = req.params;
  const studentId = req.user?.id;
  if (!studentId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'STUDENT') {
    return res.status(403).json({ error: 'Only students can withdraw' });
  }

  const session = neo4jDriver.session();
  try {
    const access = await session.run(
      `
      MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount
      `,
      { studentId, examId }
    );
    const count = toNumber(access.records[0]?.get('examCount'));
    if (!count) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }

    const sessionId = await redisClient.get(getSessionKey(examId));
    await redisClient.set(getWithdrawnKey(examId, studentId), sessionId || 'true', { EX: STATE_TTL_SECONDS });
    await session.run(
      `
      MATCH (u:User {id: $studentId}), (e:Exam {id: $examId})
      MERGE (u)-[w:WITHDREW_EXAM]->(e)
      SET w.updatedAt = datetime()
      `,
      { studentId, examId }
    );

    const subjectId = await fetchSubjectIdForExam(examId);
    if (subjectId) {
      await markExamWithdrawn({ examId, subjectId, studentId }).catch((mongoError) => {
        console.error('Failed to update participation after withdrawExam:', mongoError);
      });
    }
    await logUserActivity(studentId, 'EXAM_WITHDRAW', {
      examId
    });
    res.json({ message: 'Withdrawn' });
  } catch (error) {
    res.status(500).json({ error: 'Error while withdrawing from exam' });
  } finally {
    await session.close();
  }
};

export const setGrade = async (req: any, res: Response) => {
  const { examId, studentId } = req.params;
  const { value, comment } = req.body;
  const professorId = req.user?.id;
  let subjectId: string | null = null;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can set grades' });
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 5 || numericValue > 10) {
    return res.status(400).json({ error: 'Grade must be a number between 5 and 10' });
  }

  const session = neo4jDriver.session();
  try {
    // Verify professor owns the exam
    const accessCheck = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount, head(collect(s.id)) AS subjectId
      `,
      { professorId, examId }
    );
    const countRaw = accessCheck.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You do not have access to this exam' });
    }
    const subjectIdRaw = accessCheck.records[0]?.get('subjectId');
    subjectId = subjectIdRaw ? String(subjectIdRaw) : null;

    const submitted = await hasStudentSubmittedExam(session, examId, studentId);
    if (!submitted) {
      return res.status(400).json({ error: 'Student has not submitted this exam yet' });
    }

    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})
      MATCH (s:User {id: $studentId})
      MERGE (e)-[:HAS_GRADE]->(g:Grade {examId: $examId, studentId: $studentId})
      SET g.value = $value,
          g.comment = $comment,
          g.professorId = $professorId,
          g.updatedAt = datetime()
      RETURN g
      `,
      { examId, studentId, value: numericValue, comment: comment || '', professorId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam or student not found' });
    }

    const grade = result.records[0].get('g').properties;
    
    // --- DODATO ZA MONGODB STATISTIKU ---
    // Kada se ocena sačuva u Neo4j, beležimo i statistiku u MongoDB
    try {
      await GradeStat.findOneAndUpdate(
        { examId, studentId }, // Trazimo da li vec postoji ocena
        {
          subjectId,
          examId,
          studentId,
          professorId,
          gradeValue: numericValue,
          passed: numericValue > 5, // Položio ako je ocena veća od 5
          gradedAt: new Date()
        },
        { upsert: true, new: true } // Kreiraj ako ne postoji, updateuj ako postoji
      );
    } catch (mongoError) {
      console.error('Failed to save grade stat to MongoDB:', mongoError);
      // Ne prekidamo request, jer je ocena uspesno sacuvana u glavnoj (Neo4j) bazi
    }
    // ------------------------------------

    const pointsSummary = await fetchStudentExamPointsSummary(session, examId, studentId);
    res.json({
      examId: grade.examId,
      studentId: grade.studentId,
      value: grade.value,
      comment: grade.comment,
      professorId: grade.professorId,
      updatedAt: grade.updatedAt?.toString?.() || null,
      totalAwardedPoints: pointsSummary.totalAwardedPoints,
      totalMaxPoints: pointsSummary.totalMaxPoints
    });
  } catch (error) {
    console.error('Set grade error:', error);
    res.status(500).json({ error: 'Error while setting grade' });
  } finally {
    await session.close();
  }
};

export const setTaskPoints = async (req: any, res: Response) => {
  const { examId, studentId } = req.params;
  const { taskId, points } = req.body;
  const professorId = req.user?.id;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can set task points' });
  }

  const numericPoints = Number(points);
  if (!Number.isFinite(numericPoints) || numericPoints < 0) {
    return res.status(400).json({ error: 'Points must be a non-negative number' });
  }

  const session = neo4jDriver.session();
  try {
    const accessCheck = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount
      `,
      { professorId, examId }
    );
    if (!toNumber(accessCheck.records[0]?.get('examCount'))) {
      return res.status(403).json({ error: 'You do not have access to this exam' });
    }

    const submitted = await hasStudentSubmittedExam(session, examId, studentId);
    if (!submitted) {
      return res.status(400).json({ error: 'Student has not submitted this exam yet' });
    }

    const taskCheck = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      RETURN t.maxPoints AS taskMaxPoints
      `,
      { professorId, examId, taskId }
    );
    if (taskCheck.records.length === 0) {
      return res.status(404).json({ error: 'Task not found in this exam' });
    }

    const taskMaxPoints = normalizeMaxPoints(taskCheck.records[0].get('taskMaxPoints'), 10);
    if (numericPoints > taskMaxPoints) {
      return res.status(400).json({ error: `Points cannot exceed task max points (${taskMaxPoints})` });
    }

    const saveResult = await session.run(
      `
      MATCH (u:User {id: $studentId})
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      MERGE (u)-[r:SUBMITTED]->(t)
      SET r.awardedPoints = $points,
          r.gradedBy = $professorId,
          r.gradedAt = datetime(),
          r.updatedAt = coalesce(r.updatedAt, datetime()),
          r.sourceCode = coalesce(r.sourceCode, ''),
          r.output = coalesce(r.output, '')
      RETURN r.awardedPoints AS awardedPoints
      `,
      { examId, taskId, studentId, points: Math.round(numericPoints * 100) / 100, professorId }
    );

    const awardedPoints = toNumber(saveResult.records[0]?.get('awardedPoints'));
    const pointsSummary = await fetchStudentExamPointsSummary(session, examId, studentId);

    return res.json({
      examId,
      studentId,
      taskId,
      points: awardedPoints,
      taskMaxPoints,
      totalAwardedPoints: pointsSummary.totalAwardedPoints,
      totalMaxPoints: pointsSummary.totalMaxPoints
    });
  } catch (error) {
    console.error('Set task points error:', error);
    return res.status(500).json({ error: 'Error while setting task points' });
  } finally {
    await session.close();
  }
};

export const getGrade = async (req: any, res: Response) => {
  const { examId, studentId } = req.params;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Students can only view their own grades
  if (userRole === 'STUDENT' && studentId !== userId) {
    return res.status(403).json({ error: 'You can only view your own grade' });
  }

  const session = neo4jDriver.session();
  try {
    // For professors, verify they own the exam
    if (userRole === 'PROFESSOR') {
      const accessCheck = await session.run(
        `
        MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
        RETURN count(e) AS examCount
        `,
        { professorId: userId, examId }
      );
      const countRaw = accessCheck.records[0]?.get('examCount');
      const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
      if (!count) {
        return res.status(403).json({ error: 'You do not have access to this exam' });
      }
    }

    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:HAS_GRADE]->(g:Grade {studentId: $studentId})
      RETURN g
      `,
      { examId, studentId }
    );

    if (result.records.length === 0) {
      return res.json(null);
    }

    const grade = result.records[0].get('g').properties;
    const pointsSummary = await fetchStudentExamPointsSummary(session, examId, studentId);
    res.json({
      examId: grade.examId,
      studentId: grade.studentId,
      value: grade.value,
      comment: grade.comment,
      professorId: grade.professorId,
      updatedAt: grade.updatedAt?.toString?.() || null,
      totalAwardedPoints: pointsSummary.totalAwardedPoints,
      totalMaxPoints: pointsSummary.totalMaxPoints
    });
  } catch (error) {
    console.error('Get grade error:', error);
    res.status(500).json({ error: 'Error while fetching grade' });
  } finally {
    await session.close();
  }
};

export const getExamStudents = async (req: any, res: Response) => {
  const { examId } = req.params;
  const professorId = req.user?.id;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can view exam students' });
  }

  const session = neo4jDriver.session();
  try {
    // Verify professor owns the exam
    const accessCheck = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN count(e) AS examCount
      `,
      { professorId, examId }
    );
    const countRaw = accessCheck.records[0]?.get('examCount');
    const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
    if (!count) {
      return res.status(403).json({ error: 'You do not have access to this exam' });
    }

    const result = await session.run(
      `
      MATCH (s:User)-[sub:SUBMITTED_EXAM]->(e:Exam {id: $examId})
      OPTIONAL MATCH (e)-[:HAS_GRADE]->(g:Grade {studentId: s.id})
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      OPTIONAL MATCH (s)-[r:SUBMITTED]->(t)
      RETURN s.id AS studentId,
             s.email AS email,
             s.firstName AS firstName,
             s.lastName AS lastName,
             sub.submittedAt AS submittedAt,
             g.value AS gradeValue,
             g.comment AS gradeComment,
             g.updatedAt AS gradeUpdatedAt,
             sum(coalesce(toFloat(t.maxPoints), 10.0)) AS totalMaxPoints,
             sum(coalesce(toFloat(r.awardedPoints), 0.0)) AS totalAwardedPoints
      ORDER BY s.lastName, s.firstName
      `,
      { examId }
    );

    const students = result.records.map(record => ({
      studentId: record.get('studentId'),
      email: record.get('email'),
      firstName: record.get('firstName'),
      lastName: record.get('lastName'),
      submittedAt: record.get('submittedAt')?.toString?.() || null,
      totalMaxPoints: Math.round(toNumber(record.get('totalMaxPoints')) * 100) / 100,
      totalAwardedPoints: Math.round(toNumber(record.get('totalAwardedPoints')) * 100) / 100,
      grade: record.get('gradeValue') !== null ? {
        value: record.get('gradeValue'),
        comment: record.get('gradeComment') || '',
        updatedAt: record.get('gradeUpdatedAt')?.toString?.() || null
      } : null
    }));

    res.json(students);
  } catch (error) {
    console.error('Get exam students error:', error);
    res.status(500).json({ error: 'Error while fetching exam students' });
  } finally {
    await session.close();
  }
};
