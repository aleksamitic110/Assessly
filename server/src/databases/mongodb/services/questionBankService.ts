import { QuestionBankItem, type QuestionDifficulty } from '../models/QuestionBankItem.js';

export type QuestionBankSnapshot = {
  subjectId: string;
  createdByProfessorId: string;
  sourceExamId?: string | null;
  sourceTaskId?: string | null;
  title: string;
  description?: string | null;
  starterCode?: string | null;
  testCases?: string | null;
  pdfPath?: string | null;
  exampleInput?: string | null;
  exampleOutput?: string | null;
  notes?: string | null;
  difficulty?: QuestionDifficulty | null;
  tags?: string[] | null;
};

export const normalizeQuestionDifficulty = (value: unknown): QuestionDifficulty => {
  const raw = String(value || 'MEDIUM').toUpperCase();
  if (raw === 'EASY' || raw === 'HARD' || raw === 'MEDIUM') {
    return raw;
  }
  return 'MEDIUM';
};

export const parseQuestionTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  }

  return [];
};

export const shouldSaveToQuestionBank = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
};

export const upsertQuestionBankItemFromTask = async (snapshot: QuestionBankSnapshot) => {
  const payload = {
    subjectId: snapshot.subjectId,
    createdByProfessorId: snapshot.createdByProfessorId,
    sourceExamId: snapshot.sourceExamId || null,
    sourceTaskId: snapshot.sourceTaskId || null,
    title: snapshot.title,
    description: snapshot.description || null,
    starterCode: snapshot.starterCode || null,
    testCases: snapshot.testCases || '[]',
    pdfPath: snapshot.pdfPath || null,
    exampleInput: snapshot.exampleInput || null,
    exampleOutput: snapshot.exampleOutput || null,
    notes: snapshot.notes || null,
    difficulty: normalizeQuestionDifficulty(snapshot.difficulty),
    tags: parseQuestionTags(snapshot.tags)
  };

  if (payload.sourceTaskId) {
    await QuestionBankItem.findOneAndUpdate(
      { subjectId: payload.subjectId, sourceTaskId: payload.sourceTaskId },
      { $set: payload, $setOnInsert: { useCount: 0, archived: false } },
      { upsert: true, new: true }
    );
    return;
  }

  await QuestionBankItem.create(payload);
};

export const bumpQuestionBankUsage = async (itemIds: string[]) => {
  if (!itemIds.length) {
    return;
  }
  await QuestionBankItem.updateMany(
    { _id: { $in: itemIds } },
    {
      $inc: { useCount: 1 },
      $set: { lastUsedAt: new Date() }
    }
  );
};
