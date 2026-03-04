import { ExamParticipation } from '../models/ExamParticipation.js';
import { TaskRunEvent, type TaskRunStatus } from '../models/TaskRunEvent.js';

type ParticipationContext = {
  examId: string;
  subjectId: string;
  studentId: string;
};

export const markExamWorked = async ({ examId, subjectId, studentId }: ParticipationContext) => {
  const now = new Date();
  await ExamParticipation.updateOne(
    { examId, studentId },
    {
      $setOnInsert: { examId, subjectId, studentId, firstWorkedAt: now },
      $set: { subjectId, hasWorked: true, lastWorkedAt: now },
      $min: { firstWorkedAt: now }
    },
    { upsert: true }
  );
};

export const markExamSubmitted = async ({ examId, subjectId, studentId }: ParticipationContext) => {
  const now = new Date();
  await ExamParticipation.updateOne(
    { examId, studentId },
    {
      $setOnInsert: { examId, subjectId, studentId },
      $set: { subjectId, hasSubmitted: true, submittedAt: now }
    },
    { upsert: true }
  );
};

export const markExamWithdrawn = async ({ examId, subjectId, studentId }: ParticipationContext) => {
  const now = new Date();
  await ExamParticipation.updateOne(
    { examId, studentId },
    {
      $setOnInsert: { examId, subjectId, studentId },
      $set: { subjectId, hasWithdrawn: true, withdrawnAt: now }
    },
    { upsert: true }
  );
};

export const logTaskRunEvent = async (params: ParticipationContext & { taskId: string; status: TaskRunStatus }) => {
  const { examId, subjectId, studentId, taskId, status } = params;
  await TaskRunEvent.create({ examId, subjectId, studentId, taskId, status });
};
