import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

type Tab = 'overview' | 'health' | 'users' | 'exams' | 'subjects' | 'active' | 'security' | 'activity';

interface HealthStatus {
  neo4j: { status: string; info?: string };
  redis: { status: string; info?: string };
  cassandra: { status: string; info?: string };
}

interface Statistics {
  totalUsers: number;
  totalStudents: number;
  totalProfessors: number;
  totalSubjects: number;
  totalExams: number;
  activeExams: number;
}

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isVerified: boolean;
  disabled: boolean;
  createdAt: string | null;
}

interface AdminExam {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  subjectId: string;
  subjectName: string;
  taskCount: number;
}

interface AdminSubject {
  id: string;
  name: string;
  description: string;
  professorEmail: string | null;
  examCount: number;
}

interface ActiveExam {
  id: string;
  name: string;
  subjectName: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  remainingSeconds: number;
  startedAt: string | null;
  studentsOnline: number;
}

interface SecurityEvent {
  examId: string;
  studentId: string;
  eventType: string;
  timestamp: string;
  details: Record<string, unknown>;
}

interface ActivityEntry {
  userId: string;
  eventType: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'health', label: 'System Health' },
    { key: 'active', label: 'Active Exams' },
    { key: 'users', label: 'Users' },
    { key: 'exams', label: 'Exams' },
    { key: 'subjects', label: 'Subjects' },
    { key: 'security', label: 'Security Events' },
    { key: 'activity', label: 'Audit Log' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-red-500">Assessly Admin</h1>
          <span className="text-sm text-gray-400">Logged in as {user?.email}</span>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          Logout
        </button>
      </header>

      {/* Tabs */}
      <nav className="bg-gray-800 border-b border-gray-700 px-6 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-red-500 text-red-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'health' && <HealthPanel />}
        {tab === 'active' && <ActiveExamsPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'exams' && <ExamsPanel />}
        {tab === 'subjects' && <SubjectsPanel />}
        {tab === 'security' && <SecurityEventsPanel />}
        {tab === 'activity' && <ActivityPanel />}
      </main>
    </div>
  );
}

// ─── Overview Panel ────────────────────────────────────────────────────────────

function OverviewPanel() {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, healthRes] = await Promise.all([
        api.get<Statistics>('/admin/statistics'),
        api.get<HealthStatus>('/admin/health'),
      ]);
      setStats(statsRes.data);
      setHealth(healthRes.data);
    } catch {
      setStats(null);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Spinner />;

  const statCards = stats ? [
    { label: 'Total Users', value: stats.totalUsers, color: 'text-blue-400' },
    { label: 'Students', value: stats.totalStudents, color: 'text-green-400' },
    { label: 'Professors', value: stats.totalProfessors, color: 'text-purple-400' },
    { label: 'Subjects', value: stats.totalSubjects, color: 'text-yellow-400' },
    { label: 'Total Exams', value: stats.totalExams, color: 'text-indigo-400' },
    { label: 'Active Exams', value: stats.activeExams, color: stats.activeExams > 0 ? 'text-red-400' : 'text-gray-400' },
  ] : [];

  const services = health ? [
    { name: 'Neo4j', ...health.neo4j },
    { name: 'Redis', ...health.redis },
    { name: 'Cassandra', ...health.cassandra },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard Overview</h2>
        <button onClick={fetchData} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {statCards.map((s) => (
            <div key={s.label} className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Service Health */}
      {health && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Service Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {services.map((s) => (
              <div
                key={s.name}
                className={`p-4 rounded-lg border ${
                  s.status === 'ok' ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{s.info || s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Health Panel ──────────────────────────────────────────────────────────────

function HealthPanel() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<HealthStatus>('/admin/health');
      setHealth(res.data);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  if (loading) return <Spinner />;

  if (!health) return <p className="text-red-400">Failed to fetch health status.</p>;

  const services = [
    { name: 'Neo4j', ...health.neo4j },
    { name: 'Redis', ...health.redis },
    { name: 'Cassandra', ...health.cassandra },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System Health</h2>
        <button onClick={fetchHealth} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {services.map((s) => (
          <div
            key={s.name}
            className={`p-5 rounded-lg border ${
              s.status === 'ok' ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${s.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="font-medium">{s.name}</span>
            </div>
            <p className="text-sm text-gray-400">{s.info || s.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Active Exams Panel ────────────────────────────────────────────────────────

function ActiveExamsPanel() {
  const [exams, setExams] = useState<ActiveExam[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ActiveExam[]>('/admin/active-exams');
      setExams(res.data);
    } catch {
      setExams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActive(); }, [fetchActive]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchActive, 10000);
    return () => clearInterval(interval);
  }, [fetchActive]);

  if (loading) return <Spinner />;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Active Exams Monitor</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Auto-refreshes every 10s</span>
          <button onClick={fetchActive} className="text-sm text-gray-400 hover:text-white transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {exams.length === 0 ? (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400">No active or paused exams right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map((exam) => (
            <div key={exam.id} className="bg-gray-800 border border-gray-700 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{exam.name}</h3>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  exam.status === 'active' ? 'bg-green-900/40 text-green-400' :
                  exam.status === 'paused' ? 'bg-yellow-900/40 text-yellow-400' :
                  'bg-gray-700 text-gray-400'
                }`}>
                  {exam.status.toUpperCase()}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span>Subject</span>
                  <span className="text-white">{exam.subjectName}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Duration</span>
                  <span className="text-white">{exam.durationMinutes} min</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Remaining</span>
                  <span className="text-white">{formatTime(exam.remainingSeconds)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Students Online</span>
                  <span className="text-white font-medium">{exam.studentsOnline}</span>
                </div>
                {exam.startedAt && (
                  <div className="flex justify-between text-gray-400">
                    <span>Started At</span>
                    <span className="text-white">{new Date(exam.startedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Security Events Panel ─────────────────────────────────────────────────────

function SecurityEventsPanel() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SecurityEvent[]>('/admin/security-events');
      setEvents(res.data);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  if (loading) return <Spinner />;

  const eventColor = (type: string) => {
    switch (type) {
      case 'TAB_SWITCH': return 'bg-yellow-900/40 text-yellow-400';
      case 'COPY_PASTE': return 'bg-red-900/40 text-red-400';
      case 'BLUR': return 'bg-orange-900/40 text-orange-400';
      case 'FOCUS': return 'bg-green-900/40 text-green-400';
      case 'SUSPICIOUS_ACTIVITY': return 'bg-red-900/40 text-red-400';
      default: return 'bg-gray-700 text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Security Events</h2>
        <button onClick={fetchEvents} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>

      {events.length === 0 ? (
        <p className="text-gray-400">No security events recorded.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {['TAB_SWITCH', 'COPY_PASTE', 'BLUR', 'FOCUS', 'SUSPICIOUS_ACTIVITY'].map((type) => {
              const count = events.filter(e => e.eventType === type).length;
              return (
                <div key={type} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold">{count}</p>
                  <p className="text-xs text-gray-400 mt-1">{type.replace('_', ' ')}</p>
                </div>
              );
            })}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-gray-400">
                  <th className="pb-3 pr-4">Timestamp</th>
                  <th className="pb-3 pr-4">Event</th>
                  <th className="pb-3 pr-4">Exam ID</th>
                  <th className="pb-3 pr-4">Student ID</th>
                  <th className="pb-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-3 pr-4 whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${eventColor(e.eventType)}`}>
                        {e.eventType}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-400">{e.examId.slice(0, 8)}...</td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-400">{e.studentId.slice(0, 8)}...</td>
                    <td className="py-3 text-gray-400 text-xs font-mono max-w-xs truncate">
                      {JSON.stringify(e.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Users Panel ───────────────────────────────────────────────────────────────

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const res = await api.get<AdminUser[]>('/admin/users', { params: q ? { search: q } : {} });
      setUsers(res.data);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(search);
  };

  const changeRole = async (id: string, role: string) => {
    const newRole = role === 'STUDENT' ? 'PROFESSOR' : 'STUDENT';
    try {
      await api.patch(`/admin/users/${id}/role`, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
    } catch {
      alert('Failed to change role');
    }
  };

  const toggleDisable = async (id: string, current: boolean) => {
    try {
      await api.patch(`/admin/users/${id}/disable`, { disabled: !current });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, disabled: !current } : u)));
    } catch {
      alert('Failed to update user');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Users</h2>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email..."
          className="flex-1 px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); fetchUsers(); }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <p className="text-gray-400">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Email</th>
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Verified</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4">{u.email}</td>
                  <td className="py-3 pr-4">{u.firstName} {u.lastName}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      u.role === 'PROFESSOR' ? 'bg-blue-900/40 text-blue-400' : 'bg-green-900/40 text-green-400'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={u.isVerified ? 'text-green-400' : 'text-yellow-400'}>
                      {u.isVerified ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={u.disabled ? 'text-red-400' : 'text-green-400'}>
                      {u.disabled ? 'Disabled' : 'Active'}
                    </span>
                  </td>
                  <td className="py-3 space-x-2">
                    <button
                      onClick={() => changeRole(u.id, u.role)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                    >
                      Switch to {u.role === 'STUDENT' ? 'PROFESSOR' : 'STUDENT'}
                    </button>
                    <button
                      onClick={() => toggleDisable(u.id, u.disabled)}
                      className={`px-3 py-1 rounded text-xs transition-colors ${
                        u.disabled
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Exams Panel ───────────────────────────────────────────────────────────────

function ExamsPanel() {
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<AdminExam[]>('/admin/exams');
      setExams(res.data);
    } catch {
      setExams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExams(); }, [fetchExams]);

  const deleteExam = async (examId: string) => {
    if (!confirm('Delete this exam? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/exams/${examId}`);
      setExams((prev) => prev.filter((e) => e.id !== examId));
    } catch {
      alert('Failed to delete exam');
    }
  };

  const resetState = async (examId: string) => {
    if (!confirm('Reset Redis state for this exam?')) return;
    try {
      await api.post(`/admin/exams/${examId}/reset-state`);
      alert('Exam state reset');
    } catch {
      alert('Failed to reset exam state');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Exams</h2>
        <button onClick={fetchExams} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>

      {exams.length === 0 ? (
        <p className="text-gray-400">No exams found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Exam</th>
                <th className="pb-3 pr-4">Subject</th>
                <th className="pb-3 pr-4">Start Time</th>
                <th className="pb-3 pr-4">Duration</th>
                <th className="pb-3 pr-4">Tasks</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4">{exam.name}</td>
                  <td className="py-3 pr-4">{exam.subjectName}</td>
                  <td className="py-3 pr-4">{new Date(exam.startTime).toLocaleString()}</td>
                  <td className="py-3 pr-4">{exam.durationMinutes} min</td>
                  <td className="py-3 pr-4">{exam.taskCount}</td>
                  <td className="py-3 space-x-2">
                    <button
                      onClick={() => resetState(exam.id)}
                      className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-xs transition-colors"
                    >
                      Reset State
                    </button>
                    <button
                      onClick={() => deleteExam(exam.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Subjects Panel ────────────────────────────────────────────────────────────

function SubjectsPanel() {
  const [subjects, setSubjects] = useState<AdminSubject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<AdminSubject[]>('/admin/subjects');
      setSubjects(res.data);
    } catch {
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSubjects(); }, [fetchSubjects]);

  const deleteSubject = async (subjectId: string) => {
    if (!confirm('Delete this subject and all its exams? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/subjects/${subjectId}`);
      setSubjects((prev) => prev.filter((s) => s.id !== subjectId));
    } catch {
      alert('Failed to delete subject');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Subjects</h2>
        <button onClick={fetchSubjects} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>

      {subjects.length === 0 ? (
        <p className="text-gray-400">No subjects found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Description</th>
                <th className="pb-3 pr-4">Professor</th>
                <th className="pb-3 pr-4">Exams</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4 font-medium">{s.name}</td>
                  <td className="py-3 pr-4 text-gray-400 max-w-xs truncate">{s.description}</td>
                  <td className="py-3 pr-4">{s.professorEmail || '-'}</td>
                  <td className="py-3 pr-4">{s.examCount}</td>
                  <td className="py-3">
                    <button
                      onClick={() => deleteSubject(s.id)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Activity Panel ────────────────────────────────────────────────────────────

function ActivityPanel() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ActivityEntry[]>('/admin/activity');
      setActivity(res.data);
    } catch {
      setActivity([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent User Activity</h2>
        <button onClick={fetchActivity} className="text-sm text-gray-400 hover:text-white transition-colors">
          Refresh
        </button>
      </div>

      {activity.length === 0 ? (
        <p className="text-gray-400">No recent activity.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Timestamp</th>
                <th className="pb-3 pr-4">User ID</th>
                <th className="pb-3 pr-4">Event</th>
                <th className="pb-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a, i) => (
                <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-400">{a.userId.slice(0, 8)}...</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      a.eventType === 'LOGIN' ? 'bg-blue-900/40 text-blue-400' :
                      a.eventType === 'REGISTER' ? 'bg-green-900/40 text-green-400' :
                      'bg-yellow-900/40 text-yellow-400'
                    }`}>
                      {a.eventType}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400 text-xs font-mono">
                    {JSON.stringify(a.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Shared ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500" />
    </div>
  );
}
