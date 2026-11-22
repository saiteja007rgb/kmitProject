import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ShieldAlert } from 'lucide-react';
import { authApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError } from '../../lib/format';
import { Button, Card, Input } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function ChangePasswordPage() {
  const { user, refreshProfile, signOut } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const checks = [
    { label: 'At least 8 characters', passed: newPassword.length >= 8 },
    { label: 'Contains a letter and a digit', passed: /[a-zA-Z]/.test(newPassword) && /\d/.test(newPassword) },
    {
      label: 'Different from your username',
      passed: Boolean(newPassword) && newPassword.toLowerCase() !== (user?.username || '').toLowerCase(),
    },
    { label: 'Confirmation matches', passed: Boolean(confirmPassword) && newPassword === confirmPassword },
  ];
  const allChecksPass = checks.every((item) => item.passed);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!allChecksPass) return;
    setErrorMessage('');
    setSaving(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      const updatedUser = await refreshProfile();
      notify('Password updated.', 'success');
      navigate(updatedUser.role === 'candidate' ? '/candidate' : '/admin', { replace: true });
    } catch (error) {
      setErrorMessage(extractApiError(error, 'Could not change password.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Change password</h1>
        {user?.must_change_password && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>You signed in with a temporary password. Set a personal password to continue.</span>
          </div>
        )}

        {errorMessage && (
          <div className="mt-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Input
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />

          <ul className="space-y-1.5 text-xs">
            {checks.map((check) => (
              <li
                key={check.label}
                className={`flex items-center gap-2 ${
                  check.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Check className={`h-3.5 w-3.5 ${check.passed ? 'opacity-100' : 'opacity-30'}`} />
                <span>{check.label}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between pt-2">
            {user?.must_change_password ? (
              <Button variant="ghost" onClick={() => signOut()}>
                Sign out
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!allChecksPass} loading={saving}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

