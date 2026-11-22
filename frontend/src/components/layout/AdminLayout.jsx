import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  BookMarked,
  ClipboardList,
  Command,
  FileClock,
  FileSpreadsheet,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Shield,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import { adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, IconButton, Modal } from '../ui';

const NAV_GROUPS = [
  {
    label: 'Assessments',
    items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, roles: ['admin', 'invigilator'] },
      { to: '/admin/exams', label: 'Exams', icon: ClipboardList, roles: ['admin', 'invigilator'] },
      { to: '/admin/question-bank', label: 'Question Bank', icon: BookMarked, roles: ['admin', 'invigilator'] },
      { to: '/admin/reports', label: 'Marks & Export', icon: FileSpreadsheet, roles: ['admin', 'invigilator'] },
      { to: '/admin/feedback', label: 'Feedback', icon: MessageSquare, roles: ['admin', 'invigilator'] },
    ],
  },
  {
    label: 'People & System',
    items: [
      { to: '/admin/candidates', label: 'Candidates', icon: Users, roles: ['admin', 'invigilator'] },
      { to: '/admin/batches', label: 'Batches', icon: Layers, roles: ['admin', 'invigilator'] },
      { to: '/admin/staff', label: 'Staff', icon: ShieldCheck, roles: ['admin'] },
      { to: '/admin/audit', label: 'Audit Log', icon: FileClock, roles: ['admin'] },
    ],
  },
];

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [systemStatus, setSystemStatus] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  useEffect(() => {
    adminPeopleApi.getSystemStatus().then(setSystemStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandQuery('');
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const allNavItems = NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => item.roles.includes(user?.role))
  );

  const quickActions = [
    ...allNavItems.map((item) => ({ label: `Go to ${item.label}`, path: item.to })),
    ...(user?.role === 'admin' ? [{ label: 'Create new examination', path: '/admin/exams/new' }] : []),
    { label: 'Account security & 2FA', path: '/account/security' },
  ].filter((action) => action.label.toLowerCase().includes(commandQuery.trim().toLowerCase()));

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-[#FAFAFB] dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100">
      <aside className="hidden md:flex md:w-60 md:flex-col border-r border-zinc-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900/90">
        <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-200/90 dark:border-zinc-800">
          <Link to="/admin" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight text-sm">ExamPulse</span>
          </Link>
          <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
            v2.1
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter((item) => item.roles.includes(user?.role));
            if (visible.length === 0) return null;
            return (
              <div key={group.label} className="space-y-1">
                <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {group.label}
                </div>
                {visible.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                          isActive
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* System telemetry footer */}
        {systemStatus && (
          <div className="mx-3 mb-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-2.5 text-[11px] space-y-1">
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300 font-medium">
              <span>Infrastructure</span>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            <div className="text-zinc-500 flex justify-between">
              <span>DB: {systemStatus.database_engine}</span>
              <span>{systemStatus.sandbox_available ? 'bwrap ✓' : 'no sandbox'}</span>
            </div>
            <div className="text-zinc-500 truncate">{systemStatus.redis_mode}</div>
          </div>
        )}

        <div className="border-t border-zinc-200/90 dark:border-zinc-800 p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{user?.full_name}</div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 capitalize">
              {user?.role} {user?.totp_enabled ? '· 2FA' : ''}
            </div>
          </div>
          <IconButton label="Account security & 2FA" onClick={() => navigate('/account/security')}>
            <Shield className="h-4 w-4" />
          </IconButton>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between gap-4 border-b border-zinc-200/90 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm px-4 sm:px-6 sticky top-0 z-20">
          <button
            type="button"
            onClick={() => {
              setCommandQuery('');
              setCommandOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quick jump…</span>
            <kbd className="inline-flex items-center gap-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-mono">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>

          <div className="flex items-center gap-1.5">
            {systemStatus?.counts?.open_regrades > 0 && (
              <Badge tone="warning">{systemStatus.counts.open_regrades} open appeal(s)</Badge>
            )}
            <IconButton label="Toggle theme" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </IconButton>
            <IconButton label="Account security & 2FA" onClick={() => navigate('/account/security')}>
              <Shield className="h-4 w-4" />
            </IconButton>
            <IconButton label="Sign out" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Ctrl+K Quick Command Palette */}
      <Modal
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        title="Quick navigation"
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={commandQuery}
            onChange={(event) => setCommandQuery(event.target.value)}
            placeholder="Type a page or action…"
            className="w-full h-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm"
          />
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-64 overflow-y-auto">
            {quickActions.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => {
                  setCommandOpen(false);
                  navigate(action.path);
                }}
                className="w-full text-left px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-md"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
