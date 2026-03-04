import { QuestionBankItem, type QuestionDifficulty } from '../models/QuestionBankItem.js';

export type QuestionBankSnapshot = {
  subjectId: string;
  createdByProfessorId: string;
  sourceExamId?: string | null;
  sourceTaskId?: string | null;
  title: string;
  maxPoints?: number | null;
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

export const normalizeQuestionMaxPoints = (value: unknown, fallback = 10): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.round(numeric * 100) / 100;
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
  const hasDifficulty = snapshot.difficulty !== undefined && snapshot.difficulty !== null;
  const hasTags = snapshot.tags !== undefined && snapshot.tags !== null;
  const normalizedDifficulty = hasDifficulty ? normalizeQuestionDifficulty(snapshot.difficulty) : undefined;
  const normalizedTags = hasTags ? parseQuestionTags(snapshot.tags) : undefined;

  const payload = {
    subjectId: snapshot.subjectId,
    createdByProfessorId: snapshot.createdByProfessorId,
    sourceExamId: snapshot.sourceExamId || null,
    sourceTaskId: snapshot.sourceTaskId || null,
    title: snapshot.title,
    maxPoints: normalizeQuestionMaxPoints(snapshot.maxPoints, 10),
    description: snapshot.description || null,
    starterCode: snapshot.starterCode || null,
    testCases: snapshot.testCases || '[]',
    pdfPath: snapshot.pdfPath || null,
    exampleInput: snapshot.exampleInput || null,
    exampleOutput: snapshot.exampleOutput || null,
    notes: snapshot.notes || null
  };

  if (payload.sourceTaskId) {
    const updatePayload: Record<string, unknown> = { ...payload };
    if (normalizedDifficulty) {
      updatePayload.difficulty = normalizedDifficulty;
    }
    if (normalizedTags) {
      updatePayload.tags = normalizedTags;
    }

    await QuestionBankItem.findOneAndUpdate(
      { subjectId: payload.subjectId, sourceTaskId: payload.sourceTaskId },
      {
        $set: updatePayload,
        $setOnInsert: {
          useCount: 0,
          archived: false,
          difficulty: normalizedDifficulty || 'MEDIUM',
          tags: normalizedTags || []
        }
      },
      { upsert: true, new: true }
    );
    return;
  }

  await QuestionBankItem.create({
    ...payload,
    difficulty: normalizedDifficulty || 'MEDIUM',
    tags: normalizedTags || []
  });
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
