import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';
import ProfessorDashboard from './pages/ProfessorDashboard';
import StudentDashboard from './pages/StudentDashboard';
import ExamPage from './pages/ExamPage';
import ProfessorReviewPage from './pages/ProfessorReviewPage';
import StudentWorkView from './pages/StudentWorkView';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import ChangePassword from './pages/ChangePassword';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<VerifyEmail />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Professor only */}
          <Route
            path="/professor"
            element={
              <ProtectedRoute allowedRoles={['PROFESSOR']}>
                <ProfessorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/professor/exam/:examId/review"
            element={
              <ProtectedRoute allowedRoles={['PROFESSOR']}>
                <ProfessorReviewPage />
              </ProtectedRoute>
            }
          />

          {/* Student only */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/exam/:examId"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <ExamPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/exam/:examId/review"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <StudentWorkView />
              </ProtectedRoute>
            }
          />

          {/* Change password (Student + Professor) */}
          <Route
            path="/change-password"
            element={
              <ProtectedRoute allowedRoles={['STUDENT', 'PROFESSOR']}>
                <ChangePassword />
              </ProtectedRoute>
            }
          />

          {/* Admin routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* 404 - redirect to dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
