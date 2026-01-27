import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  APP_BASE_URL
} = process.env;

const hasSmtpConfig =
  SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM;

const getTransporter = () => {
  if (!hasSmtpConfig) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
};

export const sendVerificationEmail = async (to: string, token: string) => {
  const verifyUrl = `${APP_BASE_URL || 'http://localhost:5173'}/verify?token=${token}`;

  if (!hasSmtpConfig) {
    console.log(`[email] Verification link for ${to}: ${verifyUrl}`);
    return;
  }

  const transporter = getTransporter();
  if (!transporter) return;

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Verify your Assessly account',
    text: `Click the link to verify your account: ${verifyUrl}`,
    html: `<p>Click the link to verify your account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
  });
};

export const sendPasswordResetEmail = async (to: string, resetUrl: string) => {
  if (!hasSmtpConfig) {
    console.log(`[email] Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  const transporter = getTransporter();
  if (!transporter) return;

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Reset your Assessly password',
    text: `Use the link to reset your password: ${resetUrl}`,
    html: `<p>Use the link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  });
};
