import { neo4jDriver } from '../driver.js';
import { redisClient } from '../../redis/client.js';

const SESSION_KEY = (examId: string) => `exam:${examId}:session_id`;
const STARTED_KEY = (examId: string, studentId: string) => `exam:${examId}:started:${studentId}`;
const STARTED_SET_KEY = (examId: string) => `exam:${examId}:started_students`;
const WITHDRAWN_KEY = (examId: string, studentId: string) => `exam:${examId}:withdrawn:${studentId}`;
const AUTOSUBMIT_KEY = (examId: string, sessionId: string) => `exam:${examId}:autosubmit:${sessionId}`;

export const autoSubmitExam = async (examId: string) => {
  const sessionId = await redisClient.get(SESSION_KEY(examId));
  if (!sessionId) return;

  const lockKey = AUTOSUBMIT_KEY(examId, sessionId);
  const acquired = await redisClient.set(lockKey, '1', { NX: true, EX: 60 * 60 * 24 });
  if (!acquired) return;

  const studentIds = await redisClient.sMembers(STARTED_SET_KEY(examId));
  if (studentIds.length === 0) return;

  const session = neo4jDriver.session();
  try {
    for (const studentId of studentIds) {
      const startedSession = await redisClient.get(STARTED_KEY(examId, studentId));
      if (!startedSession || startedSession !== sessionId) continue;
      const withdrawn = await redisClient.get(WITHDRAWN_KEY(examId, studentId));
      if (withdrawn && withdrawn === sessionId) continue;

      await session.run(
        `
        MATCH (u:User {id: $studentId})-[:ENROLLED_IN]->(:Subject)-[:SADRZI]->(e:Exam {id: $examId})
        MERGE (u)-[se:SUBMITTED_EXAM]->(e)
        SET se.submittedAt = coalesce(se.submittedAt, datetime())
        WITH u, e
        MATCH (e)-[:IMA_ZADATAK]->(t:Task)
        MERGE (u)-[r:SUBMITTED]->(t)
        SET r.sourceCode = coalesce(r.sourceCode, ''),
            r.output = coalesce(r.output, ''),
            r.updatedAt = coalesce(r.updatedAt, datetime())
        RETURN count(t) AS taskCount
        `,
        { studentId, examId }
      );
    }
  } finally {
    await session.close();
  }
};
