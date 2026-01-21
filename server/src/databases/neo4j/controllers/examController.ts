import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { neo4jDriver } from '../driver.js';
import { redisClient } from '../../redis/client.js';
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

export const createSubject = async (req: any, res: Response) => {
  const { name, description } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})
      CREATE (s:Subject {id: $id, name: $name, description: $description})
      CREATE (p)-[:PREDAJE]->(s)
      RETURN s
      `,
      { professorId, id, name, description }
    );

    res.status(201).json(result.records[0].get('s').properties);
  } catch (error) {
    res.status(500).json({ error: 'Error while creating subject' });
  } finally {
    await session.close();
  }
};

export const updateSubject = async (req: any, res: Response) => {
  const { subjectId } = req.params;
  const { name, description } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      SET s.name = COALESCE($name, s.name),
          s.description = COALESCE($description, s.description)
      RETURN s
      `,
      { professorId, subjectId, name, description }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    res.json(result.records[0].get('s').properties);
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
    const result = await session.run(
      `
      MATCH (s:Subject)-[]->(e:Exam)
      RETURN e, s
      ORDER BY e.startTime
      `
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
      exams.map(async (exam) => ({
        ...exam,
        ...(await resolveExamState(exam.id, exam.startTime))
      }))
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
      RETURN s, collect(e) AS exams
      ORDER BY s.name
      `,
      { professorId }
    );

    const subjects = await Promise.all(result.records.map(async record => {
      const subject = record.get('s').properties;
      const exams = record.get('exams')
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
        exams.map(async (exam) => ({
          ...exam,
          ...(await resolveExamState(exam.id, exam.startTime))
        }))
      );

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

export const getExamTasks = async (req: any, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
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
