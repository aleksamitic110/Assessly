import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { neo4jDriver } from '../driver.js';
import { redisClient } from '../../redis/client.js';
import { logUserActivity } from '../../cassandra/services/logsService.js';
import fs from 'fs/promises';
import path from 'path';

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
    return false;
  }

  return true;
};

export const createSubject = async (req: any, res: Response) => {
  const { name, description, password } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    if (!password) {
      return res.status(400).json({ error: 'Subject password is required' });
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})
      CREATE (s:Subject {id: $id, name: $name, description: $description, passwordHash: $passwordHash})
      CREATE (p)-[:PREDAJE]->(s)
      RETURN s
      `,
      { professorId, id, name, description, passwordHash }
    );

    const subject = result.records[0].get('s').properties;
    delete subject.passwordHash;
    res.status(201).json(subject);
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
    const passwordHash = password ? await bcrypt.hash(String(password), 10) : null;
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
          redisClient.del(
            `exam:${examId}:status`,
            `exam:${examId}:start_time`,
            `exam:${examId}:end_time`,
            `exam:${examId}:remaining_ms`,
            `exam:${examId}:duration_seconds`
          )
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
  if (!password) {
    return res.status(400).json({ error: 'Subject password is required' });
  }

  const session = neo4jDriver.session();
  try {
    const subjectsResult = await session.run(
      `
      MATCH (s:Subject)
      WHERE s.passwordHash IS NOT NULL
      RETURN s
      `
    );

    let matchedSubject: any = null;
    for (const record of subjectsResult.records) {
      const subject = record.get('s').properties;
      if (!subject.passwordHash) {
        continue;
      }
      const isMatch = await bcrypt.compare(String(password), String(subject.passwordHash));
      if (isMatch) {
        matchedSubject = subject;
        break;
      }
    }

    if (!matchedSubject) {
      return res.status(401).json({ error: 'Invalid subject password' });
    }

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
      RETURN s, collect(e) AS exams
      ORDER BY s.name
      `,
      { studentId }
    );

    const subjects = await Promise.all(result.records.map(async record => {
      const subject = record.get('s').properties;
      const exams = (record.get('exams') || [])
        .filter((exam: any) => exam)
        .map((exam: any) => ({
          id: exam.properties.id,
          name: exam.properties.name,
          startTime: exam.properties.startTime,
          durationMinutes: Number(exam.properties.durationMinutes),
          subjectId: subject.id,
          subjectName: subject.name
        }));

      const examsWithStatus = await Promise.all(
        exams.map(async (exam) => {
          const state = await resolveExamState(exam.id, exam.startTime);
          const submitted = await hasSubmittedExam(session, exam.id, studentId);
          if (submitted) {
            return { ...exam, status: 'submitted', remainingSeconds: 0 };
          }
          const withdrawn = await shouldTreatAsWithdrawn(exam.id, studentId);
          if (withdrawn) {
            return { ...exam, status: 'withdrawn', remainingSeconds: 0 };
          }
          return { ...exam, ...state };
        })
      );

      delete subject.passwordHash;
      return {
        id: subject.id,
        name: subject.name,
        description: subject.description,
        exams: examsWithStatus
      };
    }));

    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Error while fetching subjects' });
  } finally {
    await session.close();
  }
};

export const createExam = async (req: any, res: Response) => {
  const { subjectId, name, startTime, durationMinutes } = req.body;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})
      CREATE (e:Exam {id: $id, name: $name, startTime: $startTime, durationMinutes: $durationMinutes})
      CREATE (s)-[:SADRZI]->(e)
      RETURN e
      `,
      { subjectId, id, name, startTime, durationMinutes }
    );

    res.status(201).json(result.records[0].get('e').properties);
  } catch (error) {
    res.status(500).json({ error: 'Error while creating exam' });
  } finally {
    await session.close();
  }
};

export const updateExam = async (req: any, res: Response) => {
  const { examId } = req.params;
  const { name, startTime, durationMinutes } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      SET e.name = COALESCE($name, e.name),
          e.startTime = COALESCE($startTime, e.startTime),
          e.durationMinutes = COALESCE($durationMinutes, e.durationMinutes)
      RETURN e
      `,
      { professorId, examId, name, startTime, durationMinutes }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    res.json(result.records[0].get('e').properties);
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

    await redisClient.del(
      `exam:${examId}:status`,
      `exam:${examId}:start_time`,
      `exam:${examId}:end_time`,
      `exam:${examId}:remaining_ms`,
      `exam:${examId}:duration_seconds`
    );

    res.json({ message: 'Exam deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error while deleting exam' });
  } finally {
    await session.close();
  }
};

export const createTask = async (req: any, res: Response) => {
  const { examId, title, description, starterCode, testCases, exampleInput, exampleOutput, notes } = req.body;
  const professorId = req.user.id;
  const pdfFile = req.file as Express.Multer.File | undefined;
  const pdfPath = pdfFile ? `/uploads/tasks/${pdfFile.filename}` : null;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      CREATE (t:Task {
        id: $id,
        title: $title,
        description: $description,
        starterCode: $starterCode,
        testCases: $testCases,
        pdfPath: $pdfPath,
        exampleInput: $exampleInput,
        exampleOutput: $exampleOutput,
        notes: $notes
      })
      CREATE (e)-[:IMA_ZADATAK]->(t)
      RETURN t
      `,
      {
        professorId,
        examId,
        id,
        title,
        description,
        starterCode,
        testCases: typeof testCases === 'string' ? testCases : JSON.stringify(testCases || []),
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
    const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
    res.status(201).json({
      ...task,
      pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Error while creating task' });
  } finally {
    await session.close();
  }
};

export const updateTask = async (req: any, res: Response) => {
  const { taskId } = req.params;
  const { title, description, starterCode, testCases, exampleInput, exampleOutput, notes } = req.body;
  const professorId = req.user.id;
  const pdfFile = req.file as Express.Multer.File | undefined;
  const session = neo4jDriver.session();

  try {
    const existing = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      RETURN t
      `,
      { professorId, taskId }
    );

    if (existing.records.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const current = existing.records[0].get('t').properties;
    let pdfPath = current.pdfPath || null;

    if (pdfFile) {
      if (pdfPath) {
        const absolute = path.join(process.cwd(), pdfPath.replace(/^\//, ''));
        await fs.unlink(absolute).catch(() => {});
      }
      pdfPath = `/uploads/tasks/${pdfFile.filename}`;
    }

    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(:Subject)-[:SADRZI]->(:Exam)-[:IMA_ZADATAK]->(t:Task {id: $taskId})
      SET t.title = COALESCE($title, t.title),
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
    const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
    res.json({
      ...task,
      pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null
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
        subjectId: subject.id,
        subjectName: subject.name
      };
    });

    const examsWithStatus = await Promise.all(
      exams.map(async (exam) => {
        const state = await resolveExamState(exam.id, exam.startTime);
        if (req.user?.role === 'STUDENT' && req.user?.id) {
          const submitted = await hasSubmittedExam(session, exam.id, req.user.id);
          if (submitted) {
            return { ...exam, status: 'submitted', remainingSeconds: 0 };
          }
          const withdrawn = await shouldTreatAsWithdrawn(exam.id, req.user.id);
          if (withdrawn) {
            return { ...exam, status: 'withdrawn', remainingSeconds: 0 };
          }
        }
        return { ...exam, ...state };
      })
    );

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

export const saveSubmission = async (req: any, res: Response) => {
  const { examId } = req.params;
  const { taskId, sourceCode, output } = req.body;
  const studentId = req.user?.id;

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

  if (req.user?.role !== 'PROFESSOR') {
    return res.status(403).json({ error: 'Only professors can view student submissions' });
  }

  const session = neo4jDriver.session();
  try {
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

    await session.run(
      `
      MATCH (u:User {id: $studentId}), (e:Exam {id: $examId})
      MERGE (u)-[r:SUBMITTED_EXAM]->(e)
      SET r.submittedAt = datetime()
      `,
      { studentId, examId }
    );

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

  try {
    const sessionId = await redisClient.get(getSessionKey(examId));
    await redisClient.set(getWithdrawnKey(examId, studentId), sessionId || 'true', { EX: STATE_TTL_SECONDS });
    await logUserActivity(studentId, 'EXAM_WITHDRAW', {
      examId
    });
    res.json({ message: 'Withdrawn' });
  } catch (error) {
    res.status(500).json({ error: 'Error while withdrawing from exam' });
  }
};
