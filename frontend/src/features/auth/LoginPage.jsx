import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  KeyRound,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { authApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { extractApiError } from '../../lib/format';
import { Button, IconButton, Input } from '../../components/ui';

function passwordStrengthScore(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

const CAPABILITIES = [
  {
    icon: ShieldCheck,
    title: 'Zero-trust authentication',
    description: 'TOTP two-factor auth, rotating httpOnly refresh tokens with theft detection, and single-device exam locking.',
  },
  {
    icon: Code2,
    title: 'Isolated 5-language compiler',
    description: 'Python, C, C++, Java, and JavaScript executed in network-isolated Linux namespaces with strict resource caps.',
  },
  {
    icon: Camera,
    title: 'In-browser AI proctoring',
    description: 'Local BlazeFace detection monitors presence, multiple faces, and gaze with encrypted invigilator snapshots.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Institutional marks & analytics',
    description: 'Multi-sheet Excel registers, question-by-question breakdown, statistical collusion scans, and student feedback.',
  },
];

export function LoginPage() {
  const { user, signIn, sessionNotice, clearSessionNotice } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Modes: signin | register | verify | forgot | reset
  const [mode, setMode] = useState('signin');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sign-in + 2FA state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  // Registration state
  const [regForm, setRegForm] = useState({
    username: '',
    full_name: '',
    email: '',
    candidate_code: '',
    password: '',
  });
  const [otpUsername, setOtpUsername] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState('');
  const [newPassword, setNewPassword] = useState('');

  if (user) {
    if (user.must_change_password) return <Navigate to="/change-password" replace />;
    return <Navigate to={user.role === 'candidate' ? '/candidate' : '/admin'} replace />;
  }

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setErrorMessage('');
    setInfoMessage('');
    setNeedsTotp(false);
    setTotpCode('');
    setDevOtpHint('');
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    clearSessionNotice();
    setSubmitting(true);
    try {
      const signedInUser = await signIn(username.trim(), password, needsTotp ? totpCode.trim() : null);
      if (signedInUser.must_change_password) {
        navigate('/change-password', { replace: true });
      } else {
        navigate(signedInUser.role === 'candidate' ? '/candidate' : '/admin', { replace: true });
      }
    } catch (error) {
      const headers = error?.response?.headers || {};
      if (error?.response?.status === 403 && headers['x-require-totp'] === 'true') {
        setNeedsTotp(true);
        setInfoMessage('Enter the 6-digit code from your authenticator app or a backup recovery code.');
      } else if (error?.response?.status === 403 && headers['x-require-verification'] === 'true') {
        setOtpUsername(username.trim());
        setMode('verify');
        setErrorMessage('Your email address is not verified yet. Enter your 6-digit verification code.');
      } else {
        setErrorMessage(extractApiError(error, 'Sign in failed.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);
    try {
      const res = await authApi.register({
        username: regForm.username.trim(),
        full_name: regForm.full_name.trim(),
        email: regForm.email.trim(),
        candidate_code: regForm.candidate_code.trim() || null,
        password: regForm.password,
      });
      setOtpUsername(res.username);
      setOtpCode('');
      setDevOtpHint(res.dev_verification_code || '');
      setInfoMessage(res.message);
      setMode('verify');
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Registration failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEmail = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);
    try {
      await authApi.verifyEmail(otpUsername, otpCode.trim());
      setUsername(otpUsername);
      setMode('signin');
      setDevOtpHint('');
      setInfoMessage('Email verified. You can now sign in to your account.');
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Verification failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(otpUsername.trim());
      setDevOtpHint(res.dev_reset_code || '');
      setInfoMessage(res.message);
      setMode('reset');
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Could not start recovery.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);
    try {
      await authApi.resetPassword(otpUsername.trim(), otpCode.trim(), newPassword);
      setUsername(otpUsername.trim());
      setMode('signin');
      setDevOtpHint('');
      setNewPassword('');
      setOtpCode('');
      setInfoMessage('Password reset complete. Sign in with your new password.');
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Password reset failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const regStrength = passwordStrengthScore(regForm.password);
  const strengthLabels = ['Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  const strengthColors = ['bg-red-500', 'bg-amber-500', 'bg-amber-400', 'bg-emerald-500', 'bg-emerald-600'];

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.08fr_1fr] bg-[#FAFAFB] dark:bg-[#09090B]">
      {/* Left editorial architecture showcase */}
      <div className="hidden lg:flex flex-col justify-between bg-[#0D0E12] text-zinc-100 p-10 xl:p-14 border-r border-zinc-800/80 auth-grid-bg">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-white">ExamPulse</div>
            <div className="text-xs text-zinc-400">Distributed Assessment Infrastructure</div>
          </div>
        </div>

        <div className="max-w-lg space-y-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-medium text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Stateless multi-instance engine &middot; Server-authoritative timing
            </div>
            <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight text-white leading-[1.15]">
              High-integrity online examinations built for real classrooms.
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Manage cohorts, run sandboxed coding tests, proctor live with computer vision, and export institutional
              marks registers in seconds.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {CAPABILITIES.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-lg border border-zinc-800/90 bg-zinc-900/60 p-4 space-y-1.5"
                >
                  <Icon className="h-4 w-4 text-indigo-400" />
                  <div className="text-xs font-semibold text-zinc-100">{item.title}</div>
                  <p className="text-xs text-zinc-400 leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-800/80 pt-5">
          <span>ExamPulse v2.1</span>
          <span className="font-mono">JWT + TOTP 2FA &middot; bwrap &middot; BlazeFace</span>
        </div>
      </div>

      {/* Right authentication workspace */}
      <div className="relative flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="absolute top-5 right-5">
          <IconButton label="Toggle theme" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
        </div>

        <div className="w-full max-w-md mx-auto">
          <div className="flex items-center gap-2.5 mb-7 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Activity className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold tracking-tight">ExamPulse</span>
          </div>

          {/* Mode tabs when on primary views */}
          {(mode === 'signin' || mode === 'register') && (
            <div className="mb-6 grid grid-cols-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 p-1">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'signin'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Student signup
              </button>
            </div>
          )}

          {(sessionNotice || errorMessage) && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage || sessionNotice}</span>
            </div>
          )}

          {infoMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}

          {devOtpHint && (
            <div className="mb-4 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/40 px-3.5 py-2.5 text-xs text-indigo-900 dark:text-indigo-200">
              Local dev OTP (configure SMTP in <code className="font-mono">.env</code> for email delivery):{' '}
              <strong className="font-mono text-sm tracking-widest">{devOtpHint}</strong>
            </div>
          )}

          {/* SIGN IN FORM */}
          {mode === 'signin' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {needsTotp ? 'Two-factor verification' : 'Sign in to ExamPulse'}
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {needsTotp
                    ? 'Enter the 6-digit code from your authenticator app or an 8-character backup code.'
                    : 'Enter your institutional username and password.'}
                </p>
              </div>

              <form onSubmit={handleSignIn} className="space-y-4">
                {!needsTotp ? (
                  <>
                    <Input
                      label="Username"
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="e.g. admin or student1"
                      required
                      autoFocus
                    />
                    <div className="space-y-1">
                      <Input
                        label="Password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Enter your password"
                        required
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setOtpUsername(username);
                            switchMode('forgot');
                          }}
                          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Forgot password?
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <Input
                    label="Authenticator or backup code"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value)}
                    placeholder="123456 or ABCD-1234"
                    className="font-mono tracking-widest text-center text-base"
                    autoFocus
                    required
                  />
                )}

                <Button type="submit" loading={submitting} size="lg" className="w-full">
                  <Lock className="h-4 w-4" />
                  {needsTotp ? 'Verify & sign in' : 'Sign in'}
                </Button>

                {needsTotp && (
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setNeedsTotp(false);
                      setTotpCode('');
                      setErrorMessage('');
                      setInfoMessage('');
                    }}
                  >
                    Use a different account
                  </Button>
                )}
              </form>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3.5 text-xs space-y-1.5">
                <div className="font-semibold text-zinc-700 dark:text-zinc-300">Default local accounts</div>
                <div className="grid grid-cols-2 gap-1.5 text-zinc-500 font-mono text-[11px]">
                  <span>admin / admin123</span>
                  <span>invigilator / invigilator123</span>
                  <span className="col-span-2">student1 .. student3 / password123</span>
                </div>
              </div>
            </div>
          )}

          {/* REGISTRATION FORM */}
          {mode === 'register' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Create student account</h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Register with your college email. A 6-digit verification code activates your account.
                </p>
              </div>
              <form onSubmit={handleRegister} className="space-y-3.5">
                <Input
                  label="Full name"
                  value={regForm.full_name}
                  onChange={(event) => setRegForm((p) => ({ ...p, full_name: event.target.value }))}
                  placeholder="e.g. Ananya Rao"
                  required
                />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    label="Username"
                    value={regForm.username}
                    onChange={(event) => setRegForm((p) => ({ ...p, username: event.target.value }))}
                    placeholder="e.g. ananya.rao"
                    required
                  />
                  <Input
                    label="Roll / ID code (optional)"
                    value={regForm.candidate_code}
                    onChange={(event) => setRegForm((p) => ({ ...p, candidate_code: event.target.value }))}
                    placeholder="e.g. KMIT-204"
                  />
                </div>
                <Input
                  label="Institutional email"
                  type="email"
                  value={regForm.email}
                  onChange={(event) => setRegForm((p) => ({ ...p, email: event.target.value }))}
                  placeholder="student@college.edu"
                  required
                />
                <div className="space-y-1.5">
                  <Input
                    label="Password"
                    type="password"
                    value={regForm.password}
                    onChange={(event) => setRegForm((p) => ({ ...p, password: event.target.value }))}
                    placeholder="At least 8 chars with letter + digit"
                    required
                  />
                  {regForm.password && (
                    <div className="space-y-1">
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 1, 2, 3].map((segment) => (
                          <div
                            key={segment}
                            className={`h-1 rounded-full ${
                              segment < regStrength ? strengthColors[regStrength] : 'bg-zinc-200 dark:bg-zinc-800'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="text-[11px] text-zinc-500">Strength: {strengthLabels[regStrength]}</div>
                    </div>
                  )}
                </div>
                <Button type="submit" loading={submitting} size="lg" className="w-full">
                  Create account &amp; send code
                </Button>
              </form>
            </div>
          )}

          {/* EMAIL OTP VERIFICATION */}
          {mode === 'verify' && (
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Verify your email</h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Enter the 6-digit verification code issued for <strong>@{otpUsername}</strong>.
                </p>
              </div>
              <form onSubmit={handleVerifyEmail} className="space-y-4">
                <Input
                  label="6-digit verification code"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="font-mono tracking-[0.35em] text-center text-lg"
                  required
                  autoFocus
                />
                <Button type="submit" loading={submitting} size="lg" className="w-full">
                  Verify account
                </Button>
              </form>
            </div>
          )}

          {/* FORGOT PASSWORD */}
          {mode === 'forgot' && (
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Reset your password</h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Enter your username to receive a single-use 6-digit recovery code.
                </p>
              </div>
              <form onSubmit={handleForgot} className="space-y-4">
                <Input
                  label="Username"
                  value={otpUsername}
                  onChange={(event) => setOtpUsername(event.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" loading={submitting} size="lg" className="w-full">
                  <KeyRound className="h-4 w-4" /> Send recovery code
                </Button>
              </form>
            </div>
          )}

          {/* RESET PASSWORD WITH OTP */}
          {mode === 'reset' && (
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Set a new password</h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  All other signed-in devices will be logged out automatically.
                </p>
              </div>
              <form onSubmit={handleReset} className="space-y-4">
                <Input
                  label="6-digit recovery code"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  maxLength={6}
                  className="font-mono tracking-[0.35em] text-center"
                  required
                />
                <Input
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="At least 8 chars with letter + digit"
                  required
                />
                <Button type="submit" loading={submitting} size="lg" className="w-full">
                  Reset password
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
