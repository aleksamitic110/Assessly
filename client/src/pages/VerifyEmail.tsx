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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4 py-8">
      <div className="max-w-md w-full space-y-6 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8 text-center">
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
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
