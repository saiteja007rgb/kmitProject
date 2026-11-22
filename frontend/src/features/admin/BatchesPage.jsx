import React, { useCallback, useEffect, useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Skeleton,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export default function BatchesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalTarget, setModalTarget] = useState(null); // null | 'new' | batch object
  const [form, setForm] = useState({ name: '', description: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      setBatches(await adminPeopleApi.listBatches());
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null };
      if (modalTarget === 'new') {
        await adminPeopleApi.createBatch(payload);
        notify('Batch created.', 'success');
      } else {
        await adminPeopleApi.updateBatch(modalTarget.id, payload);
        notify('Batch updated.', 'success');
      }
      setModalTarget(null);
      loadBatches();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await adminPeopleApi.deleteBatch(deleteTarget.id);
      setDeleteTarget(null);
      notify('Batch deleted.', 'success');
      loadBatches();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Batches</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Group candidates into cohorts for one-click exam enrollment.
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setForm({ name: '', description: '' });
              setModalTarget('new');
            }}
          >
            <Plus className="h-4 w-4" />
            New batch
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-48" />
      ) : batches.length === 0 ? (
        <Card>
          <EmptyState icon={Layers} title="No batches yet" description="Create a batch to organize candidates." />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.map((batch) => (
            <Card key={batch.id} className="p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{batch.name}</h2>
                  <Badge tone="neutral">{batch.candidate_count} students</Badge>
                </div>
                {batch.description && (
                  <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{batch.description}</p>
                )}
              </div>
              {isAdmin && (
                <div className="flex justify-end gap-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <IconButton
                    label="Edit batch"
                    onClick={() => {
                      setForm({ name: batch.name, description: batch.description || '' });
                      setModalTarget(batch);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Delete batch"
                    className="hover:text-red-600"
                    onClick={() => setDeleteTarget(batch)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(modalTarget)}
        onClose={() => setModalTarget(null)}
        title={modalTarget === 'new' ? 'Create batch' : 'Edit batch'}
      >
        <form onSubmit={handleSave} className="space-y-3.5">
          <Input
            label="Batch name"
            value={form.name}
            onChange={(event) => setForm((p) => ({ ...p, name: event.target.value }))}
            placeholder="e.g. CSE-A 2026"
            required
          />
          <Input
            label="Description (optional)"
            value={form.description}
            onChange={(event) => setForm((p) => ({ ...p, description: event.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={saving}
        danger
        confirmLabel="Delete batch"
        title="Delete batch?"
        message={`Delete "${deleteTarget?.name}"? Candidates in this batch will keep their accounts with their batch cleared.`}
      />
    </div>
  );
}

