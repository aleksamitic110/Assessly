import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { neo4jDriver } from '../driver.js';
import { logUserActivity } from '../../cassandra/services/logsService.js';
import { sendVerificationEmail } from '../../../services/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

export const register = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;
  const session = neo4jDriver.session();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await session.run(
      `CREATE (u:User {
        id: $id,
        email: $email,
        passwordHash: $passwordHash,
        firstName: $firstName,
        lastName: $lastName,
        role: $role,
        isVerified: false,
        verificationToken: $verificationToken,
        verificationExpiresAt: $verificationExpiresAt,
        createdAt: datetime()
      }) RETURN u`,
      {
        id,
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'PENDING',
        verificationToken,
        verificationExpiresAt
      }
    );

    const newUser = result.records[0].get('u').properties;
    delete newUser.passwordHash;

    try {
      await logUserActivity(newUser.id, 'REGISTER', {
        email: newUser.email,
        role: newUser.role
      });
    } catch (logError) {
      console.warn('Failed to log user registration activity:', logError);
    }

    await sendVerificationEmail(newUser.email, verificationToken);
    res.status(201).json({ message: 'Registration successful. Check your email to verify.' });
  } catch (error: any) {
    if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      res.status(400).json({ error: 'Email is already registered' });
    } else {
      res.status(500).json({ error: 'Error while registering' });
    }
  } finally {
    await session.close();
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      'MATCH (u:User {email: $email}) RETURN u',
      { email }
    );

    if (result.records.length === 0) {
      return res.status(401).json({ error: 'Pogresan email ili lozinka' });
    }

    const user = result.records[0].get('u').properties;
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Pogresan email ili lozinka' });
    }

    if (user.isVerified === false || user.isVerified === 'false') {
      return res.status(403).json({ error: 'Email not verified' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    delete user.passwordHash;
    try {
      await logUserActivity(user.id, 'LOGIN', {
        email: user.email,
        role: user.role
      });
    } catch (logError) {
      console.warn('Failed to log user login activity:', logError);
    }

    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ error: 'Greska pri logovanju' });
  } finally {
    await session.close();
  }
};

export const verifyEmail = async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (u:User {verificationToken: $token})
      RETURN u
      `,
      { token }
    );

    if (result.records.length === 0) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const user = result.records[0].get('u').properties;
    if (user.isVerified === true || user.isVerified === 'true') {
      return res.json({ message: 'Email already verified' });
    }

    const expiresAt = user.verificationExpiresAt ? new Date(user.verificationExpiresAt).getTime() : 0;
    if (expiresAt && Date.now() > expiresAt) {
      return res.status(400).json({ error: 'Verification token expired' });
    }

    const emailLower = String(user.email || '').toLowerCase();
    const role = emailLower.endsWith('@elfak.rs') ? 'PROFESSOR' : 'STUDENT';

    await session.run(
      `
      MATCH (u:User {verificationToken: $token})
      SET u.isVerified = true,
          u.verifiedAt = datetime(),
          u.role = $role
      REMOVE u.verificationToken, u.verificationExpiresAt
      RETURN u
      `,
      { token, role }
    );

    res.json({ message: 'Email verified successfully', role });
  } catch (error) {
    res.status(500).json({ error: 'Error while verifying email' });
  } finally {
    await session.close();
  }
};
