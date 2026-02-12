import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// This component redirects to the appropriate dashboard based on user role
export default function Dashboard() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a12]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Redirect based on role
  if (user.role === 'PROFESSOR') {
    return <Navigate to="/professor" replace />;
  }

  return <Navigate to="/student" replace />;
}
