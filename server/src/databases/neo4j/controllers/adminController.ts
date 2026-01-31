/**
 * Admin controller — handles admin authentication and admin-only operations.
 *
 * TODO: Replace hardcoded admin credentials with env variables (ADMIN_EMAIL, ADMIN_PASSWORD)
 * before deploying to production. This is demo-only.
 */

import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { types } from 'cassandra-driver';
import { neo4jDriver } from '../driver.js';
import { redisClient } from '../../redis/client.js';
import { cassandraClient } from '../../cassandra/client.js';
import { logAdminActivity } from '../../cassandra/services/logsService.js';

const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// TODO: Move to env variables for production
const ADMIN_EMAIL = 'admin';
const ADMIN_PASSWORD = 'admin';
const ADMIN_ID = 'admin-000-000-000';

// ─── Admin Login ───────────────────────────────────────────────────────────────

export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const token = jwt.sign(
    { id: ADMIN_ID, email: ADMIN_EMAIL, role: 'ADMIN' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const user = {
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    firstName: 'Admin',
    lastName: '',
    role: 'ADMIN'
  };

  res.json({ token, user });
};

// ─── System Health ─────────────────────────────────────────────────────────────

export const getSystemHealth = async (_req: Request, res: Response) => {
  const results: Record<string, { status: string; info?: string }> = {};

  // Neo4j
  try {
    const session = neo4jDriver.session();
    const r = await session.run('CALL dbms.components() YIELD name, versions RETURN name, versions');
    const rec = r.records[0];
    results.neo4j = { status: 'ok', info: `${rec?.get('name')} ${rec?.get('versions')?.[0] ?? ''}` };
    await session.close();
  } catch {
    results.neo4j = { status: 'error' };
  }

  // Redis
  try {
    const pong = await redisClient.ping();
    results.redis = { status: pong === 'PONG' ? 'ok' : 'error', info: pong };
  } catch {
    results.redis = { status: 'error' };
  }

  // Cassandra
  try {
    const r = await cassandraClient.execute('SELECT release_version FROM system.local');
    results.cassandra = { status: 'ok', info: r.rows[0]?.release_version };
  } catch {
    results.cassandra = { status: 'error' };
  }

  res.json(results);
};

// ─── Users ─────────────────────────────────────────────────────────────────────

export const getUsers = async (req: Request, res: Response) => {
  const { search } = req.query;
  const session = neo4jDriver.session();

  try {
    let result;
    if (search) {
      const term = String(search).toLowerCase().replace(/[^a-z0-9@._-]/g, '');
      // Try fulltext index first (fast), fall back to STARTS WITH on the indexed email property
      try {
        result = await session.run(
          `CALL db.index.fulltext.queryNodes('userEmailFulltext', $term + '*')
           YIELD node AS u, score
           RETURN u ORDER BY score DESC, u.email`,
          { term }
        );
      } catch {
        // Fulltext index not available — fall back to STARTS WITH (uses btree index)
        result = await session.run(
          `MATCH (u:User) WHERE u.email STARTS WITH $term RETURN u ORDER BY u.email`,
          { term }
        );
      }
    } else {
      result = await session.run(`MATCH (u:User) RETURN u ORDER BY u.email`);
    }

    const users = result.records.map(r => {
      const u = r.get('u').properties;
      return {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isVerified: u.isVerified,
        disabled: u.disabled === true || u.disabled === 'true',
        createdAt: u.createdAt?.toString?.() ?? null
      };
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  } finally {
    await session.close();
  }
};

export const changeUserRole = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role || !['STUDENT', 'PROFESSOR'].includes(role)) {
    return res.status(400).json({ error: 'Role must be STUDENT or PROFESSOR' });
  }

  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {id: $id}) SET u.role = $role RETURN u`,
      { id, role }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = result.records[0].get('u').properties;
    await logAdminActivity('ADMIN_USER_ROLE_CHANGE', { userId: id, email: u.email, newRole: role });
    res.json({ id: u.id, email: u.email, role: u.role });
  } catch (error) {
    res.status(500).json({ error: 'Error changing user role' });
  } finally {
    await session.close();
  }
};

export const disableUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { disabled } = req.body;

  if (typeof disabled !== 'boolean') {
    return res.status(400).json({ error: 'disabled must be a boolean' });
  }

  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      `MATCH (u:User {id: $id}) SET u.disabled = $disabled RETURN u`,
      { id, disabled }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = result.records[0].get('u').properties;
    await logAdminActivity('ADMIN_USER_DISABLE', { userId: id, email: u.email, disabled });
    res.json({ id: u.id, email: u.email, disabled: u.disabled === true || u.disabled === 'true' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating user' });
  } finally {
    await session.close();
  }
};

// ─── Exams & Subjects ──────────────────────────────────────────────────────────

export const adminGetExams = async (_req: Request, res: Response) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(`
      MATCH (s:Subject)-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      RETURN s, e, count(t) AS taskCount
      ORDER BY s.name, e.name
    `);

    const exams = result.records.map(r => {
      const subject = r.get('s').properties;
      const exam = r.get('e').properties;
      const taskCountRaw = r.get('taskCount');
      const taskCount = typeof taskCountRaw?.toNumber === 'function' ? taskCountRaw.toNumber() : Number(taskCountRaw || 0);
      return {
        id: exam.id,
        name: exam.name,
        startTime: exam.startTime,
        durationMinutes: Number(exam.durationMinutes),
        subjectId: subject.id,
        subjectName: subject.name,
        taskCount
      };
    });

    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching exams' });
  } finally {
    await session.close();
  }
};

export const adminGetSubjects = async (_req: Request, res: Response) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(`
      MATCH (s:Subject)
      OPTIONAL MATCH (p:User)-[:PREDAJE]->(s)
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      RETURN s, p.email AS professorEmail, count(e) AS examCount
      ORDER BY s.name
    `);

    const subjects = result.records.map(r => {
      const s = r.get('s').properties;
      const examCountRaw = r.get('examCount');
      const examCount = typeof examCountRaw?.toNumber === 'function' ? examCountRaw.toNumber() : Number(examCountRaw || 0);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        professorEmail: r.get('professorEmail') || null,
        examCount
      };
    });

    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching subjects' });
  } finally {
    await session.close();
  }
};

export const adminDeleteExam = async (req: Request, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      DETACH DELETE t, e
      RETURN count(e) AS deleted
      `,
      { examId }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber?.() ?? result.records[0]?.get('deleted');
    if (!deleted) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    await redisClient.del(
      `exam:${examId}:status`,
      `exam:${examId}:start_time`,
      `exam:${examId}:end_time`,
      `exam:${examId}:remaining_ms`,
      `exam:${examId}:duration_seconds`,
      `exam:${examId}:session_id`
    );

    await logAdminActivity('ADMIN_EXAM_DELETE', { examId });
    res.json({ message: 'Exam deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting exam' });
  } finally {
    await session.close();
  }
};

export const adminDeleteSubject = async (req: Request, res: Response) => {
  const { subjectId } = req.params;
  const session = neo4jDriver.session();

  try {
    const examsResult = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      RETURN collect(e.id) AS examIds
      `,
      { subjectId }
    );

    if (examsResult.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const examIds: string[] = (examsResult.records[0].get('examIds') || []).filter(Boolean);
    if (examIds.length > 0) {
      await Promise.all(
        examIds.map((eid) =>
          redisClient.del(
            `exam:${eid}:status`,
            `exam:${eid}:start_time`,
            `exam:${eid}:end_time`,
            `exam:${eid}:remaining_ms`,
            `exam:${eid}:duration_seconds`,
            `exam:${eid}:session_id`
          )
        )
      );
    }

    await session.run(
      `
      MATCH (s:Subject {id: $subjectId})
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      OPTIONAL MATCH (e)-[:IMA_ZADATAK]->(t:Task)
      DETACH DELETE t, e, s
      `,
      { subjectId }
    );

    await logAdminActivity('ADMIN_SUBJECT_DELETE', { subjectId });
    res.json({ message: 'Subject deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting subject' });
  } finally {
    await session.close();
  }
};

export const adminResetExamState = async (req: Request, res: Response) => {
  const { examId } = req.params;

  try {
    await redisClient.del(
      `exam:${examId}:status`,
      `exam:${examId}:start_time`,
      `exam:${examId}:end_time`,
      `exam:${examId}:remaining_ms`,
      `exam:${examId}:duration_seconds`,
      `exam:${examId}:session_id`
    );

    await logAdminActivity('ADMIN_EXAM_RESET_STATE', { examId });
    res.json({ message: 'Exam Redis state reset' });
  } catch (error) {
    res.status(500).json({ error: 'Error resetting exam state' });
  }
};

// ─── Statistics ─────────────────────────────────────────────────────────────────

export const getStatistics = async (_req: Request, res: Response) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(`
      MATCH (u:User)
      WITH count(u) AS totalUsers
      OPTIONAL MATCH (s:User {role: 'STUDENT'})
      WITH totalUsers, count(s) AS totalStudents
      OPTIONAL MATCH (p:User {role: 'PROFESSOR'})
      WITH totalUsers, totalStudents, count(p) AS totalProfessors
      WITH totalUsers, totalStudents, totalProfessors
      OPTIONAL MATCH (sub:Subject)
      WITH totalUsers, totalStudents, totalProfessors, count(DISTINCT sub) AS totalSubjects
      OPTIONAL MATCH (e:Exam)
      RETURN totalUsers, totalStudents, totalProfessors, totalSubjects, count(DISTINCT e) AS totalExams
    `);

    const rec = result.records[0];
    const toNum = (v: any) => typeof v?.toNumber === 'function' ? v.toNumber() : Number(v || 0);

    // Check Redis for active exams
    const allExamIds = await session.run(`MATCH (e:Exam) RETURN e.id AS id`);
    let activeExams = 0;
    for (const r of allExamIds.records) {
      const examId = r.get('id');
      const status = await redisClient.get(`exam:${examId}:status`);
      if (status === 'active' || status === 'paused') activeExams++;
    }

    res.json({
      totalUsers: toNum(rec.get('totalUsers')),
      totalStudents: toNum(rec.get('totalStudents')),
      totalProfessors: toNum(rec.get('totalProfessors')),
      totalSubjects: toNum(rec.get('totalSubjects')),
      totalExams: toNum(rec.get('totalExams')),
      activeExams
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching statistics' });
  } finally {
    await session.close();
  }
};

// ─── Security Events ────────────────────────────────────────────────────────────

export const getSecurityEventsAdmin = async (req: Request, res: Response) => {
  const { examId } = req.query;

  try {
    if (examId) {
      // Specific exam
      const result = await cassandraClient.execute(
        `SELECT exam_id, student_id, event_type, timestamp, details FROM security_events WHERE exam_id = ? LIMIT 200`,
        [types.Uuid.fromString(String(examId))],
        { prepare: true }
      );

      const events = result.rows.map(row => ({
        examId: row.exam_id.toString(),
        studentId: row.student_id.toString(),
        eventType: row.event_type,
        timestamp: row.timestamp.toISOString(),
        details: JSON.parse(row.details || '{}')
      }));

      return res.json(events);
    }

    // No examId — get events from all known exams (latest 10 exams)
    const session = neo4jDriver.session();
    const examsResult = await session.run(
      `MATCH (e:Exam) RETURN e.id AS id ORDER BY e.startTime DESC LIMIT 10`
    );
    await session.close();

    const allEvents: any[] = [];
    for (const rec of examsResult.records) {
      const eid = rec.get('id');
      if (!eid) continue;
      try {
        const result = await cassandraClient.execute(
          `SELECT exam_id, student_id, event_type, timestamp, details FROM security_events WHERE exam_id = ? LIMIT 50`,
          [types.Uuid.fromString(eid)],
          { prepare: true }
        );
        for (const row of result.rows) {
          allEvents.push({
            examId: row.exam_id.toString(),
            studentId: row.student_id.toString(),
            eventType: row.event_type,
            timestamp: row.timestamp.toISOString(),
            details: JSON.parse(row.details || '{}')
          });
        }
      } catch (err) {
        console.warn(`[Admin] Failed to fetch security events for exam ${eid}:`, err);
      }
    }

    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(allEvents.slice(0, 200));
  } catch (error) {
    console.error('[Admin] Error fetching security events:', error);
    res.status(500).json({ error: 'Error fetching security events' });
  }
};

// ─── Active Exams Monitor ───────────────────────────────────────────────────────

export const getActiveExams = async (_req: Request, res: Response) => {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(`
      MATCH (s:Subject)-[:SADRZI]->(e:Exam)
      RETURN e.id AS id, e.name AS name, e.startTime AS startTime,
             e.durationMinutes AS durationMinutes, s.name AS subjectName
    `);

    const activeExams: any[] = [];
    for (const rec of result.records) {
      const examId = rec.get('id');
      const [status, startTimeRaw, endTimeRaw, remainingRaw] = await redisClient.mGet([
        `exam:${examId}:status`,
        `exam:${examId}:start_time`,
        `exam:${examId}:end_time`,
        `exam:${examId}:remaining_ms`
      ]);

      if (!status || status === 'completed') continue;

      // Count online students
      const startedStudents = await redisClient.sMembers(`exam:${examId}:started_students`);
      const now = Date.now();
      const endTime = endTimeRaw ? parseInt(endTimeRaw, 10) : undefined;
      let remainingSeconds = 0;

      if (status === 'active' && endTime) {
        remainingSeconds = Math.max(0, Math.ceil((endTime - now) / 1000));
      } else if (status === 'paused' && remainingRaw) {
        remainingSeconds = Math.max(0, Math.ceil(parseInt(remainingRaw, 10) / 1000));
      }

      const durationRaw = rec.get('durationMinutes');
      activeExams.push({
        id: examId,
        name: rec.get('name'),
        subjectName: rec.get('subjectName'),
        startTime: rec.get('startTime'),
        durationMinutes: typeof durationRaw?.toNumber === 'function' ? durationRaw.toNumber() : Number(durationRaw || 0),
        status,
        remainingSeconds,
        startedAt: startTimeRaw ? new Date(parseInt(startTimeRaw, 10)).toISOString() : null,
        studentsOnline: startedStudents.length
      });
    }

    res.json(activeExams);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching active exams' });
  } finally {
    await session.close();
  }
};

// ─── Audit / User Activity ─────────────────────────────────────────────────────

export const getRecentActivity = async (_req: Request, res: Response) => {
  try {
    // user_activity is partitioned by user_id, so we can't efficiently scan all partitions.
    // For the admin panel we query a small recent slice — best-effort across known users.
    // To keep it simple, we fetch the last 100 rows from execution_logs as a proxy for recent activity,
    // since there's no global activity table partition we can scan.
    // If you need true global audit, consider adding a global_activity table.

    // Attempt to read from user_activity for recently active users (from Neo4j)
    const session = neo4jDriver.session();
    const usersResult = await session.run(
      `MATCH (u:User) RETURN u.id AS id ORDER BY u.createdAt DESC LIMIT 20`
    );
    await session.close();

    const activities: any[] = [];

    // Also fetch admin actions (stored under a fixed UUID partition)
    try {
      const adminResult = await cassandraClient.execute(
        `SELECT user_id, event_type, timestamp, details FROM user_activity WHERE user_id = ? LIMIT 50`,
        [types.Uuid.fromString('00000000-0000-0000-0000-000000000000')],
        { prepare: true }
      );
      for (const row of adminResult.rows) {
        activities.push({
          userId: 'ADMIN',
          eventType: row.event_type,
          timestamp: row.timestamp.toISOString(),
          details: JSON.parse(row.details || '{}')
        });
      }
    } catch (err) {
      console.warn('Failed to fetch admin activity:', err);
    }

    for (const record of usersResult.records) {
      const userId = record.get('id');
      if (!userId) continue;
      try {
        const r = await cassandraClient.execute(
          `SELECT user_id, event_type, timestamp, details FROM user_activity WHERE user_id = ? LIMIT 10`,
          [types.Uuid.fromString(userId)],
          { prepare: true }
        );
        for (const row of r.rows) {
          activities.push({
            userId: row.user_id.toString(),
            eventType: row.event_type,
            timestamp: row.timestamp.toISOString(),
            details: JSON.parse(row.details || '{}')
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch activity for user ${userId}:`, err);
      }
    }

    // Sort by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(activities.slice(0, 100));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching activity' });
  }
};

// ─── Admin CRUD: Users ────────────────────────────────────────────────────────

export const adminCreateUser = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, role } = req.body;
  const session = neo4jDriver.session();

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const id = uuidv4();

    const result = await session.run(
      `CREATE (u:User {
        id: $id, email: $email, passwordHash: $passwordHash,
        firstName: $firstName, lastName: $lastName, role: $role,
        isVerified: true, createdAt: datetime()
      }) RETURN u`,
      { id, email, passwordHash, firstName, lastName, role }
    );

    const u = result.records[0].get('u').properties;
    delete u.passwordHash;
    await logAdminActivity('ADMIN_USER_CREATE', { userId: id, email });
    res.status(201).json(u);
  } catch (error: any) {
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      return res.status(400).json({ error: 'Email is already registered' });
    }
    res.status(500).json({ error: 'Error creating user' });
  } finally {
    await session.close();
  }
};

export const adminGetUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(`MATCH (u:User {id: $id}) RETURN u`, { id });
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const u = result.records[0].get('u').properties;
    delete u.passwordHash;
    res.json(u);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  } finally {
    await session.close();
  }
};

export const adminUpdateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { email, firstName, lastName, role } = req.body;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $id})
       SET u.email = COALESCE($email, u.email),
           u.firstName = COALESCE($firstName, u.firstName),
           u.lastName = COALESCE($lastName, u.lastName),
           u.role = COALESCE($role, u.role)
       RETURN u`,
      { id, email: email || null, firstName: firstName || null, lastName: lastName || null, role: role || null }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = result.records[0].get('u').properties;
    delete u.passwordHash;
    await logAdminActivity('ADMIN_USER_ROLE_CHANGE', { userId: id, email: u.email, updates: req.body });
    res.json(u);
  } catch (error: any) {
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      return res.status(400).json({ error: 'Email is already taken' });
    }
    res.status(500).json({ error: 'Error updating user' });
  } finally {
    await session.close();
  }
};

export const adminDeleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $id}) DETACH DELETE u RETURN count(u) AS deleted`,
      { id }
    );
    const deleted = result.records[0]?.get('deleted')?.toNumber?.() ?? result.records[0]?.get('deleted');
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }
    await logAdminActivity('ADMIN_USER_DELETE', { userId: id });
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user' });
  } finally {
    await session.close();
  }
};

// ─── Admin CRUD: Subjects ─────────────────────────────────────────────────────

export const adminCreateSubject = async (req: Request, res: Response) => {
  const { name, description, password, professorId } = req.body;
  const session = neo4jDriver.session();

  try {
    const passwordHash = await bcrypt.hash(String(password), 10);
    const id = uuidv4();

    const result = await session.run(
      `MATCH (p:User {id: $professorId})
       CREATE (s:Subject {id: $id, name: $name, description: $description, passwordHash: $passwordHash})
       CREATE (p)-[:PREDAJE]->(s)
       RETURN s`,
      { professorId, id, name, description: description || '', passwordHash }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Professor not found' });
    }

    const s = result.records[0].get('s').properties;
    delete s.passwordHash;
    await logAdminActivity('ADMIN_SUBJECT_CREATE', { subjectId: id, name });
    res.status(201).json(s);
  } catch (error) {
    res.status(500).json({ error: 'Error creating subject' });
  } finally {
    await session.close();
  }
};

export const adminUpdateSubject = async (req: Request, res: Response) => {
  const { subjectId } = req.params;
  const { name, description, password } = req.body;
  const session = neo4jDriver.session();

  try {
    const passwordHash = password ? await bcrypt.hash(String(password), 10) : null;

    const result = await session.run(
      `MATCH (s:Subject {id: $subjectId})
       SET s.name = COALESCE($name, s.name),
           s.description = COALESCE($description, s.description),
           s.passwordHash = COALESCE($passwordHash, s.passwordHash)
       RETURN s`,
      { subjectId, name: name || null, description: description !== undefined ? description : null, passwordHash }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const s = result.records[0].get('s').properties;
    delete s.passwordHash;
    await logAdminActivity('ADMIN_SUBJECT_UPDATE', { subjectId, name: s.name });
    res.json(s);
  } catch (error) {
    res.status(500).json({ error: 'Error updating subject' });
  } finally {
    await session.close();
  }
};

// ─── Admin CRUD: Exams ────────────────────────────────────────────────────────

export const adminCreateExam = async (req: Request, res: Response) => {
  const { subjectId, name, startTime, durationMinutes } = req.body;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `MATCH (s:Subject {id: $subjectId})
       CREATE (e:Exam {id: $id, name: $name, startTime: $startTime, durationMinutes: $durationMinutes})
       CREATE (s)-[:SADRZI]->(e)
       RETURN e`,
      { subjectId, id, name, startTime, durationMinutes }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const e = result.records[0].get('e').properties;
    await logAdminActivity('ADMIN_EXAM_CREATE', { examId: id, name, subjectId });
    res.status(201).json(e);
  } catch (error) {
    res.status(500).json({ error: 'Error creating exam' });
  } finally {
    await session.close();
  }
};

export const adminUpdateExam = async (req: Request, res: Response) => {
  const { examId } = req.params;
  const { name, startTime, durationMinutes } = req.body;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `MATCH (e:Exam {id: $examId})
       SET e.name = COALESCE($name, e.name),
           e.startTime = COALESCE($startTime, e.startTime),
           e.durationMinutes = COALESCE($durationMinutes, e.durationMinutes)
       RETURN e`,
      { examId, name: name || null, startTime: startTime || null, durationMinutes: durationMinutes ?? null }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const e = result.records[0].get('e').properties;
    await logAdminActivity('ADMIN_EXAM_UPDATE', { examId, name: e.name });
    res.json(e);
  } catch (error) {
    res.status(500).json({ error: 'Error updating exam' });
  } finally {
    await session.close();
  }
};

// ─── Admin CRUD: Tasks ────────────────────────────────────────────────────────

export const adminGetTasks = async (req: Request, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
       RETURN t ORDER BY t.title`,
      { examId }
    );

    const tasks = result.records.map(r => r.get('t').properties);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching tasks' });
  } finally {
    await session.close();
  }
};

export const adminCreateTask = async (req: Request, res: Response) => {
  const { examId, title, description, starterCode, testCases, exampleInput, exampleOutput, notes } = req.body;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const testCasesStr = testCases ? (typeof testCases === 'string' ? testCases : JSON.stringify(testCases)) : null;

    const result = await session.run(
      `MATCH (e:Exam {id: $examId})
       CREATE (t:Task {
         id: $id, title: $title, description: $description,
         starterCode: $starterCode, testCases: $testCases,
         exampleInput: $exampleInput, exampleOutput: $exampleOutput,
         notes: $notes
       })
       CREATE (e)-[:IMA_ZADATAK]->(t)
       RETURN t`,
      { examId, id, title, description: description || '', starterCode: starterCode || '', testCases: testCasesStr, exampleInput: exampleInput || '', exampleOutput: exampleOutput || '', notes: notes || '' }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const t = result.records[0].get('t').properties;
    await logAdminActivity('ADMIN_TASK_CREATE', { taskId: id, examId, title });
    res.status(201).json(t);
  } catch (error) {
    res.status(500).json({ error: 'Error creating task' });
  } finally {
    await session.close();
  }
};

export const adminUpdateTask = async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const { title, description, starterCode, testCases, exampleInput, exampleOutput, notes } = req.body;
  const session = neo4jDriver.session();

  try {
    const testCasesStr = testCases !== undefined
      ? (testCases ? (typeof testCases === 'string' ? testCases : JSON.stringify(testCases)) : null)
      : undefined;

    const result = await session.run(
      `MATCH (t:Task {id: $taskId})
       SET t.title = COALESCE($title, t.title),
           t.description = COALESCE($description, t.description),
           t.starterCode = COALESCE($starterCode, t.starterCode),
           t.testCases = COALESCE($testCases, t.testCases),
           t.exampleInput = COALESCE($exampleInput, t.exampleInput),
           t.exampleOutput = COALESCE($exampleOutput, t.exampleOutput),
           t.notes = COALESCE($notes, t.notes)
       RETURN t`,
      {
        taskId,
        title: title || null,
        description: description !== undefined ? description : null,
        starterCode: starterCode !== undefined ? starterCode : null,
        testCases: testCasesStr !== undefined ? testCasesStr : null,
        exampleInput: exampleInput !== undefined ? exampleInput : null,
        exampleOutput: exampleOutput !== undefined ? exampleOutput : null,
        notes: notes !== undefined ? notes : null
      }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const t = result.records[0].get('t').properties;
    await logAdminActivity('ADMIN_TASK_UPDATE', { taskId, title: t.title });
    res.json(t);
  } catch (error) {
    res.status(500).json({ error: 'Error updating task' });
  } finally {
    await session.close();
  }
};

export const adminDeleteTask = async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `MATCH (t:Task {id: $taskId}) DETACH DELETE t RETURN count(t) AS deleted`,
      { taskId }
    );
    const deleted = result.records[0]?.get('deleted')?.toNumber?.() ?? result.records[0]?.get('deleted');
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await logAdminActivity('ADMIN_TASK_DELETE', { taskId });
    res.json({ message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting task' });
  } finally {
    await session.close();
  }
};
