import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, UserCheck, UserX } from 'lucide-react';
import { adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError, formatRelativeSeconds } from '../../lib/format';
import { Badge, Button, IconButton, Input, Modal, Select, Skeleton, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export default function StaffPage() {
  const { user: currentUser } = useAuth();
  const { notify } = useToast();

  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', role: 'invigilator', password: '' });
  const [tempCreds, setTempCreds] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      setStaffList(await adminPeopleApi.listStaff());
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await adminPeopleApi.createStaff({
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        role: form.role,
        password: form.password || null,
      });
      setCreateOpen(false);
      setForm({ username: '', full_name: '', role: 'invigilator', password: '' });
      if (result.temporary_password) {
        setTempCreds({ username: result.staff.username, password: result.temporary_password });
      }
      notify(`Created ${result.staff.role} account.`, 'success');
      loadStaff();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (member) => {
    try {
      await adminPeopleApi.updateStaff(member.id, { is_active: !member.is_active });
      notify(`${member.username} updated.`, 'info');
      loadStaff();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Staff accounts</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Manage administrators and exam invigilators.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add staff member
        </Button>
      </div>

      {tempCreds && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <div>
            Temporary password for <strong>@{tempCreds.username}</strong>:{' '}
            <code className="rounded bg-white dark:bg-zinc-900 border px-2 py-0.5 font-mono text-xs">
              {tempCreds.password}
            </code>
          </div>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(tempCreds.password);
              notify('Password copied.', 'success');
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last login</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {staffList.map((member) => (
              <tr key={member.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{member.full_name}</div>
                  <div className="text-xs text-zinc-500">@{member.username}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={member.role === 'admin' ? 'info' : 'neutral'}>{member.role}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={member.is_active ? 'success' : 'neutral'} dot>
                    {member.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{formatRelativeSeconds(member.last_login_at)}</td>
                <td className="px-4 py-3 text-right">
                  {member.id !== currentUser?.id && (
                    <IconButton
                      label={member.is_active ? 'Deactivate' : 'Activate'}
                      onClick={() => handleToggle(member)}
                    >
                      {member.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add staff member">
        <form onSubmit={handleCreate} className="space-y-3.5">
          <Input
            label="Username"
            value={form.username}
            onChange={(event) => setForm((p) => ({ ...p, username: event.target.value }))}
            required
          />
          <Input
            label="Full name"
            value={form.full_name}
            onChange={(event) => setForm((p) => ({ ...p, full_name: event.target.value }))}
            required
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(event) => setForm((p) => ({ ...p, role: event.target.value }))}
          >
            <option value="invigilator">Invigilator</option>
            <option value="admin">Administrator</option>
          </Select>
          <Input
            label="Initial password (optional)"
            type="password"
            value={form.password}
            onChange={(event) => setForm((p) => ({ ...p, password: event.target.value }))}
            hint="Leave blank to auto-generate a one-time password."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create account
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
