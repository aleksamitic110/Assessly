import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

type Tab = 'overview' | 'users' | 'exams' | 'subjects' | 'active' | 'security' | 'activity';

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

interface AdminTask {
  id: string;
  title: string;
  description: string;
  starterCode: string;
  testCases: string | null;
  exampleInput: string;
  exampleOutput: string;
  notes: string;
}

// ─── Shared ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <svg className="animate-spin h-10 w-10 text-red-500" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 bg-gray-700 border border-gray-600/80 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm';
const btnPrimary = 'px-4 py-2 bg-red-600 hover:bg-red-700 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-red-500/25';
const btnSecondary = 'px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-colors';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-800/95 backdrop-blur-sm border border-gray-700/60 rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl transition-colors">&times;</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

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
    { key: 'active', label: 'Active Exams' },
    { key: 'users', label: 'Users' },
    { key: 'exams', label: 'Exams' },
    { key: 'subjects', label: 'Subjects' },
    { key: 'security', label: 'Security Events' },
    { key: 'activity', label: 'Audit Log' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800/95 backdrop-blur-sm border-b border-gray-700/80 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold bg-gradient-to-r from-red-400 to-rose-400 bg-clip-text text-transparent">Assessly Admin</h1>
          <span className="text-sm text-gray-400">Logged in as {user?.email}</span>
        </div>
        <button onClick={handleLogout} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm transition-colors border border-gray-600/80">
          Logout
        </button>
      </header>

      <nav className="bg-gray-800/90 border-b border-gray-700/80 px-6 flex gap-1 overflow-x-auto sticky top-[57px] z-20">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key ? 'border-red-500 text-red-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-6 max-w-7xl mx-auto">
        {tab === 'overview' && <OverviewPanel />}
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
        <button onClick={fetchData} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
      </div>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {statCards.map((s) => (
            <div key={s.label} className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-4 text-center hover:border-gray-600 transition-colors">
              <p className={`text-3xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {health && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Service Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {services.map((s) => (
              <div key={s.name} className={`p-4 rounded-xl border ${s.status === 'ok' ? 'bg-green-900/20 border-green-700/60' : 'bg-red-900/20 border-red-700/60'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${s.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
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
        <button onClick={fetchActive} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
      </div>
      {exams.length === 0 ? (
        <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-8 text-center">
          <p className="text-gray-400">No active or paused exams right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map((exam) => (
            <div key={exam.id} className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-5 hover:border-gray-600 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{exam.name}</h3>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                  exam.status === 'active' ? 'bg-green-900/40 text-green-400' :
                  exam.status === 'paused' ? 'bg-yellow-900/40 text-yellow-400' :
                  'bg-gray-700 text-gray-400'
                }`}>{exam.status.toUpperCase()}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-400"><span>Subject</span><span className="text-white">{exam.subjectName}</span></div>
                <div className="flex justify-between text-gray-400"><span>Duration</span><span className="text-white">{exam.durationMinutes} min</span></div>
                <div className="flex justify-between text-gray-400"><span>Remaining</span><span className="text-white">{formatTime(exam.remainingSeconds)}</span></div>
                <div className="flex justify-between text-gray-400"><span>Students Online</span><span className="text-white font-medium">{exam.studentsOnline}</span></div>
                {exam.startedAt && (
                  <div className="flex justify-between text-gray-400"><span>Started At</span><span className="text-white">{new Date(exam.startedAt).toLocaleString()}</span></div>
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
        <button onClick={fetchEvents} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
      </div>
      {events.length === 0 ? (
        <p className="text-gray-400">No security events recorded.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {['TAB_SWITCH', 'COPY_PASTE', 'BLUR', 'FOCUS', 'SUSPICIOUS_ACTIVITY'].map((type) => {
              const count = events.filter(e => e.eventType === type).length;
              return (
                <div key={type} className="bg-gray-800/80 border border-gray-700/60 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold tabular-nums">{count}</p>
                  <p className="text-xs text-gray-400 mt-1">{type.replace('_', ' ')}</p>
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-gray-400">
                  <th className="pb-3 pr-4">Timestamp</th><th className="pb-3 pr-4">Event</th>
                  <th className="pb-3 pr-4">Exam ID</th><th className="pb-3 pr-4">Student ID</th><th className="pb-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-3 pr-4 whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="py-3 pr-4"><span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${eventColor(e.eventType)}`}>{e.eventType}</span></td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-400">{e.examId.slice(0, 8)}...</td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-400">{e.studentId.slice(0, 8)}...</td>
                    <td className="py-3 text-gray-400 text-xs font-mono max-w-xs truncate">{JSON.stringify(e.details)}</td>
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
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', role: 'STUDENT', isVerified: false });
  const [formError, setFormError] = useState('');

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

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); fetchUsers(search); };

  const changeRole = async (id: string, role: string) => {
    const newRole = role === 'STUDENT' ? 'PROFESSOR' : 'STUDENT';
    try {
      await api.patch(`/admin/users/${id}/role`, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
    } catch { alert('Failed to change role'); }
  };

  const toggleDisable = async (id: string, current: boolean) => {
    try {
      await api.patch(`/admin/users/${id}/disable`, { disabled: !current });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, disabled: !current } : u)));
    } catch { alert('Failed to update user'); }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Delete this user permanently?')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch { alert('Failed to delete user'); }
  };

  const openCreate = () => {
    setForm({ email: '', password: '', firstName: '', lastName: '', role: 'STUDENT', isVerified: false });
    setFormError('');
    setShowCreate(true);
  };

  const openEdit = (u: AdminUser) => {
    setForm({ email: u.email, password: '', firstName: u.firstName, lastName: u.lastName, role: u.role, isVerified: u.isVerified });
    setFormError('');
    setEditUser(u);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/admin/users', {
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role
      });
      setShowCreate(false);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setFormError('');
    try {
      const updates: Record<string, string | boolean> = {};
      if (form.email !== editUser.email) updates.email = form.email;
      if (form.firstName !== editUser.firstName) updates.firstName = form.firstName;
      if (form.lastName !== editUser.lastName) updates.lastName = form.lastName;
      if (form.role !== editUser.role) updates.role = form.role;
      if (form.isVerified !== editUser.isVerified) updates.isVerified = form.isVerified;
      await api.put(`/admin/users/${editUser.id}`, updates);
      setEditUser(null);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to update user');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Users</h2>
        <button onClick={openCreate} className={btnPrimary}>+ Create User</button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email..."
          className="flex-1 px-4 py-2 bg-gray-800/80 border border-gray-600/80 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <button type="submit" className={btnPrimary}>Search</button>
        {search && <button type="button" onClick={() => { setSearch(''); fetchUsers(); }} className={btnSecondary}>Clear</button>}
      </form>

      {loading ? <Spinner /> : users.length === 0 ? <p className="text-gray-400">No users found.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Email</th><th className="pb-3 pr-4">Name</th><th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Verified</th><th className="pb-3 pr-4">Status</th><th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4">{u.email}</td>
                  <td className="py-3 pr-4">{u.firstName} {u.lastName}</td>
                  <td className="py-3 pr-4">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${u.role === 'PROFESSOR' ? 'bg-blue-900/40 text-blue-400' : 'bg-green-900/40 text-green-400'}`}>{u.role}</span>
                  </td>
                  <td className="py-3 pr-4"><span className={u.isVerified ? 'text-green-400' : 'text-yellow-400'}>{u.isVerified ? 'Yes' : 'No'}</span></td>
                  <td className="py-3 pr-4"><span className={u.disabled ? 'text-red-400' : 'text-green-400'}>{u.disabled ? 'Disabled' : 'Active'}</span></td>
                  <td className="py-3 space-x-2">
                    <button onClick={() => openEdit(u)} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Edit</button>
                    <button onClick={() => changeRole(u.id, u.role)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs transition-colors">
                      Switch to {u.role === 'STUDENT' ? 'PROF' : 'STUD'}
                    </button>
                    <button onClick={() => toggleDisable(u.id, u.disabled)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${u.disabled ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => deleteUser(u.id)} className="px-3 py-1.5 bg-red-800 hover:bg-red-900 rounded-lg text-xs transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <Modal title="Create User" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            <input type="password" placeholder="Password (min 8)" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
            <input type="text" placeholder="First Name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Last Name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass}>
              <option value="STUDENT">STUDENT</option>
              <option value="PROFESSOR">PROFESSOR</option>
            </select>
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <Modal title="Edit User" onClose={() => setEditUser(null)}>
          <form onSubmit={handleUpdate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            <input type="text" placeholder="First Name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Last Name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass}>
              <option value="STUDENT">STUDENT</option>
              <option value="PROFESSOR">PROFESSOR</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.isVerified}
                onChange={(e) => setForm({ ...form, isVerified: e.target.checked })}
              />
              Verified
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Save</button>
              <button type="button" onClick={() => setEditUser(null)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Exams Panel ───────────────────────────────────────────────────────────────

function ExamsPanel() {
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [subjects, setSubjects] = useState<AdminSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editExam, setEditExam] = useState<AdminExam | null>(null);
  const [tasksExam, setTasksExam] = useState<AdminExam | null>(null);
  const [form, setForm] = useState({ subjectId: '', name: '', startTime: '', durationMinutes: '60' });
  const [formError, setFormError] = useState('');

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      const [examsRes, subjectsRes] = await Promise.all([
        api.get<AdminExam[]>('/admin/exams'),
        api.get<AdminSubject[]>('/admin/subjects'),
      ]);
      setExams(examsRes.data);
      setSubjects(subjectsRes.data);
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
    } catch { alert('Failed to delete exam'); }
  };

  const resetState = async (examId: string) => {
    if (!confirm('Reset Redis state for this exam?')) return;
    try {
      await api.post(`/admin/exams/${examId}/reset-state`);
      alert('Exam state reset');
    } catch { alert('Failed to reset exam state'); }
  };

  const openCreate = () => {
    setForm({ subjectId: subjects[0]?.id || '', name: '', startTime: '', durationMinutes: '60' });
    setFormError('');
    setShowCreate(true);
  };

  const openEdit = (exam: AdminExam) => {
    setForm({ subjectId: exam.subjectId, name: exam.name, startTime: exam.startTime.slice(0, 16), durationMinutes: String(exam.durationMinutes) });
    setFormError('');
    setEditExam(exam);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/admin/exams', {
        subjectId: form.subjectId,
        name: form.name,
        startTime: new Date(form.startTime).toISOString(),
        durationMinutes: Number(form.durationMinutes),
      });
      setShowCreate(false);
      fetchExams();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to create exam');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExam) return;
    setFormError('');
    try {
      await api.put(`/admin/exams/${editExam.id}`, {
        name: form.name,
        startTime: new Date(form.startTime).toISOString(),
        durationMinutes: Number(form.durationMinutes),
      });
      setEditExam(null);
      fetchExams();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to update exam');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Exams</h2>
        <div className="flex gap-2">
          <button onClick={openCreate} className={btnPrimary}>+ Create Exam</button>
          <button onClick={fetchExams} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
        </div>
      </div>

      {exams.length === 0 ? <p className="text-gray-400">No exams found.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Exam</th><th className="pb-3 pr-4">Subject</th><th className="pb-3 pr-4">Start Time</th>
                <th className="pb-3 pr-4">Duration</th><th className="pb-3 pr-4">Tasks</th><th className="pb-3">Actions</th>
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
                    <button onClick={() => openEdit(exam)} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Edit</button>
                    <button onClick={() => setTasksExam(exam)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-xs transition-colors">Tasks</button>
                    <button onClick={() => resetState(exam.id)} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-xs transition-colors">Reset</button>
                    <button onClick={() => deleteExam(exam.id)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="Create Exam" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <select required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} className={inputClass}>
              <option value="">Select subject...</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="text" placeholder="Exam Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            <input type="datetime-local" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputClass} />
            <input type="number" placeholder="Duration (min)" required min={1} max={600} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} className={inputClass} />
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editExam && (
        <Modal title="Edit Exam" onClose={() => setEditExam(null)}>
          <form onSubmit={handleUpdate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <input type="text" placeholder="Exam Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            <input type="datetime-local" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputClass} />
            <input type="number" placeholder="Duration (min)" required min={1} max={600} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} className={inputClass} />
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Save</button>
              <button type="button" onClick={() => setEditExam(null)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {tasksExam && <TasksModal exam={tasksExam} onClose={() => { setTasksExam(null); fetchExams(); }} />}
    </div>
  );
}

// ─── Tasks Modal ──────────────────────────────────────────────────────────────

function TasksModal({ exam, onClose }: { exam: AdminExam; onClose: () => void }) {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTask, setEditTask] = useState<AdminTask | null>(null);
  const [form, setForm] = useState({ title: '', description: '', starterCode: '', exampleInput: '', exampleOutput: '', notes: '' });
  const [formError, setFormError] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<AdminTask[]>(`/admin/tasks/${exam.id}`);
      setTasks(res.data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [exam.id]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.delete(`/admin/tasks/${taskId}`);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch { alert('Failed to delete task'); }
  };

  const openCreate = () => {
    setForm({ title: '', description: '', starterCode: '', exampleInput: '', exampleOutput: '', notes: '' });
    setFormError('');
    setShowCreate(true);
  };

  const openEdit = (t: AdminTask) => {
    setForm({ title: t.title, description: t.description || '', starterCode: t.starterCode || '', exampleInput: t.exampleInput || '', exampleOutput: t.exampleOutput || '', notes: t.notes || '' });
    setFormError('');
    setEditTask(t);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/admin/tasks', { examId: exam.id, ...form });
      setShowCreate(false);
      fetchTasks();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to create task');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTask) return;
    setFormError('');
    try {
      await api.put(`/admin/tasks/${editTask.id}`, form);
      setEditTask(null);
      fetchTasks();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to update task');
    }
  };

  return (
    <Modal title={`Tasks - ${exam.name}`} onClose={onClose}>
      {loading ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{tasks.length} task(s)</p>
            <button onClick={openCreate} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-medium transition-colors">+ Add Task</button>
          </div>

          {tasks.map((t) => (
            <div key={t.id} className="bg-gray-700/80 rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{t.title}</span>
                <div className="space-x-2">
                  <button onClick={() => openEdit(t)} className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Edit</button>
                  <button onClick={() => deleteTask(t.id)} className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded-lg text-xs transition-colors">Delete</button>
                </div>
              </div>
              {t.description && <p className="text-xs text-gray-400 truncate">{t.description}</p>}
            </div>
          ))}

          {showCreate && (
            <form onSubmit={handleCreate} className="bg-gray-750 border border-gray-600/80 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium">New Task</h4>
              {formError && <p className="text-red-400 text-xs">{formError}</p>}
              <input type="text" placeholder="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass + ' h-20'} />
              <textarea placeholder="Starter Code" value={form.starterCode} onChange={(e) => setForm({ ...form, starterCode: e.target.value })} className={inputClass + ' h-16 font-mono text-xs'} />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Example Input" value={form.exampleInput} onChange={(e) => setForm({ ...form, exampleInput: e.target.value })} className={inputClass} />
                <input type="text" placeholder="Example Output" value={form.exampleOutput} onChange={(e) => setForm({ ...form, exampleOutput: e.target.value })} className={inputClass} />
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass + ' h-16'} />
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-medium transition-colors">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Cancel</button>
              </div>
            </form>
          )}

          {editTask && (
            <form onSubmit={handleUpdate} className="bg-gray-750 border border-gray-600/80 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium">Edit Task</h4>
              {formError && <p className="text-red-400 text-xs">{formError}</p>}
              <input type="text" placeholder="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass + ' h-20'} />
              <textarea placeholder="Starter Code" value={form.starterCode} onChange={(e) => setForm({ ...form, starterCode: e.target.value })} className={inputClass + ' h-16 font-mono text-xs'} />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Example Input" value={form.exampleInput} onChange={(e) => setForm({ ...form, exampleInput: e.target.value })} className={inputClass} />
                <input type="text" placeholder="Example Output" value={form.exampleOutput} onChange={(e) => setForm({ ...form, exampleOutput: e.target.value })} className={inputClass} />
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass + ' h-16'} />
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-medium transition-colors">Save</button>
                <button type="button" onClick={() => setEditTask(null)} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Subjects Panel ────────────────────────────────────────────────────────────

function SubjectsPanel() {
  const [subjects, setSubjects] = useState<AdminSubject[]>([]);
  const [professors, setProfessors] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editSubject, setEditSubject] = useState<AdminSubject | null>(null);
  const [form, setForm] = useState({ name: '', description: '', password: '', professorId: '' });
  const [formError, setFormError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [subjectsRes, usersRes] = await Promise.all([
        api.get<AdminSubject[]>('/admin/subjects'),
        api.get<AdminUser[]>('/admin/users'),
      ]);
      setSubjects(subjectsRes.data);
      setProfessors(usersRes.data.filter((u) => u.role === 'PROFESSOR'));
    } catch {
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const deleteSubject = async (subjectId: string) => {
    if (!confirm('Delete this subject and all its exams? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/subjects/${subjectId}`);
      setSubjects((prev) => prev.filter((s) => s.id !== subjectId));
    } catch { alert('Failed to delete subject'); }
  };

  const openCreate = () => {
    setForm({ name: '', description: '', password: '', professorId: professors[0]?.id || '' });
    setFormError('');
    setShowCreate(true);
  };

  const openEdit = (s: AdminSubject) => {
    setForm({ name: s.name, description: s.description || '', password: '', professorId: '' });
    setFormError('');
    setEditSubject(s);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/admin/subjects', form);
      setShowCreate(false);
      fetchData();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to create subject');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSubject) return;
    setFormError('');
    try {
      const updates: Record<string, string> = {};
      if (form.name !== editSubject.name) updates.name = form.name;
      if (form.description !== (editSubject.description || '')) updates.description = form.description;
      if (form.password) updates.password = form.password;
      await api.put(`/admin/subjects/${editSubject.id}`, updates);
      setEditSubject(null);
      fetchData();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to update subject');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Subjects</h2>
        <div className="flex gap-2">
          <button onClick={openCreate} className={btnPrimary}>+ Create Subject</button>
          <button onClick={fetchData} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
        </div>
      </div>

      {subjects.length === 0 ? <p className="text-gray-400">No subjects found.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Name</th><th className="pb-3 pr-4">Description</th>
                <th className="pb-3 pr-4">Professor</th><th className="pb-3 pr-4">Exams</th><th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4 font-medium">{s.name}</td>
                  <td className="py-3 pr-4 text-gray-400 max-w-xs truncate">{s.description}</td>
                  <td className="py-3 pr-4">{s.professorEmail || '-'}</td>
                  <td className="py-3 pr-4">{s.examCount}</td>
                  <td className="py-3 space-x-2">
                    <button onClick={() => openEdit(s)} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">Edit</button>
                    <button onClick={() => deleteSubject(s.id)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="Create Subject" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <input type="text" placeholder="Subject Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass + ' h-20'} />
            <input type="password" placeholder="Enrollment Password (min 6)" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
            <select required value={form.professorId} onChange={(e) => setForm({ ...form, professorId: e.target.value })} className={inputClass}>
              <option value="">Select professor...</option>
              {professors.map((p) => <option key={p.id} value={p.id}>{p.email} ({p.firstName} {p.lastName})</option>)}
            </select>
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editSubject && (
        <Modal title="Edit Subject" onClose={() => setEditSubject(null)}>
          <form onSubmit={handleUpdate} className="space-y-3">
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <input type="text" placeholder="Subject Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass + ' h-20'} />
            <input type="password" placeholder="New Password (leave blank to keep)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
            <div className="flex gap-2 pt-2">
              <button type="submit" className={btnPrimary}>Save</button>
              <button type="button" onClick={() => setEditSubject(null)} className={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Modal>
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

  const eventColor = (type: string) => {
    if (type === 'LOGIN') return 'bg-blue-900/40 text-blue-400';
    if (type === 'REGISTER') return 'bg-green-900/40 text-green-400';
    if (type === 'PASSWORD_CHANGE') return 'bg-purple-900/40 text-purple-400';
    if (type.startsWith('ADMIN_')) return 'bg-red-900/40 text-red-400';
    return 'bg-yellow-900/40 text-yellow-400';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent Activity / Audit Log</h2>
        <button onClick={fetchActivity} className="text-sm text-gray-400 hover:text-white transition-colors">Refresh</button>
      </div>

      {activity.length === 0 ? <p className="text-gray-400">No recent activity.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-3 pr-4">Timestamp</th><th className="pb-3 pr-4">User</th><th className="pb-3 pr-4">Event</th><th className="pb-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a, i) => (
                <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 pr-4 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-400">
                    {a.userId === 'ADMIN' ? <span className="text-red-400 font-semibold">ADMIN</span> : `${a.userId.slice(0, 8)}...`}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${eventColor(a.eventType)}`}>{a.eventType}</span>
                  </td>
                  <td className="py-3 text-gray-400 text-xs font-mono max-w-md truncate">{JSON.stringify(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
