export type UserRole = 'STUDENT' | 'PROFESSOR';

export interface User {
  id: string;        // UUID ili Neo4j ID
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
}

// Tipovi za API zahteve
export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}