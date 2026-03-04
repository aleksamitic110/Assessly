import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { neo4jDriver } from '../../neo4j/driver.js';
import { QuestionBankItem } from '../models/QuestionBankItem.js';
import {
  bumpQuestionBankUsage,
  normalizeQuestionDifficulty,
  parseQuestionTags
} from '../services/questionBankService.js';

const toNumber = (value: unknown) => {
  if (typeof (value as { toNumber?: () => number })?.toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value || 0);
};

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ensureProfessorSubjectAccess = async (professorId: string, subjectId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})
      RETURN count(s) AS subjectCount
      `,
      { professorId, subjectId }
    );
    const count = toNumber(result.records[0]?.get('subjectCount'));
    return count > 0;
  } finally {
    await session.close();
  }
};

const getProfessorExamContext = async (professorId: string, examId: string) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN s.id AS subjectId, s.name AS subjectName, e.name AS examName
      `,
      { professorId, examId }
    );
    if (result.records.length === 0) {
      return null;
    }
    return {
      subjectId: String(result.records[0].get('subjectId')),
      subjectName: String(result.records[0].get('subjectName')),
      examName: String(result.records[0].get('examName'))
    };
  } finally {
    await session.close();
  }
};

type TaskPayload = {
  id: string;
  title: string;
  description: string | null;
  starterCode: string | null;
  testCases: string;
  pdfPath: string | null;
  exampleInput: string | null;
  exampleOutput: string | null;
  notes: string | null;
  questionBankItemId: string;
};

const createTaskInExam = async (
  professorId: string,
  subjectId: string,
  examId: string,
  payload: TaskPayload
) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject {id: $subjectId})-[:SADRZI]->(e:Exam {id: $examId})
      CREATE (t:Task {
        id: $id,
        title: $title,
        description: $description,
        starterCode: $starterCode,
        testCases: $testCases,
        pdfPath: $pdfPath,
        exampleInput: $exampleInput,
        exampleOutput: $exampleOutput,
        notes: $notes,
        questionBankItemId: $questionBankItemId
      })
      CREATE (e)-[:IMA_ZADATAK]->(t)
      RETURN t
      `,
      {
        professorId,
        subjectId,
        examId,
        ...payload
      }
    );

    if (result.records.length === 0) {
      return null;
    }

    return result.records[0].get('t').properties;
  } finally {
    await session.close();
  }
};

export const listQuestionBankItems = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const { subjectId } = req.params;
  const { search, difficulty, tags, includeArchived, limit } = req.query || {};

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const hasAccess = await ensureProfessorSubjectAccess(professorId, subjectId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this subject' });
  }

  const parsedTags = parseQuestionTags(tags);
  const rawLimit = Number(limit);
  const parsedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(300, rawLimit)) : 100;
  const filter: Record<string, unknown> = { subjectId };

  if (!parseBoolean(includeArchived)) {
    filter.archived = false;
  }
  if (difficulty) {
    filter.difficulty = normalizeQuestionDifficulty(difficulty);
  }
  if (parsedTags.length) {
    filter.tags = { $all: parsedTags };
  }
  if (typeof search === 'string' && search.trim()) {
    const safePattern = escapeRegex(search.trim());
    filter.$or = [
      { title: { $regex: safePattern, $options: 'i' } },
      { description: { $regex: safePattern, $options: 'i' } },
      { notes: { $regex: safePattern, $options: 'i' } },
      { tags: { $regex: safePattern, $options: 'i' } }
    ];
  }

  const items = await QuestionBankItem.find(filter)
    .sort({ updatedAt: -1 })
    .limit(parsedLimit)
    .lean();

  return res.json(items.map((item) => ({ ...item, id: String(item._id) })));
};

export const createQuestionBankItem = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const subjectIdFromParams = req.params?.subjectId;
  const {
    subjectId: subjectIdFromBody,
    title,
    description,
    starterCode,
    testCases,
    pdfPath,
    exampleInput,
    exampleOutput,
    notes,
    difficulty,
    tags
  } = req.body;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const subjectId = subjectIdFromParams || subjectIdFromBody;
  if (!subjectId) {
    return res.status(400).json({ error: 'subjectId is required' });
  }

  const hasAccess = await ensureProfessorSubjectAccess(professorId, subjectId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this subject' });
  }

  const item = await QuestionBankItem.create({
    subjectId,
    createdByProfessorId: professorId,
    title,
    description: description || null,
    starterCode: starterCode || null,
    testCases: typeof testCases === 'string' ? testCases : JSON.stringify(testCases || []),
    pdfPath: pdfPath || null,
    exampleInput: exampleInput || null,
    exampleOutput: exampleOutput || null,
    notes: notes || null,
    difficulty: normalizeQuestionDifficulty(difficulty),
    tags: parseQuestionTags(tags)
  });

  return res.status(201).json({ ...item.toObject(), id: String(item._id) });
};

export const updateQuestionBankItem = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const { itemId } = req.params;
  const {
    title,
    description,
    starterCode,
    testCases,
    pdfPath,
    exampleInput,
    exampleOutput,
    notes,
    difficulty,
    tags,
    archived
  } = req.body;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const existing = await QuestionBankItem.findById(itemId);
  if (!existing) {
    return res.status(404).json({ error: 'Question bank item not found' });
  }

  const hasAccess = await ensureProfessorSubjectAccess(professorId, existing.subjectId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this item' });
  }

  if (title !== undefined) existing.title = String(title).trim();
  if (description !== undefined) existing.description = description || null;
  if (starterCode !== undefined) existing.starterCode = starterCode || null;
  if (testCases !== undefined) {
    existing.testCases = typeof testCases === 'string' ? testCases : JSON.stringify(testCases || []);
  }
  if (pdfPath !== undefined) existing.pdfPath = pdfPath || null;
  if (exampleInput !== undefined) existing.exampleInput = exampleInput || null;
  if (exampleOutput !== undefined) existing.exampleOutput = exampleOutput || null;
  if (notes !== undefined) existing.notes = notes || null;
  if (difficulty !== undefined) existing.difficulty = normalizeQuestionDifficulty(difficulty);
  if (tags !== undefined) existing.tags = parseQuestionTags(tags);
  if (archived !== undefined) existing.archived = parseBoolean(archived);

  await existing.save();
  return res.json({ ...existing.toObject(), id: String(existing._id) });
};

export const deleteQuestionBankItem = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const { itemId } = req.params;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const existing = await QuestionBankItem.findById(itemId);
  if (!existing) {
    return res.status(404).json({ error: 'Question bank item not found' });
  }

  const hasAccess = await ensureProfessorSubjectAccess(professorId, existing.subjectId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this item' });
  }

  await QuestionBankItem.deleteOne({ _id: existing._id });
  return res.json({ message: 'Question bank item deleted' });
};

export const importQuestionBankItemToExam = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const { examId } = req.params;
  const { itemId } = req.body;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const examContext = await getProfessorExamContext(professorId, examId);
  if (!examContext) {
    return res.status(403).json({ error: 'You do not have access to this exam' });
  }

  const item = await QuestionBankItem.findOne({
    _id: itemId,
    subjectId: examContext.subjectId,
    archived: false
  });
  if (!item) {
    return res.status(404).json({ error: 'Question bank item not found for this subject' });
  }

  const newTaskId = uuidv4();
  const createdTask = await createTaskInExam(
    professorId,
    examContext.subjectId,
    examId,
    {
      id: newTaskId,
      title: item.title,
      description: item.description || null,
      starterCode: item.starterCode || null,
      testCases: item.testCases || '[]',
      pdfPath: item.pdfPath || null,
      exampleInput: item.exampleInput || null,
      exampleOutput: item.exampleOutput || null,
      notes: item.notes || null,
      questionBankItemId: String(item._id)
    }
  );

  if (!createdTask) {
    return res.status(404).json({ error: 'Exam not found' });
  }

  await bumpQuestionBankUsage([String(item._id)]);
  const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
  return res.status(201).json({
    ...createdTask,
    pdfUrl: createdTask.pdfPath ? `${serverBaseUrl}${createdTask.pdfPath}` : null
  });
};

export const autoGenerateTasksFromQuestionBank = async (req: any, res: Response) => {
  const professorId = req.user?.id;
  const { examId } = req.params;
  const { count, difficulty, tags } = req.body;

  if (!professorId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const requestedCount = Number(count);
  if (!Number.isFinite(requestedCount) || requestedCount < 1 || requestedCount > 30) {
    return res.status(400).json({ error: 'Count must be between 1 and 30' });
  }

  const examContext = await getProfessorExamContext(professorId, examId);
  if (!examContext) {
    return res.status(403).json({ error: 'You do not have access to this exam' });
  }

  const parsedTags = parseQuestionTags(tags);
  const filter: Record<string, unknown> = {
    subjectId: examContext.subjectId,
    archived: false
  };
  if (difficulty) {
    filter.difficulty = normalizeQuestionDifficulty(difficulty);
  }
  if (parsedTags.length) {
    filter.tags = { $all: parsedTags };
  }

  const sampledItems = await QuestionBankItem.aggregate([
    { $match: filter },
    { $sample: { size: requestedCount } }
  ]);

  if (sampledItems.length < requestedCount) {
    return res.status(400).json({
      error: `Not enough matching tasks in question bank. Requested ${requestedCount}, available ${sampledItems.length}.`
    });
  }

  const createdTasks: Array<Record<string, unknown>> = [];
  for (const item of sampledItems) {
    const createdTask = await createTaskInExam(
      professorId,
      examContext.subjectId,
      examId,
      {
        id: uuidv4(),
        title: item.title,
        description: item.description || null,
        starterCode: item.starterCode || null,
        testCases: item.testCases || '[]',
        pdfPath: item.pdfPath || null,
        exampleInput: item.exampleInput || null,
        exampleOutput: item.exampleOutput || null,
        notes: item.notes || null,
        questionBankItemId: String(item._id)
      }
    );

    if (createdTask) {
      createdTasks.push(createdTask);
    }
  }

  await bumpQuestionBankUsage(sampledItems.map((item) => String(item._id)));

  const serverBaseUrl = process.env.SERVER_BASE_URL || 'http://localhost:3000';
  return res.status(201).json({
    createdCount: createdTasks.length,
    tasks: createdTasks.map((task) => ({
      ...task,
      pdfUrl: task.pdfPath ? `${serverBaseUrl}${task.pdfPath}` : null
    }))
  });
};
