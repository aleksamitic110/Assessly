import mongoose, { Document, Schema } from 'mongoose';

export interface IGradeStat extends Document {
  subjectId?: string;
  examId: string;
  studentId: string;
  professorId: string;
  gradeValue: number;
  passed: boolean;
  gradedAt: Date;
}

const GradeStatSchema: Schema = new Schema({
  subjectId: { type: String, required: false, index: true },
  examId: { type: String, required: true, index: true },
  studentId: { type: String, required: true },
  professorId: { type: String, required: true },
  gradeValue: { type: Number, required: true, min: 5, max: 10 },
  passed: { type: Boolean, required: true },
  gradedAt: { type: Date, default: Date.now }
});

GradeStatSchema.index({ examId: 1, studentId: 1 }, { unique: true });
GradeStatSchema.index({ subjectId: 1, examId: 1 });

export const GradeStat = mongoose.model<IGradeStat>('GradeStat', GradeStatSchema);
