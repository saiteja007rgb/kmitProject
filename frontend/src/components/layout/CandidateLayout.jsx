import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Activity, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, IconButton } from '../ui';

export function CandidateLayout() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <Link to="/candidate" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight text-sm">ExamPulse</span>
          </Link>

          <div className="flex items-center gap-2">
            {user?.candidate?.candidate_code && (
              <Badge tone="neutral">{user.candidate.candidate_code}</Badge>
            )}
            <span className="hidden sm:inline text-xs text-zinc-600 dark:text-zinc-400">
              {user?.full_name}
            </span>
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
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
