import mongoose, { Schema, Document } from 'mongoose';

export interface IGradeStat extends Document {
  examId: string;
  studentId: string;
  professorId: string;
  gradeValue: number;
  passed: boolean;
  gradedAt: Date;
}

const GradeStatSchema: Schema = new Schema({
  examId: { type: String, required: true, index: true }, // Indexirano za bržu pretragu statistike
  studentId: { type: String, required: true },
  professorId: { type: String, required: true },
  gradeValue: { type: Number, required: true, min: 5, max: 10 },
  passed: { type: Boolean, required: true },
  gradedAt: { type: Date, default: Date.now }
});

// Sprečavamo da isti profesor upiše više statistika za istog studenta na istom ispitu.
// Ako se ocena menja, prepisaćemo je.
GradeStatSchema.index({ examId: 1, studentId: 1 }, { unique: true });

export const GradeStat = mongoose.model<IGradeStat>('GradeStat', GradeStatSchema);