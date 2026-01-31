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
  sourceCode: string,
  output: string,
  status: ExecutionStatus
): Promise<void> {
  const query = `
    INSERT INTO execution_logs (exam_id, student_id, timestamp, source_code, output, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
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
    SELECT exam_id, student_id, timestamp, source_code, output, status
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

/**
 * Log an admin action into user_activity using a deterministic UUID
 * (the admin has a non-UUID id so we use a fixed UUID for partitioning).
 */
const ADMIN_ACTIVITY_UUID = '00000000-0000-0000-0000-000000000000';

export async function logAdminActivity(
  eventType: UserActivityEventType,
  details: Record<string, unknown> = {}
): Promise<void> {
  const query = `
    INSERT INTO user_activity (user_id, event_type, timestamp, details)
    VALUES (?, ?, ?, ?)
  `;

  try {
    await cassandraClient.execute(
      query,
      [
        types.Uuid.fromString(ADMIN_ACTIVITY_UUID),
        eventType,
        new Date(),
        JSON.stringify(details)
      ],
      { prepare: true }
    );
  } catch (err) {
    console.warn('Failed to log admin activity:', err);
  }
}

// Exam Comments
export interface ExamComment {
  examId: string;
  studentId: string;
  commentId: string;
  line: number | null;
  message: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export async function addExamComment(
  examId: string,
  studentId: string,
  line: number | null,
  message: string,
  authorId: string,
  authorName: string
): Promise<string> {
  const query = `
    INSERT INTO exam_comments (exam_id, student_id, comment_id, line, message, author_id, author_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const commentId = types.TimeUuid.now();
    await cassandraClient.execute(
      query,
      [
        types.Uuid.fromString(examId),
        types.Uuid.fromString(studentId),
        commentId,
        line,
        message,
        types.Uuid.fromString(authorId),
        authorName,
        new Date()
      ],
      { prepare: true }
    );
    return commentId.toString();
  } catch (error: any) {
    console.error('Cassandra addExamComment error:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

export async function getExamComments(
  examId: string,
  studentId: string
): Promise<ExamComment[]> {
  const query = `
    SELECT exam_id, student_id, comment_id, line, message, author_id, author_name, created_at
    FROM exam_comments
    WHERE exam_id = ? AND student_id = ?
  `;

  const result = await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId)
    ],
    { prepare: true }
  );

  return result.rows.map(row => ({
    examId: row.exam_id.toString(),
    studentId: row.student_id.toString(),
    commentId: row.comment_id.toString(),
    line: row.line,
    message: row.message,
    authorId: row.author_id.toString(),
    authorName: row.author_name,
    createdAt: row.created_at.toISOString()
  }));
}

export async function deleteExamComment(
  examId: string,
  studentId: string,
  commentId: string
): Promise<void> {
  const query = `
    DELETE FROM exam_comments
    WHERE exam_id = ? AND student_id = ? AND comment_id = ?
  `;

  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
      types.TimeUuid.fromString(commentId.trim())
    ],
    { prepare: true }
  );
}

export async function updateExamComment(
  examId: string,
  studentId: string,
  commentId: string,
  line: number | null,
  message: string,
  authorId: string,
  authorName: string
): Promise<void> {
  const query = `
    UPDATE exam_comments
    SET line = ?, message = ?, author_id = ?, author_name = ?, created_at = ?
    WHERE exam_id = ? AND student_id = ? AND comment_id = ?
  `;

  await cassandraClient.execute(
    query,
    [
      line,
      message,
      types.Uuid.fromString(authorId),
      authorName,
      new Date(),
      types.Uuid.fromString(examId),
      types.Uuid.fromString(studentId),
      types.TimeUuid.fromString(commentId.trim())
    ],
    { prepare: true }
  );
}

// ========== EXAM CHAT MESSAGES ==========

export interface ChatMessage {
  examId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  message: string;
  status: 'pending' | 'approved';
  replyTo: string | null;
  replyMessage: string | null;
  replyAuthorId: string | null;
  replyAuthorName: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export async function addChatMessage(
  examId: string,
  senderId: string,
  senderName: string,
  message: string
): Promise<string> {
  const query = `
    INSERT INTO exam_chat_messages (exam_id, message_id, sender_id, sender_name, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const messageId = types.TimeUuid.now();
  await cassandraClient.execute(
    query,
    [
      types.Uuid.fromString(examId),
      messageId,
      types.Uuid.fromString(senderId),
      senderName,
      message,
      'pending',
      new Date()
    ],
    { prepare: true }
  );
  return messageId.toString();
}

export async function replyChatMessage(
  examId: string,
  messageId: string,
  replyMessage: string,
  replyAuthorId: string,
  replyAuthorName: string
): Promise<void> {
  const query = `
    UPDATE exam_chat_messages
    SET status = ?, reply_to = ?, reply_message = ?, reply_author_id = ?, reply_author_name = ?, approved_at = ?
    WHERE exam_id = ? AND message_id = ?
  `;

  await cassandraClient.execute(
    query,
    [
      'approved',
      types.TimeUuid.fromString(messageId),
      replyMessage,
      types.Uuid.fromString(replyAuthorId),
      replyAuthorName,
      new Date(),
      types.Uuid.fromString(examId),
      types.TimeUuid.fromString(messageId)
    ],
    { prepare: true }
  );
}

export async function getChatMessages(examId: string): Promise<ChatMessage[]> {
  const query = `
    SELECT exam_id, message_id, sender_id, sender_name, message, status,
           reply_to, reply_message, reply_author_id, reply_author_name, created_at, approved_at
    FROM exam_chat_messages
    WHERE exam_id = ?
  `;

  const result = await cassandraClient.execute(
    query,
    [types.Uuid.fromString(examId)],
    { prepare: true }
  );

  return result.rows.map(row => ({
    examId: row.exam_id.toString(),
    messageId: row.message_id.toString(),
    senderId: row.sender_id.toString(),
    senderName: row.sender_name,
    message: row.message,
    status: row.status as 'pending' | 'approved',
    replyTo: row.reply_to ? row.reply_to.toString() : null,
    replyMessage: row.reply_message || null,
    replyAuthorId: row.reply_author_id ? row.reply_author_id.toString() : null,
    replyAuthorName: row.reply_author_name || null,
    createdAt: row.created_at.toISOString(),
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null
  }));
}
