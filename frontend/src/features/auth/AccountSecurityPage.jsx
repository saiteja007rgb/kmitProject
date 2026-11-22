import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Download,
  KeyRound,
  Laptop,
  LogOut,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from 'lucide-react';
import { authApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { downloadTextFile, extractApiError, formatDateTime } from '../../lib/format';
import { Badge, Button, Card, Input, Modal, Skeleton } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

function summarizeUserAgent(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Firefox/i.test(ua)
    ? 'Firefox'
    : /Edg/i.test(ua)
      ? 'Edge'
      : /Chrome/i.test(ua)
        ? 'Chrome'
        : /Safari/i.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Desktop';
  return `${browser} on ${os}`;
}

export default function AccountSecurityPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [security, setSecurity] = useState(null);
  const [loading, setLoading] = useState(true);

  const [setupData, setSetupData] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [working, setWorking] = useState(false);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    try {
      setSecurity(await authApi.getSecurity());
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadSecurity();
  }, [loadSecurity]);

  const handleStart2fa = async () => {
    setWorking(true);
    try {
      const data = await authApi.setup2fa();
      setSetupData(data);
      setVerifyCode('');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleEnable2fa = async (event) => {
    event.preventDefault();
    setWorking(true);
    try {
      const res = await authApi.enable2fa(verifyCode.trim());
      setSetupData(null);
      setBackupCodes(res.backup_codes);
      await refreshProfile();
      loadSecurity();
      notify('Two-factor authentication enabled.', 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleDisable2fa = async (event) => {
    event.preventDefault();
    setWorking(true);
    try {
      await authApi.disable2fa(disableCode.trim());
      setDisableOpen(false);
      setDisableCode('');
      await refreshProfile();
      loadSecurity();
      notify('Two-factor authentication disabled.', 'info');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    try {
      await authApi.revokeSession(sessionId);
      notify('Device session signed out.', 'info');
      loadSecurity();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  const handleRevokeOthers = async () => {
    try {
      await authApi.revokeOtherSessions();
      notify('Signed out all other devices.', 'success');
      loadSecurity();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  if (loading || !security) {
    return (
      <div className="max-w-3xl mx-auto py-6 space-y-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate(user?.role === 'candidate' ? '/candidate' : '/admin')}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-xl font-semibold tracking-tight">Account security</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Manage two-factor authentication, active devices, password, and recent login activity.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/change-password')}>
          <KeyRound className="h-4 w-4" /> Change password
        </Button>
      </div>

      {/* Two-Factor Authentication Card */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Two-factor authentication (TOTP)</h2>
                <Badge tone={security.totp_enabled ? 'success' : 'neutral'} dot>
                  {security.totp_enabled ? 'Enabled' : 'Not enabled'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-lg">
                Protect your account with Google Authenticator, Authy, 1Password, or Microsoft Authenticator.
                {security.totp_enabled && ` ${security.backup_codes_remaining} backup recovery code(s) remaining.`}
              </p>
            </div>
          </div>

          {security.totp_enabled ? (
            <Button variant="dangerOutline" size="sm" onClick={() => setDisableOpen(true)}>
              <ShieldOff className="h-4 w-4" /> Disable 2FA
            </Button>
          ) : (
            <Button size="sm" loading={working} onClick={handleStart2fa}>
              <ShieldCheck className="h-4 w-4" /> Set up 2FA
            </Button>
          )}
        </div>

        {setupData && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 grid sm:grid-cols-[180px_1fr] gap-5 items-center">
            <div className="bg-white p-2.5 rounded-lg border border-zinc-200 inline-flex justify-center">
              <img src={setupData.qr_svg_data_uri} alt="Authenticator QR code" className="h-36 w-36" />
            </div>
            <form onSubmit={handleEnable2fa} className="space-y-3">
              <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                1. Scan this QR code with your authenticator app, or enter the key manually:
              </div>
              <div className="flex items-center gap-2">
                <code className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-mono">
                  {setupData.secret}
                </code>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard?.writeText(setupData.secret);
                    notify('Secret key copied.', 'success');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="w-44">
                  <Input
                    label="2. Enter 6-digit code"
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value)}
                    maxLength={6}
                    placeholder="000000"
                    className="font-mono tracking-widest text-center"
                    required
                  />
                </div>
                <Button type="submit" size="sm" loading={working}>
                  Activate 2FA
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSetupData(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </Card>

      {/* Active Sessions */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Active devices ({security.active_sessions.length})</h2>
            <p className="text-xs text-zinc-500">Devices holding a valid refresh session for your account.</p>
          </div>
          {security.active_sessions.length > 1 && (
            <Button variant="secondary" size="xs" onClick={handleRevokeOthers}>
              <LogOut className="h-3.5 w-3.5" /> Sign out other devices
            </Button>
          )}
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {security.active_sessions.map((session) => (
            <div key={session.id} className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Laptop className="h-4 w-4 text-zinc-400 shrink-0" />
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{summarizeUserAgent(session.user_agent)}</span>
                    {session.is_current && <Badge tone="success">Current device</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    IP {session.ip_address || 'unknown'} &middot; Signed in {formatDateTime(session.created_at)}
                  </div>
                </div>
              </div>
              {!session.is_current && (
                <Button size="xs" variant="dangerOutline" onClick={() => handleRevokeSession(session.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Recent Security Events */}
      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">Recent security activity</h2>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
          {security.recent_events.map((ev) => (
            <div key={ev.id} className="py-2 flex items-center justify-between gap-3">
              <span className="font-mono text-zinc-700 dark:text-zinc-300">{ev.action}</span>
              <span className="text-zinc-500 tabular-nums">
                {ev.ip_address || '—'} &middot; {formatDateTime(ev.created_at)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* One-time Backup Codes Modal */}
      <Modal
        open={Boolean(backupCodes)}
        onClose={() => setBackupCodes(null)}
        title="Save your backup recovery codes"
        description="Each code works once if you lose access to your authenticator app. These are shown only now."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadTextFile('exampulse-backup-codes.txt', (backupCodes || []).join('\n'), 'text/plain')
              }
            >
              <Download className="h-4 w-4" /> Download .txt
            </Button>
            <Button onClick={() => setBackupCodes(null)}>I saved these codes</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          {(backupCodes || []).map((code) => (
            <div
              key={code}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-center"
            >
              {code}
            </div>
          ))}
        </div>
      </Modal>

      {/* Disable 2FA Modal */}
      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title="Disable two-factor authentication">
        <form onSubmit={handleDisable2fa} className="space-y-4">
          <Input
            label="Enter current 6-digit authenticator or backup code"
            value={disableCode}
            onChange={(event) => setDisableCode(event.target.value)}
            placeholder="123456 or ABCD-1234"
            className="font-mono"
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={working}>
              Disable 2FA
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
