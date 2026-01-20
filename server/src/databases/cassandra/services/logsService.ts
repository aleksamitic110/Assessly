import { cassandraClient } from '../client.js';
import { types } from 'cassandra-driver';
import type {
  ExecutionLogResponse,
  ExecutionStatus,
  SecurityEventResponse,
  SecurityEventType,
  UserActivityEventType
} from '../types.js';

export async function logExecution(
  examId: string,
  studentId: string,
  taskId: string,
  sourceCode: string,
  output: string,
  status: ExecutionStatus
): Promise<void> {
  const query = `
    INSERT INTO execution_logs (exam_id, student_id, task_id, timestamp, source_code, output, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
      types.Uuid.fromString(taskId),
      new Date(),
      sourceCode,
      output,
      status
    ],
    { prepare: true }
  );
}

export async function getExecutionLogs(
  examId: string,
  studentId: string,
  limit: number = 50
): Promise<ExecutionLogResponse[]> {
  const query = `
    SELECT exam_id, student_id, task_id, timestamp, source_code, output, status
    FROM execution_logs
    WHERE exam_id = ? AND student_id = ?
    LIMIT ?
  `;

  const result = await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
      limit
    ],
    { prepare: true }
  );

  return result.rows.map(row => ({
    examId: row.exam_id.toString(),
    studentId: row.student_id.toString(),
    taskId: row.task_id.toString(),
    timestamp: row.timestamp.toISOString(),
    sourceCode: row.source_code,
    output: row.output,
    status: row.status as ExecutionStatus
  }));
}

export async function getExecutionLogsForTask(
  examId: string,
  studentId: string,
  taskId: string
): Promise<ExecutionLogResponse[]> {
  const query = `
    SELECT exam_id, student_id, task_id, timestamp, source_code, output, status
    FROM execution_logs
    WHERE exam_id = ? AND student_id = ?
    ALLOW FILTERING
  `;

  const result = await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId)
    ],
    { prepare: true }
  );

  return result.rows
    .filter(row => row.task_id.toString() === taskId)
    .map(row => ({
      examId: row.exam_id.toString(),
      studentId: row.student_id.toString(),
      taskId: row.task_id.toString(),
      timestamp: row.timestamp.toISOString(),
      sourceCode: row.source_code,
      output: row.output,
      status: row.status as ExecutionStatus
    }));
}

export async function logSecurityEvent(
  examId: string,
  studentId: string,
  eventType: SecurityEventType,
  details: Record<string, unknown> = {}
): Promise<void> {
  const query = `
    INSERT INTO security_events (exam_id, student_id, event_type, timestamp, details)
    VALUES (?, ?, ?, ?, ?)
  `;

  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
      eventType,
      new Date(),
      JSON.stringify(details)
    ],
    { prepare: true }
  );
}

export async function getSecurityEvents(
  examId: string,
  limit: number = 100
): Promise<SecurityEventResponse[]> {
  const query = `
    SELECT exam_id, student_id, event_type, timestamp, details
    FROM security_events
    WHERE exam_id = ?
    LIMIT ?
  `;

  const result = await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      limit
    ],
    { prepare: true }
  );

  return result.rows.map(row => ({
    examId: row.exam_id.toString(),
    studentId: row.student_id.toString(),
    eventType: row.event_type as SecurityEventType,
    timestamp: row.timestamp.toISOString(),
    details: JSON.parse(row.details || '{}')
  }));
}

export async function getSecurityEventsForStudent(
  examId: string,
  studentId: string
): Promise<SecurityEventResponse[]> {
  const query = `
    SELECT exam_id, student_id, event_type, timestamp, details
    FROM security_events
    WHERE exam_id = ?
  `;

  const result = await cassandraClient.execute(
    query,
    [types.Uuid.fromString(examId)],
    { prepare: true }
  );

  return result.rows
    .filter(row => row.student_id.toString() === studentId)
    .map(row => ({
      examId: row.exam_id.toString(),
      studentId: row.student_id.toString(),
      eventType: row.event_type as SecurityEventType,
      timestamp: row.timestamp.toISOString(),
      details: JSON.parse(row.details || '{}')
    }));
}

export async function countSecurityEvents(
  examId: string,
  studentId: string
): Promise<number> {
  const events = await getSecurityEventsForStudent(examId, studentId);
  return events.length;
}

export async function logUserActivity(
  userId: string,
  eventType: UserActivityEventType,
  details: Record<string, unknown> = {}
): Promise<void> {
  const query = `
    INSERT INTO user_activity (user_id, event_type, timestamp, details)
    VALUES (?, ?, ?, ?)
  `;

  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(userId),
      eventType,
      new Date(),
      JSON.stringify(details)
    ],
    { prepare: true }
  );
}
