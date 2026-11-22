import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { extractApiError } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Input, Skeleton, Switch, Textarea } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function GradingTab({ examId }) {
  const { notify } = useToast();
  const [pendingOnly, setPendingOnly] = useState(true);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminMonitorApi.listGradingQueue(examId, pendingOnly);
      setItems(list);
      const nextDrafts = {};
      for (const item of list) {
        nextDrafts[item.answer_id] = {
          marks: item.awarded_marks ?? '',
          feedback: item.feedback || '',
        };
      }
      setDrafts(nextDrafts);
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [examId, notify, pendingOnly]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleGrade = async (item) => {
    const draft = drafts[item.answer_id];
    const parsedMarks = Number(draft?.marks);
    if (Number.isNaN(parsedMarks) || parsedMarks < 0 || parsedMarks > item.max_marks) {
      notify(`Enter marks between 0 and ${item.max_marks}.`, 'warning');
      return;
    }
    setSavingId(item.answer_id);
    try {
      const result = await adminMonitorApi.gradeAnswer(item.answer_id, parsedMarks, draft?.feedback);
      notify(`Saved grade (attempt total: ${result.attempt_score}).`, 'success');
      loadQueue();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Review submitted theory responses against the model answer rubric.
        </p>
        <div className="w-56">
          <Switch label="Pending only" checked={pendingOnly} onChange={setPendingOnly} />
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-56" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title={pendingOnly ? 'All theory answers graded' : 'No submitted theory answers'}
            description="Toggle 'Pending only' off to inspect previously graded submissions."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const draft = drafts[item.answer_id] || { marks: '', feedback: '' };
            return (
              <Card key={item.answer_id} className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">Q{item.position}</Badge>
                    <span className="font-medium text-sm">{item.full_name}</span>
                    <span className="text-xs font-mono text-zinc-500">{item.candidate_code}</span>
                  </div>
                  <Badge tone={item.awarded_marks !== null ? 'success' : 'warning'}>
                    {item.awarded_marks !== null ? `Graded: ${item.awarded_marks}/${item.max_marks}` : `Max ${item.max_marks}`}
                  </Badge>
                </div>

                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.prompt}</p>

                <div className="grid md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                    <div className="font-semibold text-zinc-500 mb-1">Candidate response</div>
                    <p className="whitespace-pre-wrap text-zinc-900 dark:text-zinc-100 leading-relaxed">
                      {item.response || '(blank)'}
                    </p>
                  </div>
                  <div className="rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 p-3">
                    <div className="font-semibold text-indigo-700 dark:text-indigo-300 mb-1">Model answer / rubric</div>
                    <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {item.model_answer || 'No model answer configured.'}
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-[140px_1fr_auto] gap-3 items-end">
                  <Input
                    label={`Marks (0–${item.max_marks})`}
                    type="number"
                    step="0.5"
                    min={0}
                    max={item.max_marks}
                    value={draft.marks}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [item.answer_id]: { ...draft, marks: event.target.value },
                      }))
                    }
                  />
                  <Textarea
                    label="Feedback (optional)"
                    rows={1}
                    value={draft.feedback}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [item.answer_id]: { ...draft, feedback: event.target.value },
                      }))
                    }
                  />
                  <Button loading={savingId === item.answer_id} onClick={() => handleGrade(item)}>
                    Save grade
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

