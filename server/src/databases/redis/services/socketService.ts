import dotenv from 'dotenv';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../client.js';
import { neo4jDriver } from '../../neo4j/driver.js';
import { autoSubmitExam } from '../../neo4j/services/autoSubmitService.js';
import { addChatMessage, replyChatMessage, getChatMessages } from '../../cassandra/services/logsService.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

interface UserPayload {
  id: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

declare module 'socket.io' {
  interface Socket {
    user?: UserPayload;
  }
}

let ioRef: Server | null = null;
const LAST_CHANGE_KEY = 'exams:last_change';

export const emitExamChanged = async (examId: string, status: string) => {
  const timestamp = Date.now();
  try {
    await redisClient.set(LAST_CHANGE_KEY, timestamp.toString(), { EX: 60 * 60 * 24 });
  } catch (error) {
    console.error('Failed to store last change:', error);
  }
  if (!ioRef) return;
  ioRef.emit('exam_changed', {
    examId,
    status,
    timestamp
  });
};

export const initSocket = (io: Server) => {
  ioRef = io;
  const STATE_TTL_SECONDS = 60 * 60 * 24;
  const WITHDRAWN_KEY_PREFIX = (examId: string) => `exam:${examId}:withdrawn:`;
  const STARTED_KEY_PREFIX = (examId: string) => `exam:${examId}:started:`;
  const STARTED_SET_KEY = (examId: string) => `exam:${examId}:started_students`;
  const SESSION_KEY = (examId: string) => `exam:${examId}:session_id`;

  const examHasTasks = async (examId: string) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `
        MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
        RETURN count(t) AS taskCount
        `,
        { examId }
      );
      const countRaw = result.records[0]?.get('taskCount');
      const count = typeof countRaw?.toNumber === 'function' ? countRaw.toNumber() : Number(countRaw || 0);
      return count > 0;
    } finally {
      await session.close();
    }
  };

  const clearWithdrawnForExam = async (examId: string) => {
    const pattern = `${WITHDRAWN_KEY_PREFIX(examId)}*`;
    let cursor = 0;
    do {
      const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = Number(result.cursor);
      const keys = result.keys;
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } while (cursor !== 0);
  };

  const clearStartedForExam = async (examId: string) => {
    const pattern = `${STARTED_KEY_PREFIX(examId)}*`;
    let cursor = 0;
    do {
      const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = Number(result.cursor);
      const keys = result.keys;
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } while (cursor !== 0);
    await redisClient.del(STARTED_SET_KEY(examId));
  };

  const markStartedForExam = async (examId: string, sessionId: string) => {
    const studentIds = await redisClient.sMembers(STARTED_SET_KEY(examId));
    if (studentIds.length === 0) return;
    await Promise.all(
      studentIds.map((studentId) =>
        redisClient.set(`${STARTED_KEY_PREFIX(examId)}${studentId}`, sessionId, { EX: STATE_TTL_SECONDS })
      )
    );
  };

  const getExamState = async (examId: string) => {
    const [status, endTimeRaw, startTimeRaw, remainingRaw] = await redisClient.mGet([
      `exam:${examId}:status`,
      `exam:${examId}:end_time`,
      `exam:${examId}:start_time`,
      `exam:${examId}:remaining_ms`
    ]);

    const startTime = startTimeRaw ? parseInt(startTimeRaw, 10) : undefined;
    const endTime = endTimeRaw ? parseInt(endTimeRaw, 10) : undefined;
    const now = Date.now();

    if (status === 'active' && endTime) {
      const remaining = Math.max(0, endTime - now);
      if (remaining === 0) {
        await redisClient.set(`exam:${examId}:status`, 'completed', { EX: STATE_TTL_SECONDS });
        return { examId, status: 'completed', remainingMilliseconds: 0, startTime, endTime };
      }
      return { examId, status: 'active', remainingMilliseconds: remaining, startTime, endTime };
    }

    if (status === 'active') {
      return { examId, status: 'active', remainingMilliseconds: 0, startTime, endTime };
    }

    if (status === 'paused') {
      const remaining = Math.max(0, parseInt(remainingRaw || '0', 10));
      return { examId, status: 'paused', remainingMilliseconds: remaining, startTime };
    }

    if (status === 'completed') {
      return { examId, status: 'completed', remainingMilliseconds: 0, startTime, endTime };
    }

    return { examId, status: 'waiting_start', remainingMilliseconds: 0, startTime };
  };

  const emitExamState = async (examId: string) => {
    const state = await getExamState(examId);
    io.to(examId).emit('exam_state', state);
  };

  const notifyExamChanged = (examId: string, status: string) => {
    void emitExamChanged(examId, status);
  };

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['token'];

    if (!token) return next(new Error('Authentication error: No token provided'));
    if (!JWT_SECRET) return next(new Error('Authentication error: Server misconfigured'));

    try {
      const decoded = jwt.verify(token as string, JWT_SECRET) as UserPayload;
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.user!;
    const role = (user.role || '').toLowerCase();
    console.log(`Connected: ${user.email} (${user.role})`);

    await redisClient.set(`user:status:${user.id}`, 'online', { EX: 60 });

    if (role === 'professor' || role === 'admin') {
      socket.join('professors_room');
    }

    socket.on('join_exam', async (examId: string) => {
      try {
        socket.join(examId);
        console.log(`${user.email} joined ${examId}`);

        const state = await getExamState(examId);
        socket.emit('exam_state', state);
        if (state.status === 'active') {
          socket.emit('timer_sync', { remainingMilliseconds: state.remainingMilliseconds });
        }

        if (role === 'student') {
          const sessionId = await redisClient.get(SESSION_KEY(examId));
          await redisClient.sAdd(STARTED_SET_KEY(examId), user.id);
          if (sessionId) {
            await redisClient.set(`${STARTED_KEY_PREFIX(examId)}${user.id}`, sessionId, { EX: STATE_TTL_SECONDS });
          } else {
            await redisClient.set(`${STARTED_KEY_PREFIX(examId)}${user.id}`, 'pending', { EX: STATE_TTL_SECONDS });
          }
          io.to(examId).emit('student_status_update', {
            studentId: user.id,
            email: user.email,
            status: 'online',
            timestamp: Date.now(),
            examId
          });
        }
      } catch (error) {
        console.error('join_exam failed:', error);
      }
    });

    socket.on('leave_exam', async (examId: string) => {
      try {
        socket.leave(examId);
        if (role === 'student') {
          io.to(examId).emit('student_status_update', {
            studentId: user.id,
            email: user.email,
            status: 'offline',
            timestamp: Date.now(),
            examId
          });
        }
      } catch (error) {
        console.error('leave_exam failed:', error);
      }
    });

    socket.on('violation', async (data: { examId: string; type: string }) => {
      console.log(`Violation: ${user.email} -> ${data.type}`);

      const violationKey = `user:violations:${data.examId}:${user.id}`;
      const count = await redisClient.incr(violationKey);

      io.to(data.examId).emit('violation_alert', {
        studentId: user.id,
        email: user.email,
        type: data.type,
        count,
        timestamp: Date.now(),
        examId: data.examId
      });
    });

    socket.on('start_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId, durationMinutes } = data;
        const hasTasks = await examHasTasks(examId);
        if (!hasTasks) {
          socket.emit('exam_start_error', { examId, reason: 'NO_TASKS' });
          return;
        }
        const startTime = Date.now();
        const endTime = startTime + (durationMinutes * 60 * 1000);
        const sessionId = uuidv4();

        await redisClient.set(`exam:${examId}:status`, 'active', { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:start_time`, startTime.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:end_time`, endTime.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:duration_seconds`, (durationMinutes * 60).toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.del(`exam:${examId}:remaining_ms`);
        await redisClient.set(SESSION_KEY(examId), sessionId, { EX: STATE_TTL_SECONDS });
        await clearWithdrawnForExam(examId);
        await markStartedForExam(examId, sessionId);

        await emitExamState(examId);
        notifyExamChanged(examId, 'active');
      } catch (error) {
        console.error('start_exam failed:', error);
      }
    });

    socket.on('request_changes_snapshot', async () => {
      try {
        const lastChangeRaw = await redisClient.get(LAST_CHANGE_KEY);
        const lastChange = lastChangeRaw ? Number(lastChangeRaw) : null;
        socket.emit('changes_snapshot', { lastChange });
      } catch (error) {
        console.error('Failed to fetch last change:', error);
      }
    });

    socket.on('pause_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId } = data;
        const status = await redisClient.get(`exam:${examId}:status`);
        if (status !== 'active') return;

        const endTimeRaw = await redisClient.get(`exam:${examId}:end_time`);
        const endTime = endTimeRaw ? parseInt(endTimeRaw, 10) : Date.now();
        const remaining = Math.max(0, endTime - Date.now());

        await redisClient.set(`exam:${examId}:status`, 'paused', { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:remaining_ms`, remaining.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.del(`exam:${examId}:end_time`);

        await emitExamState(examId);
        notifyExamChanged(examId, 'paused');
      } catch (error) {
        console.error('pause_exam failed:', error);
      }
    });

    socket.on('resume_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId } = data;
        const status = await redisClient.get(`exam:${examId}:status`);
        if (status !== 'paused') return;

        const remainingRaw = await redisClient.get(`exam:${examId}:remaining_ms`);
        const remaining = Math.max(0, parseInt(remainingRaw || '0', 10));
        const endTime = Date.now() + remaining;

        await redisClient.set(`exam:${examId}:status`, 'active', { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:end_time`, endTime.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.del(`exam:${examId}:remaining_ms`);

        await emitExamState(examId);
        notifyExamChanged(examId, 'active');
      } catch (error) {
        console.error('resume_exam failed:', error);
      }
    });

    socket.on('extend_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId, extraMinutes } = data;
        const extraMs = Math.max(0, Number(extraMinutes)) * 60 * 1000;
        if (!extraMs) return;

        const status = await redisClient.get(`exam:${examId}:status`);
        if (status === 'active') {
          const endTimeRaw = await redisClient.get(`exam:${examId}:end_time`);
          const endTime = endTimeRaw ? parseInt(endTimeRaw, 10) : Date.now();
          const updatedEndTime = endTime + extraMs;
          await redisClient.set(`exam:${examId}:end_time`, updatedEndTime.toString(), { EX: STATE_TTL_SECONDS });
        } else if (status === 'paused') {
          const remainingRaw = await redisClient.get(`exam:${examId}:remaining_ms`);
          const remaining = Math.max(0, parseInt(remainingRaw || '0', 10));
          const updatedRemaining = remaining + extraMs;
          await redisClient.set(`exam:${examId}:remaining_ms`, updatedRemaining.toString(), { EX: STATE_TTL_SECONDS });
        } else {
          return;
        }

        await emitExamState(examId);
        notifyExamChanged(examId, status || 'active');
      } catch (error) {
        console.error('extend_exam failed:', error);
      }
    });

    socket.on('end_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId } = data;

        await redisClient.set(`exam:${examId}:status`, 'completed', { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:end_time`, Date.now().toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.del(`exam:${examId}:remaining_ms`);

        await emitExamState(examId);
        notifyExamChanged(examId, 'completed');
        await autoSubmitExam(examId);
      } catch (error) {
        console.error('end_exam failed:', error);
      }
    });

    socket.on('restart_exam', async (data) => {
      if (role !== 'professor') return;
      try {
        const { examId, durationMinutes } = data;
        const hasTasks = await examHasTasks(examId);
        if (!hasTasks) {
          socket.emit('exam_start_error', { examId, reason: 'NO_TASKS' });
          return;
        }
        const startTime = Date.now();
        const endTime = startTime + (Number(durationMinutes) * 60 * 1000);
        const sessionId = uuidv4();

        await redisClient.set(`exam:${examId}:status`, 'active', { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:start_time`, startTime.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:end_time`, endTime.toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.set(`exam:${examId}:duration_seconds`, (Number(durationMinutes) * 60).toString(), { EX: STATE_TTL_SECONDS });
        await redisClient.del(`exam:${examId}:remaining_ms`);
        await redisClient.set(SESSION_KEY(examId), sessionId, { EX: STATE_TTL_SECONDS });
        await clearWithdrawnForExam(examId);
        await clearStartedForExam(examId);

        await emitExamState(examId);
        notifyExamChanged(examId, 'active');
      } catch (error) {
        console.error('restart_exam failed:', error);
      }
    });

    // ========== CHAT EVENTS ==========

    socket.on('chat_message', async (data: { examId: string; message: string }) => {
      try {
        const { examId, message } = data;
        if (!examId || !message) return;

        const senderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
        const messageId = await addChatMessage(examId, user.id, senderName, message);

        const chatMessage = {
          examId,
          messageId,
          senderId: user.id,
          senderName,
          message,
          status: 'pending',
          replyTo: null,
          replyMessage: null,
          replyAuthorId: null,
          replyAuthorName: null,
          createdAt: new Date().toISOString(),
          approvedAt: null
        };

        // Emit to the student who sent + professors
        socket.emit('chat_update', chatMessage);
        io.to('professors_room').emit('chat_update', chatMessage);

        console.log(`Chat message from ${user.email} in exam ${examId}`);
      } catch (error) {
        console.error('chat_message failed:', error);
      }
    });

    socket.on('chat_reply', async (data: { examId: string; messageId: string; replyMessage: string }) => {
      if (role !== 'professor') return;
      try {
        const { examId, messageId, replyMessage } = data;
        if (!examId || !messageId || !replyMessage) return;

        const replyAuthorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
        await replyChatMessage(examId, messageId, replyMessage, user.id, replyAuthorName);

        // Fetch the updated message
        const messages = await getChatMessages(examId);
        const updatedMessage = messages.find(m => m.messageId === messageId);

        if (updatedMessage) {
          // Emit to everyone in the exam room
          io.to(examId).emit('chat_update', updatedMessage);
          io.to('professors_room').emit('chat_update', updatedMessage);
        }

        console.log(`Chat reply from ${user.email} in exam ${examId}`);
      } catch (error) {
        console.error('chat_reply failed:', error);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`Disconnected: ${user.email}`);
      await redisClient.del(`user:status:${user.id}`);

      for (const room of socket.rooms) {
        if (room !== socket.id) {
          io.to(room).emit('student_status_update', {
            studentId: user.id,
            email: user.email,
            status: 'offline',
            timestamp: Date.now(),
            examId: room
          });
        }
      }
    });
  });
};
