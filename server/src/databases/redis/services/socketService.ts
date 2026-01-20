import dotenv from 'dotenv';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { redisClient } from '../client.js';

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
    console.log(`Connected: ${user.email} (${user.role})`);

    await redisClient.set(`user:status:${user.id}`, 'online', { EX: 60 });

    if (user.role === 'professor' || user.role === 'admin') {
      socket.join('professors_room');
    }

    socket.on('join_exam', async (examId: string) => {
      socket.join(examId);
      console.log(`${user.email} joined ${examId}`);

      const endTime = await redisClient.get(`exam:${examId}:end_time`);
      if (endTime) {
        const remaining = Math.max(0, parseInt(endTime) - Date.now());
        socket.emit('timer_sync', { remainingMilliseconds: remaining });
      }

      if (user.role === 'student') {
        io.to(examId).emit('student_status_update', {
          studentId: user.id,
          email: user.email,
          status: 'online',
          timestamp: Date.now()
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
        timestamp: Date.now()
      });
    });

    socket.on('start_exam', async (data) => {
      if (user.role !== 'professor') return;
      const { examId, durationMinutes } = data;
      const endTime = Date.now() + (durationMinutes * 60 * 1000);

      await redisClient.set(`exam:${examId}:end_time`, endTime.toString(), {
        EX: durationMinutes * 60 + 3600
      });

      io.to(examId).emit('exam_started', {
        startTime: Date.now(),
        durationMinutes,
        endTime
      });
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
            timestamp: Date.now()
          });
        }
      }
    });
  });
};
