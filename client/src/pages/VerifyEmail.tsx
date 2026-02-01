import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying email...');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Verification token is missing.');
      return;
    }

    const verify = async () => {
      try {
        const response = await api.get(`/auth/verify?token=${token}`);
        setStatus('success');
        setMessage(response.data?.message || 'Email verified successfully.');
      } catch (err: any) {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Verification failed.');
      }
    };

    verify();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-indigo-950 px-4 py-8">
      <div className="max-w-md w-full space-y-6 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-xl shadow-gray-200/50 dark:shadow-none rounded-2xl p-8 text-center border border-gray-200/60 dark:border-gray-700/60">
        {/* Status Icon */}
        <div className="flex justify-center">
          {status === 'success' && (
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
          {status === 'error' && (
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
          {status === 'loading' && (
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <svg className="animate-spin h-8 w-8 text-indigo-600 dark:text-indigo-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Account verification
        </h1>
        <p
          className={`text-sm ${
            status === 'success'
              ? 'text-green-600 dark:text-green-400'
              : status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          {message}
        </p>
        <div>
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-sm shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
