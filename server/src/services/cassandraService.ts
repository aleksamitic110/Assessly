import { cassandraClient } from '../cassandra.js';
import { types } from 'cassandra-driver';
import type {
  ExecutionLog,
  SecurityEvent,
  ExecutionStatus,
  SecurityEventType,
  UserActivityEventType,
  ExecutionLogResponse,
  SecurityEventResponse
} from '../types/cassandra.js';

// ============================================
// EXECUTION LOGS - Logovanje izvršavanja koda
// ============================================

/**
 * Sačuvaj log izvršavanja koda studenta
 * Koristi se kada student pokrene kod na ispitu
 */
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

  await cassandraClient.execute(query, [
    types.Uuid.fromString(examId),
    types.Uuid.fromString(studentId),
    types.Uuid.fromString(taskId),
    new Date(),
    sourceCode,
    output,
    status
  ], { prepare: true });
}

/**
 * Dohvati sve logove izvršavanja za studenta na ispitu
 * Sortirano od najnovijeg ka najstarijem (DESC)
 */
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

  const result = await cassandraClient.execute(query, [
    types.Uuid.fromString(examId),
    types.Uuid.fromString(studentId),
    limit
  ], { prepare: true });

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

/**
 * Dohvati logove za specifičan task
 */
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

  const result = await cassandraClient.execute(query, [
    types.Uuid.fromString(examId),
    types.Uuid.fromString(studentId)
  ], { prepare: true });

  // Filter by taskId in application layer (Cassandra doesn't support filtering on non-primary key efficiently)
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

// ============================================
// SECURITY EVENTS - Anti-cheat logovi
// ============================================

/**
 * Sačuvaj bezbednosni događaj (sumnjiva aktivnost)
 * Koristi se kada detektujemo TAB_SWITCH, COPY_PASTE, itd.
 */
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

  await cassandraClient.execute(query, [
    types.Uuid.fromString(examId),
    types.Uuid.fromString(studentId),
    eventType,
    new Date(),
    JSON.stringify(details)
  ], { prepare: true });
}

/**
 * Dohvati sve bezbednosne događaje za ispit
 * Profesor može da vidi sve sumnjive aktivnosti
 */
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

  const result = await cassandraClient.execute(query, [
    types.Uuid.fromString(examId),
    limit
  ], { prepare: true });

  return result.rows.map(row => ({
    examId: row.exam_id.toString(),
    studentId: row.student_id.toString(),
    eventType: row.event_type as SecurityEventType,
    timestamp: row.timestamp.toISOString(),
    details: JSON.parse(row.details || '{}')
  }));
}

/**
 * Dohvati bezbednosne događaje za specifičnog studenta na ispitu
 */
export async function getSecurityEventsForStudent(
  examId: string,
  studentId: string
): Promise<SecurityEventResponse[]> {
  const query = `
    SELECT exam_id, student_id, event_type, timestamp, details
    FROM security_events
    WHERE exam_id = ?
  `;

  const result = await cassandraClient.execute(query, [
    types.Uuid.fromString(examId)
  ], { prepare: true });

  // Filter by studentId in application layer
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

/**
 * Prebroj koliko sumnjiivih događaja ima student na ispitu
 * Koristi se za anti-cheat threshold
 */
export async function countSecurityEvents(
  examId: string,
  studentId: string
): Promise<number> {
  const events = await getSecurityEventsForStudent(examId, studentId);
  return events.length;
}

// ============================================
// USER ACTIVITY - Login/Register audit log
// ============================================

/**
 * SaŽ›uvaj aktivnost korisnika (login/registracija)
 */
export async function logUserActivity(
  userId: string,
  eventType: UserActivityEventType,
  details: Record<string, unknown> = {}
): Promise<void> {
  const query = `
    INSERT INTO user_activity (user_id, event_type, timestamp, details)
    VALUES (?, ?, ?, ?)
  `;

  await cassandraClient.execute(query, [
    types.Uuid.fromString(userId),
    eventType,
    new Date(),
    JSON.stringify(details)
  ], { prepare: true });
}
