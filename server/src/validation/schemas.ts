import { z } from 'zod';

const trimmedString = (max: number) =>
  z.string().trim().min(1).max(max);

export const uuidParam = z.object({
  examId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional()
});

export const authSchemas = {
  register: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(128),
    firstName: trimmedString(50),
    lastName: trimmedString(50)
  }),
  login: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(128)
  }),
  verifyEmail: z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid token')
  }),
  requestPasswordReset: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase())
  }),
  resetPassword: z.object({
    token: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid token'),
    newPassword: z.string().min(8).max(128)
  })
};

export const subjectSchemas = {
  create: z.object({
    name: trimmedString(100),
    description: z.string().trim().max(500).optional().nullable(),
    password: z.string().min(6).max(128)
  }),
  update: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    password: z.string().min(6).max(128).optional(),
    invalidateEnrollments: z.boolean().optional()
  }),
  addProfessor: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase())
  }),
  enroll: z.object({
    password: z.string().min(6).max(128)
  })
};

export const examSchemas = {
  create: z.object({
    subjectId: z.string().uuid(),
    name: trimmedString(120),
    startTime: z.string().datetime(),
    durationMinutes: z.coerce.number().int().min(1).max(600)
  }),
  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    startTime: z.string().datetime().optional(),
    durationMinutes: z.coerce.number().int().min(1).max(600).optional()
  })
};

export const taskSchemas = {
  create: z.object({
    examId: z.string().uuid(),
    title: trimmedString(120),
    description: z.string().trim().max(2000).optional().nullable(),
    starterCode: z.string().max(20000).optional().nullable(),
    testCases: z.union([z.string(), z.array(z.any())]).optional().nullable(),
    exampleInput: z.string().max(2000).optional().nullable(),
    exampleOutput: z.string().max(2000).optional().nullable(),
    notes: z.string().max(2000).optional().nullable()
  }),
  update: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    starterCode: z.string().max(20000).optional().nullable(),
    testCases: z.union([z.string(), z.array(z.any())]).optional().nullable(),
    exampleInput: z.string().max(2000).optional().nullable(),
    exampleOutput: z.string().max(2000).optional().nullable(),
    notes: z.string().max(2000).optional().nullable()
  })
};

export const submissionSchemas = {
  save: z.object({
    taskId: z.string().uuid(),
    sourceCode: z.string().max(50000),
    output: z.string().max(10000).optional().nullable()
  })
};

export const adminSchemas = {
  createUser: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(128),
    firstName: trimmedString(50),
    lastName: trimmedString(50),
    role: z.enum(['STUDENT', 'PROFESSOR'])
  }),
  updateUser: z.object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()).optional(),
    firstName: z.string().trim().min(1).max(50).optional(),
    lastName: z.string().trim().min(1).max(50).optional(),
    role: z.enum(['STUDENT', 'PROFESSOR']).optional(),
    isVerified: z.boolean().optional()
  }),
  changePassword: z.object({
    currentPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8).max(128),
    confirmNewPassword: z.string().min(8).max(128)
  }),
  createSubject: z.object({
    name: trimmedString(100),
    description: z.string().trim().max(500).optional().nullable(),
    password: z.string().min(6).max(128),
    professorId: z.string().uuid()
  }),
  updateSubject: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    password: z.string().min(6).max(128).optional()
  }),
  createExam: z.object({
    subjectId: z.string().uuid(),
    name: trimmedString(120),
    startTime: z.string().datetime(),
    durationMinutes: z.coerce.number().int().min(1).max(600)
  }),
  updateExam: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    startTime: z.string().datetime().optional(),
    durationMinutes: z.coerce.number().int().min(1).max(600).optional()
  }),
  createTask: z.object({
    examId: z.string().uuid(),
    title: trimmedString(120),
    description: z.string().trim().max(2000).optional().nullable(),
    starterCode: z.string().max(20000).optional().nullable(),
    testCases: z.union([z.string(), z.array(z.any())]).optional().nullable(),
    exampleInput: z.string().max(2000).optional().nullable(),
    exampleOutput: z.string().max(2000).optional().nullable(),
    notes: z.string().max(2000).optional().nullable()
  }),
  updateTask: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    starterCode: z.string().max(20000).optional().nullable(),
    testCases: z.union([z.string(), z.array(z.any())]).optional().nullable(),
    exampleInput: z.string().max(2000).optional().nullable(),
    exampleOutput: z.string().max(2000).optional().nullable(),
    notes: z.string().max(2000).optional().nullable()
  })
};

export const runSchemas = {
  run: z.object({
    taskId: z.string().uuid(),
    sourceCode: z.string().max(50000),
    input: z.string().max(10000).optional().nullable(),
    languageId: z.coerce.number().int().positive().optional().nullable()
  })
};

export const logsSchemas = {
  execution: z.object({
    examId: z.string().uuid(),
    sourceCode: z.string().max(50000),
    output: z.string().max(10000).optional().nullable(),
    status: z.string().trim().min(1).max(50)
  }),
  securityEvent: z.object({
    examId: z.string().uuid(),
    eventType: z.string().trim().min(1).max(100),
    details: z.any().optional()
  })
};
