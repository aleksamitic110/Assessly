import api from './api';
import type { LoginRequest, RegisterRequest, AuthResponse, User } from '../types';

export const authService = {
  // Login user
  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/login', data);
    const { token, user } = response.data;

    // Store token and user in localStorage
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));

    return response.data;
  },

  // Admin login (separate endpoint)
  async adminLogin(data: LoginRequest): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/admin/login', data);
    const { token, user } = response.data;

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));

    return response.data;
  },

  // Register new user
  async register(data: RegisterRequest): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/register', data);
    return response.data;
  },

  // Logout user
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  // Get current user from localStorage
  getCurrentUser(): User | null {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr) as User;
    } catch {
      return null;
    }
  },

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('token');
  },

  // Get stored token
  getToken(): string | null {
    return localStorage.getItem('token');
  },
};

export default authService;
