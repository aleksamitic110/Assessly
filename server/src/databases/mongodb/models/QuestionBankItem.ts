import mongoose, { Document, Schema } from 'mongoose';

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface IQuestionBankItem extends Document {
  subjectId: string;
  createdByProfessorId: string;
  sourceExamId?: string | null;
  sourceTaskId?: string | null;
  title: string;
  description?: string | null;
  starterCode?: string | null;
  testCases: string;
  pdfPath?: string | null;
  exampleInput?: string | null;
  exampleOutput?: string | null;
  notes?: string | null;
  tags: string[];
  difficulty: QuestionDifficulty;
  useCount: number;
  archived: boolean;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionBankItemSchema = new Schema<IQuestionBankItem>(
  {
    subjectId: { type: String, required: true, index: true },
    createdByProfessorId: { type: String, required: true },
    sourceExamId: { type: String, default: null },
    sourceTaskId: { type: String, default: null },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 2000 },
    starterCode: { type: String, default: null, maxlength: 20000 },
    testCases: { type: String, required: true, default: '[]' },
    pdfPath: { type: String, default: null },
    exampleInput: { type: String, default: null, maxlength: 2000 },
    exampleOutput: { type: String, default: null, maxlength: 2000 },
    notes: { type: String, default: null, maxlength: 2000 },
    tags: { type: [String], default: [] },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM' },
    useCount: { type: Number, default: 0, min: 0 },
    archived: { type: Boolean, default: false, index: true },
    lastUsedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

QuestionBankItemSchema.index({ subjectId: 1, archived: 1, updatedAt: -1 });
QuestionBankItemSchema.index({ subjectId: 1, difficulty: 1 });
QuestionBankItemSchema.index({ subjectId: 1, tags: 1 });
QuestionBankItemSchema.index({ subjectId: 1, sourceTaskId: 1 }, { sparse: true });

export const QuestionBankItem = mongoose.model<IQuestionBankItem>('QuestionBankItem', QuestionBankItemSchema);
