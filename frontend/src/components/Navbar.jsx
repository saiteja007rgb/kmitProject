import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Activity, LogOut, User, ShieldCheck, Sun, Moon } from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { toggleTheme, isDark } = useTheme();

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 dark:shadow-none">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">ExamPulse</span>
            <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              Distributed Assessment
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-amber-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 transition-colors"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-indigo-600" />
            )}
          </button>

          {user && (
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 py-1.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700">
                {user.role === 'candidate' ? (
                  <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                )}
                <span className="font-medium text-slate-800 dark:text-slate-200">{user.display_name || user.username}</span>
                <span className="text-xs uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {user.role}
                </span>
              </div>

              <button
                onClick={logout}
                className="inline-flex items-center space-x-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

