import dotenv from 'dotenv';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../client.js';
import { neo4jDriver } from '../../neo4j/driver.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'tvoj_tajni_kljuc';

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

export const initSocket = (io: Server) => {
  const STATE_TTL_SECONDS = 60 * 60 * 24;
  const WITHDRAWN_KEY_PREFIX = (examId: string) => `exam:${examId}:withdrawn:`;
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
    io.emit('exam_changed', {
      examId,
      status,
      timestamp: Date.now()
    });
  };

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['token'];

    if (!token) return next(new Error('Authentication error: No token provided'));

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
      socket.join(examId);
      console.log(`${user.email} joined ${examId}`);

      const state = await getExamState(examId);
      socket.emit('exam_state', state);
      if (state.status === 'active') {
        socket.emit('timer_sync', { remainingMilliseconds: state.remainingMilliseconds });
      }

      if (role === 'student') {
        io.to(examId).emit('student_status_update', {
          studentId: user.id,
          email: user.email,
          status: 'online',
          timestamp: Date.now(),
          examId
        });
      }
    });

    socket.on('leave_exam', async (examId: string) => {
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

      await emitExamState(examId);
      notifyExamChanged(examId, 'active');
    });

    socket.on('pause_exam', async (data) => {
      if (role !== 'professor') return;
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
    });

    socket.on('resume_exam', async (data) => {
      if (role !== 'professor') return;
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
    });

    socket.on('extend_exam', async (data) => {
      if (role !== 'professor') return;
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
    });

    socket.on('end_exam', async (data) => {
      if (role !== 'professor') return;
      const { examId } = data;

      await redisClient.set(`exam:${examId}:status`, 'completed', { EX: STATE_TTL_SECONDS });
      await redisClient.set(`exam:${examId}:end_time`, Date.now().toString(), { EX: STATE_TTL_SECONDS });
      await redisClient.del(`exam:${examId}:remaining_ms`);

      await emitExamState(examId);
      notifyExamChanged(examId, 'completed');
    });

    socket.on('restart_exam', async (data) => {
      if (role !== 'professor') return;
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

      await emitExamState(examId);
      notifyExamChanged(examId, 'active');
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
