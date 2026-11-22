import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  ClipboardList,
  FileClock,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { IconButton } from '../ui';

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, roles: ['admin', 'invigilator'] },
  { to: '/admin/exams', label: 'Exams', icon: ClipboardList, roles: ['admin', 'invigilator'] },
  { to: '/admin/candidates', label: 'Candidates', icon: Users, roles: ['admin', 'invigilator'] },
  { to: '/admin/batches', label: 'Batches', icon: Layers, roles: ['admin', 'invigilator'] },
  { to: '/admin/staff', label: 'Staff', icon: ShieldCheck, roles: ['admin'] },
  { to: '/admin/audit', label: 'Audit Log', icon: FileClock, roles: ['admin'] },
];

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <aside className="hidden md:flex md:w-56 md:flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <Link to="/admin" className="font-semibold tracking-tight text-sm">
            ExamPulse
          </Link>
        </div>

        <nav className="flex-1 px-2.5 py-3 space-y-0.5">
          {NAV_ITEMS.filter((item) => item.roles.includes(user?.role)).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200 dark:border-zinc-800 p-3">
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{user?.full_name}</div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 capitalize">
            {user?.role} &middot; @{user?.username}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 sm:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Activity className="h-4 w-4 text-indigo-600" />
            <span className="font-semibold text-sm">ExamPulse</span>
          </div>
          <div className="hidden md:block text-xs text-zinc-500 dark:text-zinc-400">
            Assessment Operations Console
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Toggle theme" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </IconButton>
            <IconButton label="Change password" onClick={() => navigate('/change-password')}>
              <KeyRound className="h-4 w-4" />
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
    </div>
  );
}
