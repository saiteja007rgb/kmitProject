import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, Award, ClipboardList, LogOut, Moon, Shield, Sun } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col bg-[#FAFAFB] dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100">
      <header className="h-14 border-b border-zinc-200/90 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link to="/candidate" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <Activity className="h-4 w-4" />
              </div>
              <span className="font-semibold tracking-tight text-sm">ExamPulse</span>
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              <NavLink
                to="/candidate"
                end
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`
                }
              >
                <ClipboardList className="h-3.5 w-3.5" /> My exams
              </NavLink>
              <NavLink
                to="/candidate/transcript"
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`
                }
              >
                <Award className="h-3.5 w-3.5" /> Transcript
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            {user?.candidate?.candidate_code && (
              <Badge tone="neutral">{user.candidate.candidate_code}</Badge>
            )}
            <span className="hidden md:inline text-xs font-medium text-zinc-600 dark:text-zinc-300 mr-1">
              {user?.full_name}
            </span>
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
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
