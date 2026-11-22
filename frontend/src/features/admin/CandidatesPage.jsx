import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Pencil, Plus, Search, Trash2, Upload, UserCheck, UserX, Users } from 'lucide-react';
import { adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { csvEscape, downloadTextFile, extractApiError, formatRelativeSeconds } from '../../lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  TableShell,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const PAGE_SIZE = 25;

export default function CandidatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    full_name: '',
    email: '',
    candidate_code: '',
    batch_id: '',
    password: '',
  });
  const [createdPasswordBanner, setCreatedPasswordBanner] = useState(null);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', batch_id: '' });

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      if (batchFilter) params.batch_id = batchFilter;
      if (activeFilter !== '') params.is_active = activeFilter === 'true';

      const [candPage, batchList] = await Promise.all([
        adminPeopleApi.listCandidates(params),
        adminPeopleApi.listBatches(),
      ]);
      setCandidates(candPage.items);
      setTotal(candPage.total);
      setBatches(batchList);
    } catch (error) {
      notify(extractApiError(error, 'Failed to load candidates.'), 'danger');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, batchFilter, notify, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(loadData, 200);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const copyText = (text, label = 'Copied') => {
    navigator.clipboard?.writeText(text);
    notify(`${label} to clipboard.`, 'success');
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        username: createForm.username.trim(),
        full_name: createForm.full_name.trim(),
        email: createForm.email.trim() || null,
        candidate_code: createForm.candidate_code.trim() || null,
        batch_id: createForm.batch_id || null,
        password: createForm.password || null,
      };
      const result = await adminPeopleApi.createCandidate(payload);
      setCreateOpen(false);
      setCreateForm({ username: '', full_name: '', email: '', candidate_code: '', batch_id: '', password: '' });
      if (result.temporary_password) {
        setCreatedPasswordBanner({
          username: result.candidate.username,
          password: result.temporary_password,
        });
      }
      notify(`Created candidate ${result.candidate.full_name}.`, 'success');
      loadData();
    } catch (error) {
      notify(extractApiError(error, 'Could not create candidate.'), 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editTarget) return;
    setSubmitting(true);
    try {
      await adminPeopleApi.updateCandidate(editTarget.id, {
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim() || null,
        batch_id: editForm.batch_id || null,
      });
      setEditTarget(null);
      notify('Candidate updated.', 'success');
      loadData();
    } catch (error) {
      notify(extractApiError(error, 'Update failed.'), 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (candidate) => {
    try {
      await adminPeopleApi.updateCandidate(candidate.id, { is_active: !candidate.is_active });
      notify(`${candidate.username} ${candidate.is_active ? 'deactivated' : 'reactivated'}.`, 'info');
      loadData();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  const handleResetPassword = async (candidate) => {
    try {
      const result = await adminPeopleApi.resetCandidatePassword(candidate.id);
      setCreatedPasswordBanner({ username: candidate.username, password: result.temporary_password });
      notify(`Temporary password generated for ${candidate.username}.`, 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await adminPeopleApi.deleteCandidate(deleteTarget.id);
      setDeleteTarget(null);
      notify('Candidate deleted.', 'success');
      loadData();
    } catch (error) {
      notify(extractApiError(error, 'Could not delete candidate.'), 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const result = await adminPeopleApi.importCandidatesCsv(importFile);
      setImportResult(result);
      notify(`Imported ${result.created.length} candidate(s).`, 'success');
      loadData();
    } catch (error) {
      notify(extractApiError(error, 'CSV import failed.'), 'danger');
    } finally {
      setImporting(false);
    }
  };

  const downloadCsvTemplate = () => {
    const sample = [
      'username,full_name,email,candidate_code,batch',
      'a.sharma,Aarav Sharma,aarav@college.edu,KMIT-101,CSE-A 2026',
      'n.verma,Neha Verma,neha@college.edu,KMIT-102,CSE-A 2026',
    ].join('\n');
    downloadTextFile('candidates-template.csv', sample);
  };

  const downloadCreatedCredentials = () => {
    if (!importResult?.created?.length) return;
    const rows = [
      ['username', 'full_name', 'candidate_code', 'temporary_password'].join(','),
      ...importResult.created.map((item) =>
        [item.username, item.full_name, item.candidate_code, item.temporary_password].map(csvEscape).join(',')
      ),
    ];
    downloadTextFile('candidate-credentials.csv', rows.join('\n'));
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Candidates</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Create student accounts individually or import cohorts from CSV.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setImportFile(null);
                setImportResult(null);
                setImportOpen(true);
              }}
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Add candidate
            </Button>
          </div>
        )}
      </div>

      {createdPasswordBanner && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <span className="font-semibold text-emerald-900 dark:text-emerald-200">
              One-time password for @{createdPasswordBanner.username}:{' '}
            </span>
            <code className="rounded bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 font-mono text-xs">
              {createdPasswordBanner.password}
            </code>
            <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">
              Save this now — they will be required to change it on first login.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => copyText(createdPasswordBanner.password, 'Temporary password copied')}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setCreatedPasswordBanner(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2 relative">
          <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none" />
          <Input
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search by name, username, email, or code…"
            className="pl-9"
          />
        </div>
        <Select
          value={batchFilter}
          onChange={(event) => {
            setPage(1);
            setBatchFilter(event.target.value);
          }}
        >
          <option value="">All batches</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </Select>
        <Select
          value={activeFilter}
          onChange={(event) => {
            setPage(1);
            setActiveFilter(event.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : candidates.length === 0 ? (
        <TableShell>
          <tbody>
            <tr>
              <td>
                <EmptyState
                  icon={Users}
                  title="No candidates found"
                  description="Add candidates manually or bulk-import a CSV roster."
                />
              </td>
            </tr>
          </tbody>
        </TableShell>
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Candidate</th>
              <th className="px-4 py-3 text-left font-medium">Code</th>
              <th className="px-4 py-3 text-left font-medium">Batch</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last login</th>
              {isAdmin && <th className="px-4 py-3 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {candidates.map((candidate) => (
              <tr key={candidate.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{candidate.full_name}</div>
                  <div className="text-xs text-zinc-500">
                    @{candidate.username}
                    {candidate.email ? ` · ${candidate.email}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {candidate.candidate_code}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                  {candidate.batch_name || '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={candidate.is_active ? 'success' : 'neutral'} dot>
                    {candidate.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{formatRelativeSeconds(candidate.last_login_at)}</td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <IconButton
                        label="Edit candidate"
                        onClick={() => {
                          setEditTarget(candidate);
                          setEditForm({
                            full_name: candidate.full_name,
                            email: candidate.email || '',
                            batch_id: candidate.batch_id || '',
                          });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Reset password" onClick={() => handleResetPassword(candidate)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={candidate.is_active ? 'Deactivate' : 'Activate'}
                        onClick={() => handleToggleActive(candidate)}
                      >
                        {candidate.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      </IconButton>
                      <IconButton
                        label="Delete candidate"
                        className="hover:text-red-600"
                        onClick={() => setDeleteTarget(candidate)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="tabular-nums">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button size="xs" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Create Candidate Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add candidate"
        description="Leave password blank to generate a secure one-time password."
      >
        <form onSubmit={handleCreate} className="space-y-3.5">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Username"
              value={createForm.username}
              onChange={(event) => setCreateForm((p) => ({ ...p, username: event.target.value }))}
              placeholder="e.g. s.kumar"
              required
            />
            <Input
              label="Candidate code (optional)"
              value={createForm.candidate_code}
              onChange={(event) => setCreateForm((p) => ({ ...p, candidate_code: event.target.value }))}
              placeholder="Auto-generated if blank"
            />
          </div>
          <Input
            label="Full name"
            value={createForm.full_name}
            onChange={(event) => setCreateForm((p) => ({ ...p, full_name: event.target.value }))}
            required
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Email (optional)"
              type="email"
              value={createForm.email}
              onChange={(event) => setCreateForm((p) => ({ ...p, email: event.target.value }))}
            />
            <Select
              label="Batch (optional)"
              value={createForm.batch_id}
              onChange={(event) => setCreateForm((p) => ({ ...p, batch_id: event.target.value }))}
            >
              <option value="">No batch</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="Initial password (optional)"
            type="password"
            value={createForm.password}
            onChange={(event) => setCreateForm((p) => ({ ...p, password: event.target.value }))}
            hint="If blank, a temporary password is generated and forced to change on first login."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create candidate
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Candidate Modal */}
      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Edit candidate">
        <form onSubmit={handleSaveEdit} className="space-y-3.5">
          <Input
            label="Full name"
            value={editForm.full_name}
            onChange={(event) => setEditForm((p) => ({ ...p, full_name: event.target.value }))}
            required
          />
          <Input
            label="Email"
            type="email"
            value={editForm.email}
            onChange={(event) => setEditForm((p) => ({ ...p, email: event.target.value }))}
          />
          <Select
            label="Batch"
            value={editForm.batch_id}
            onChange={(event) => setEditForm((p) => ({ ...p, batch_id: event.target.value }))}
          >
            <option value="">No batch</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* CSV Import Modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk import candidates (CSV)"
        description="Header row: username,full_name,email,candidate_code,batch. New batches are created automatically."
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setImportFile(event.target.files?.[0] || null)}
              className="text-xs text-zinc-600 dark:text-zinc-300"
            />
            <Button variant="secondary" size="xs" onClick={downloadCsvTemplate}>
              <Download className="h-3.5 w-3.5" />
              Download template
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button disabled={!importFile} loading={importing} onClick={handleCsvImport}>
              Import CSV
            </Button>
          </div>

          {importResult && (
            <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">
                  Created: <span className="text-emerald-600 font-semibold">{importResult.created.length}</span> &middot;
                  Skipped: <span className="text-amber-600 font-semibold">{importResult.skipped.length}</span>
                </div>
                {importResult.created.length > 0 && (
                  <Button size="xs" onClick={downloadCreatedCredentials}>
                    <Download className="h-3.5 w-3.5" />
                    Download credentials CSV
                  </Button>
                )}
              </div>

              {importResult.skipped.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs space-y-1">
                  {importResult.skipped.map((row, idx) => (
                    <div key={idx} className="text-amber-900 dark:text-amber-200">
                      Row {row.row} ({row.username || 'blank'}): {row.reason}
                    </div>
                  ))}
                </div>
              )}

              {importResult.created.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 text-xs">
                  <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                    <thead className="bg-zinc-50 dark:bg-zinc-900">
                      <tr>
                        <th className="px-3 py-2 text-left">Username</th>
                        <th className="px-3 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">Temp Password</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
                      {importResult.created.map((item) => (
                        <tr key={item.username}>
                          <td className="px-3 py-1.5">{item.username}</td>
                          <td className="px-3 py-1.5">{item.candidate_code}</td>
                          <td className="px-3 py-1.5">{item.temporary_password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={submitting}
        danger
        confirmLabel="Delete candidate"
        title="Delete candidate account?"
        message={`Permanently delete ${deleteTarget?.full_name} (@${deleteTarget?.username})? Candidates with existing exam attempts cannot be deleted and must be deactivated instead.`}
      />
    </div>
  );
}
