import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { neo4jDriver } from '../driver.js';
import { logUserActivity } from '../../cassandra/services/logsService.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../../services/emailService.js';
import { clearLoginFailures, isLoginLocked, recordLoginFailure, hashToken } from '../../../services/loginSecurity.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

export const register = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;
  const session = neo4jDriver.session();

  try {
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const normalizedEmail = String(email || '').toLowerCase();
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
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
        email: normalizedEmail,
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
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const normalizedEmail = String(email || '').toLowerCase();
    const lock = await isLoginLocked(normalizedEmail);
    if (lock.locked) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Try again later.',
        retryAfterSeconds: lock.retryAfterSeconds
      });
    }

    const result = await session.run(
      'MATCH (u:User {email: $email}) RETURN u',
      { email: normalizedEmail }
    );

    if (result.records.length === 0) {
      await recordLoginFailure(normalizedEmail);
      return res.status(401).json({ error: 'Pogresan email ili lozinka' });
    }

    const user = result.records[0].get('u').properties;
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      await recordLoginFailure(normalizedEmail);
      return res.status(401).json({ error: 'Pogresan email ili lozinka' });
    }

    if (user.isVerified === false || user.isVerified === 'false') {
      return res.status(403).json({ error: 'Email not verified' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET!,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    delete user.passwordHash;
    await clearLoginFailures(normalizedEmail);
    try {
      await logUserActivity(user.id, 'LOGIN', {
        email: user.email,
        role: user.role
      });
    } catch (logError) {
      console.warn('Failed to log user login activity:', logError);
    }

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60
    });
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

export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;
  const session = neo4jDriver.session();

  try {
    const normalizedEmail = String(email || '').toLowerCase();
    const result = await session.run(
      'MATCH (u:User {email: $email}) RETURN u',
      { email: normalizedEmail }
    );

    if (result.records.length > 0) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = hashToken(resetToken);
      const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await session.run(
        `
        MATCH (u:User {email: $email})
        SET u.passwordResetTokenHash = $tokenHash,
            u.passwordResetExpiresAt = $expiresAt
        `,
        { email: normalizedEmail, tokenHash: resetTokenHash, expiresAt: resetExpiresAt }
      );

      const resetUrl = `${APP_BASE_URL}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail(normalizedEmail, resetUrl);
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to request password reset' });
  } finally {
    await session.close();
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  const session = neo4jDriver.session();

  try {
    const tokenHash = hashToken(String(token || ''));
    const result = await session.run(
      `
      MATCH (u:User {passwordResetTokenHash: $tokenHash})
      RETURN u
      `,
      { tokenHash }
    );

    if (result.records.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = result.records[0].get('u').properties;
    const expiresAt = user.passwordResetExpiresAt ? new Date(user.passwordResetExpiresAt).getTime() : 0;
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_SALT_ROUNDS);
    await session.run(
      `
      MATCH (u:User {passwordResetTokenHash: $tokenHash})
      SET u.passwordHash = $passwordHash
      REMOVE u.passwordResetTokenHash, u.passwordResetExpiresAt
      `,
      { tokenHash, passwordHash }
    );

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password' });
  } finally {
    await session.close();
  }
};

export const changePassword = async (req: any, res: Response) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({ error: 'New passwords do not match' });
  }

  const session = neo4jDriver.session();
  try {
    const result = await session.run(
      'MATCH (u:User {id: $userId}) RETURN u',
      { userId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.records[0].get('u').properties;
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await session.run(
      'MATCH (u:User {id: $userId}) SET u.passwordHash = $newHash',
      { userId, newHash }
    );

    try {
      await logUserActivity(userId, 'PASSWORD_CHANGE', { email: user.email });
    } catch (logErr) {
      console.warn('Failed to log password change activity:', logErr);
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to change password' });
  } finally {
    await session.close();
  }
};
