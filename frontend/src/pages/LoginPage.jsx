import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Activity, ShieldCheck, UserCheck, AlertCircle, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('candidate_001');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please verify credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickFill = (u, p) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-600 items-center justify-center text-white shadow-lg shadow-indigo-100 dark:shadow-none mb-4">
            <Activity className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Sign In to ExamPulse</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">High-Load Distributed Online Assessment Platform</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 transition-colors">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-start space-x-3 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm transition-colors"
                placeholder="e.g. candidate_001 or admin"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 inline-flex items-center justify-center py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              {submitting ? 'Authenticating...' : 'Sign In'}
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </button>
          </form>

          {/* Quick-fill demo presets */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 text-center">
              Quick Demo Fill
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickFill('candidate_001', 'password123')}
                className="p-2 text-xs font-medium rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition text-center"
              >
                Candidate 1
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('candidate_002', 'password123')}
                className="p-2 text-xs font-medium rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition text-center"
              >
                Candidate 2
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill('admin', 'admin123')}
                className="p-2 text-xs font-medium rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition text-center"
              >
                Admin
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

