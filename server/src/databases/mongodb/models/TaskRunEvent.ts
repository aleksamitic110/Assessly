import mongoose, { Document, Schema } from 'mongoose';

export type TaskRunStatus = 'SUCCESS' | 'ERROR';

export interface ITaskRunEvent extends Document {
  examId: string;
  subjectId: string;
  taskId: string;
  studentId: string;
  status: TaskRunStatus;
  createdAt: Date;
}

const TaskRunEventSchema = new Schema<ITaskRunEvent>(
  {
    examId: { type: String, required: true, index: true },
    subjectId: { type: String, required: true, index: true },
    taskId: { type: String, required: true, index: true },
    studentId: { type: String, required: true, index: true },
    status: { type: String, enum: ['SUCCESS', 'ERROR'], required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TaskRunEventSchema.index({ examId: 1, taskId: 1, createdAt: -1 });
TaskRunEventSchema.index({ subjectId: 1, taskId: 1, createdAt: -1 });
TaskRunEventSchema.index({ examId: 1, studentId: 1 });

export const TaskRunEvent = mongoose.model<ITaskRunEvent>('TaskRunEvent', TaskRunEventSchema);
