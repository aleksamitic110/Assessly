import mongoose, { Document, Schema } from 'mongoose';

export interface IExamParticipation extends Document {
  examId: string;
  subjectId: string;
  studentId: string;
  hasWorked: boolean;
  hasSubmitted: boolean;
  hasWithdrawn: boolean;
  firstWorkedAt?: Date | null;
  lastWorkedAt?: Date | null;
  submittedAt?: Date | null;
  withdrawnAt?: Date | null;
  updatedAt: Date;
}

const ExamParticipationSchema = new Schema<IExamParticipation>(
  {
    examId: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    hasWorked: { type: Boolean, default: false },
    hasSubmitted: { type: Boolean, default: false },
    hasWithdrawn: { type: Boolean, default: false },
    firstWorkedAt: { type: Date, default: null },
    lastWorkedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

ExamParticipationSchema.index({ examId: 1, studentId: 1 }, { unique: true });
ExamParticipationSchema.index({ subjectId: 1, studentId: 1 });

export const ExamParticipation = mongoose.model<IExamParticipation>('ExamParticipation', ExamParticipationSchema);
