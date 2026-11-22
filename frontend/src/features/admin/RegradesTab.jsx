import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Scale, XCircle } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { extractApiError, formatDateTime } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function RegradesTab({ examId }) {
  const { notify } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [workingId, setWorkingId] = useState(null);

  const loadRegrades = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminMonitorApi.listExamRegrades(examId);
      setItems(list);
      const next = {};
      for (const req of list) {
        next[req.id] = { marks: req.current_marks ?? '', note: req.resolution_note || '' };
      }
      setDrafts(next);
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [examId, notify]);

  useEffect(() => {
    loadRegrades();
  }, [loadRegrades]);

  const handleResolve = async (req, decision) => {
    const draft = drafts[req.id] || {};
    setWorkingId(req.id);
    try {
      await adminMonitorApi.resolveRegrade(req.id, {
        status: decision,
        new_marks: decision === 'approved' && draft.marks !== '' ? Number(draft.marks) : null,
        resolution_note: draft.note || null,
      });
      notify(`Regrade request ${decision}.`, 'success');
      loadRegrades();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorkingId(null);
    }
  };

  if (loading) return <Skeleton className="h-56" />;

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Scale}
          title="No regrade appeals"
          description="When candidates request a regrade from their results page, tickets appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((req) => {
        const draft = drafts[req.id] || { marks: '', note: '' };
        return (
          <Card key={req.id} className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Badge tone="neutral">Q{req.question_position}</Badge>
                <span className="font-semibold text-sm">{req.candidate_name}</span>
                <span className="font-mono text-zinc-500">{req.candidate_code}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-zinc-500">
                  Current: {req.current_marks ?? 0} / {req.max_marks}
                </span>
                <Badge tone={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'danger' : 'warning'}>
                  {req.status}
                </Badge>
              </div>
            </div>

            <p className="text-xs text-zinc-500">{req.question_prompt}</p>
            <div className="rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-3 text-xs">
              <span className="font-semibold">Student appeal: </span>
              {req.reason}
            </div>

            {req.status === 'open' ? (
              <div className="grid sm:grid-cols-[130px_1fr_auto] gap-2.5 items-end">
                <Input
                  label={`Adjusted marks (0–${req.max_marks})`}
                  type="number"
                  step="0.5"
                  min={0}
                  max={req.max_marks}
                  value={draft.marks}
                  onChange={(event) =>
                    setDrafts((p) => ({ ...p, [req.id]: { ...draft, marks: event.target.value } }))
                  }
                />
                <Input
                  label="Resolution note"
                  value={draft.note}
                  onChange={(event) =>
                    setDrafts((p) => ({ ...p, [req.id]: { ...draft, note: event.target.value } }))
                  }
                  placeholder="Explain the grading decision…"
                />
                <div className="flex items-center gap-1.5">
                  <Button size="sm" loading={workingId === req.id} onClick={() => handleResolve(req, 'approved')}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="dangerOutline"
                    loading={workingId === req.id}
                    onClick={() => handleResolve(req, 'rejected')}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500">
                Resolved {formatDateTime(req.resolved_at)}
                {req.resolution_note ? ` — "${req.resolution_note}"` : ''}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
