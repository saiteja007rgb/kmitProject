import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Activity, AlertCircle, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { extractApiError } from '../../lib/format';
import { Button, Card, IconButton, Input } from '../../components/ui';

export function LoginPage() {
  const { user, signIn, sessionNotice, clearSessionNotice } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    if (user.must_change_password) return <Navigate to="/change-password" replace />;
    return <Navigate to={user.role === 'candidate' ? '/candidate' : '/admin'} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    clearSessionNotice();
    setSubmitting(true);
    try {
      const signedInUser = await signIn(username.trim(), password);
      if (signedInUser.must_change_password) {
        navigate('/change-password', { replace: true });
      } else {
        navigate(signedInUser.role === 'candidate' ? '/candidate' : '/admin', { replace: true });
      }
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Sign in failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="fixed top-4 right-4">
        <IconButton label="Toggle theme" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </IconButton>
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">ExamPulse</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Online Assessment Platform</p>
          </div>
        </div>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sign in to your account</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Accounts are provisioned by your institution administrator.
          </p>

          {(sessionNotice || errorMessage) && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3 py-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage || sessionNotice}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <Input
              label="Username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. admin or student1"
              required
              autoFocus
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
            <Button type="submit" loading={submitting} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
