import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { adminExamsApi, adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError } from '../../lib/format';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Skeleton,
  TableShell,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function EnrollmentsTab({ examId }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extraDrafts, setExtraDrafts] = useState({});

  const [modalOpen, setModalOpen] = useState(false);
  const [batches, setBatches] = useState([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateResults, setCandidateResults] = useState([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadEnrollments = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminExamsApi.listEnrollments(examId);
      setEnrollments(list);
      const drafts = {};
      for (const item of list) drafts[item.candidate_id] = item.extra_minutes;
      setExtraDrafts(drafts);
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [examId, notify]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  useEffect(() => {
    if (!modalOpen) return;
    adminPeopleApi.listBatches().then(setBatches).catch(() => {});
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const timer = window.setTimeout(() => {
      adminPeopleApi
        .listCandidates({ search: candidateSearch.trim(), is_active: true, page_size: 50 })
        .then((res) => setCandidateResults(res.items))
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [candidateSearch, modalOpen]);

  const handleEnroll = async () => {
    setSaving(true);
    try {
      const result = await adminExamsApi.addEnrollments(examId, {
        candidate_ids: selectedCandidateIds,
        batch_ids: selectedBatchIds,
      });
      notify(`Enrolled ${result.added} candidate(s) (${result.already_enrolled} already enrolled).`, 'success');
      setModalOpen(false);
      setSelectedBatchIds([]);
      setSelectedCandidateIds([]);
      loadEnrollments();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExtra = async (candidateId) => {
    try {
      await adminExamsApi.updateEnrollment(examId, candidateId, Number(extraDrafts[candidateId] || 0));
      notify('Time accommodation updated.', 'success');
      loadEnrollments();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  const handleRemove = async (candidateId) => {
    try {
      await adminExamsApi.removeEnrollment(examId, candidateId);
      notify('Candidate unenrolled.', 'info');
      loadEnrollments();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  if (loading) return <Skeleton className="h-56" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Only enrolled candidates can view and start this examination.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> Enroll candidates
          </Button>
        )}
      </div>

      {enrollments.length === 0 ? (
        <TableShell>
          <tbody>
            <tr>
              <td>
                <EmptyState
                  icon={Users}
                  title="No candidates enrolled"
                  description="Enroll individual students or whole batches to grant access."
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
              <th className="px-4 py-3 text-left font-medium">Batch</th>
              <th className="px-4 py-3 text-left font-medium">Attempt</th>
              <th className="px-4 py-3 text-left font-medium">Extra minutes</th>
              {isAdmin && <th className="px-4 py-3 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {enrollments.map((item) => (
              <tr key={item.candidate_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3">
                  <div className="font-medium">{item.full_name}</div>
                  <div className="text-xs text-zinc-500 font-mono">{item.candidate_code}</div>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{item.batch_name || '—'}</td>
                <td className="px-4 py-3">
                  <Badge
                    tone={
                      item.attempt_status === 'submitted'
                        ? 'success'
                        : item.attempt_status === 'in_progress'
                          ? 'info'
                          : 'neutral'
                    }
                  >
                    {item.attempt_status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={180}
                        value={extraDrafts[item.candidate_id] ?? 0}
                        onChange={(event) =>
                          setExtraDrafts((prev) => ({ ...prev, [item.candidate_id]: event.target.value }))
                        }
                        className="h-8 w-20 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs tabular-nums"
                      />
                      {Number(extraDrafts[item.candidate_id]) !== item.extra_minutes && (
                        <Button size="xs" variant="secondary" onClick={() => handleSaveExtra(item.candidate_id)}>
                          Save
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs tabular-nums">{item.extra_minutes} min</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <IconButton
                      label="Remove enrollment"
                      disabled={item.attempt_status !== 'not_started'}
                      className="hover:text-red-600"
                      onClick={() => handleRemove(item.candidate_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Enroll candidates"
        description="Select entire batches and/or individual candidates."
        maxWidth="max-w-xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={selectedBatchIds.length === 0 && selectedCandidateIds.length === 0}
              onClick={handleEnroll}
            >
              Enroll selected
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {batches.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Enroll whole batches</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {batches.map((batch) => (
                  <Checkbox
                    key={batch.id}
                    label={`${batch.name} (${batch.candidate_count})`}
                    checked={selectedBatchIds.includes(batch.id)}
                    onChange={(checked) =>
                      setSelectedBatchIds((prev) =>
                        checked ? [...prev, batch.id] : prev.filter((id) => id !== batch.id)
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
            <Input
              label="Or pick individual candidates"
              value={candidateSearch}
              onChange={(event) => setCandidateSearch(event.target.value)}
              placeholder="Search name, username, or code…"
            />
            <div className="max-h-56 overflow-y-auto space-y-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
              {candidateResults.map((candidate) => (
                <Checkbox
                  key={candidate.id}
                  label={`${candidate.full_name} (${candidate.candidate_code})`}
                  checked={selectedCandidateIds.includes(candidate.id)}
                  onChange={(checked) =>
                    setSelectedCandidateIds((prev) =>
                      checked ? [...prev, candidate.id] : prev.filter((id) => id !== candidate.id)
                    )
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
