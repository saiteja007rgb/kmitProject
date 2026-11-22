import React, { useEffect, useState } from 'react';
import { Clock, RotateCcw, Send } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError, formatDateTime, QUESTION_KIND_LABELS } from '../../lib/format';
import { Badge, Button, ConfirmDialog, Drawer, Input, Spinner, Tabs } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function SnapshotImage({ snapshotId, className = 'h-10 w-14 rounded object-cover' }) {
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    if (!snapshotId) return undefined;
    let active = true;
    let createdUrl = null;
    adminMonitorApi
      .fetchSnapshotBlob(snapshotId)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [snapshotId]);

  if (!objectUrl) {
    return <div className={`${className} bg-zinc-200 dark:bg-zinc-800`} />;
  }
  return <img src={objectUrl} alt="Webcam proctoring frame" className={className} />;
}

export function AttemptDetailDrawer({ attemptId, onClose, onUpdated }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('events');
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [working, setWorking] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadDetail = () => {
    if (!attemptId) return;
    setLoading(true);
    adminMonitorApi
      .getAttemptDetail(attemptId)
      .then(setDetail)
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setTab('events');
    loadDetail();
  }, [attemptId]);

  const handleExtend = async () => {
    setWorking(true);
    try {
      await adminMonitorApi.extendAttempt(attemptId, Number(extendMinutes));
      notify(`Extended deadline by ${extendMinutes} min.`, 'success');
      loadDetail();
      onUpdated?.();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleForceSubmit = async () => {
    setWorking(true);
    try {
      await adminMonitorApi.forceSubmitAttempt(attemptId);
      setConfirmForce(false);
      notify('Attempt force-submitted.', 'success');
      loadDetail();
      onUpdated?.();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleReset = async () => {
    setWorking(true);
    try {
      await adminMonitorApi.resetAttempt(attemptId);
      setConfirmReset(false);
      notify('Attempt reset. Candidate can start fresh.', 'success');
      onClose();
      onUpdated?.();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Drawer
        open={Boolean(attemptId)}
        onClose={onClose}
        title={detail ? `${detail.candidate.full_name} (${detail.candidate.candidate_code})` : 'Attempt detail'}
        subtitle={detail ? `${detail.candidate.batch_name || 'No batch'} · IP ${detail.client_ip || 'unknown'}` : ''}
      >
        {loading || !detail ? (
          <div className="py-12 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-zinc-500">Status</div>
                <div className="mt-1 font-semibold capitalize">{detail.status.replace('_', ' ')}</div>
              </div>
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-zinc-500">Violations</div>
                <div className={`mt-1 font-semibold tabular-nums ${detail.violation_count > 0 ? 'text-red-600' : ''}`}>
                  {detail.violation_count}
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-zinc-500">Score</div>
                <div className="mt-1 font-semibold tabular-nums">
                  {detail.score !== null ? `${detail.score} / ${detail.max_score}` : '—'}
                </div>
              </div>
            </div>

            {/* Live intervention controls */}
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
              {detail.status === 'in_progress' && (
                <div className="flex items-end gap-2">
                  <div className="w-24">
                    <Input
                      label="Extra mins"
                      type="number"
                      min={1}
                      max={180}
                      value={extendMinutes}
                      onChange={(event) => setExtendMinutes(event.target.value)}
                    />
                  </div>
                  <Button size="sm" variant="secondary" loading={working} onClick={handleExtend}>
                    <Clock className="h-3.5 w-3.5" /> Extend
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-2 ml-auto">
                {detail.status === 'in_progress' && (
                  <Button size="sm" variant="dangerOutline" onClick={() => setConfirmForce(true)}>
                    <Send className="h-3.5 w-3.5" /> Force submit
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="dangerOutline" onClick={() => setConfirmReset(true)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset attempt
                  </Button>
                )}
              </div>
            </div>

            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'events', label: 'Proctoring log', badge: detail.events.length },
                { value: 'snapshots', label: 'Snapshots', badge: detail.snapshots.length },
                { value: 'answers', label: 'Answers', badge: detail.answers.length },
              ]}
            />

            {tab === 'events' && (
              <div className="space-y-2">
                {detail.events.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4">No proctoring events recorded.</p>
                ) : (
                  detail.events.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{ev.kind}</span>
                          <Badge tone={ev.counted_as_violation ? 'danger' : 'warning'}>
                            {ev.counted_as_violation ? 'Violation' : 'Logged'}
                          </Badge>
                        </div>
                        {ev.detail && <div className="mt-0.5 text-zinc-500">{ev.detail}</div>}
                      </div>
                      <span className="text-zinc-400 whitespace-nowrap tabular-nums">
                        {formatDateTime(ev.occurred_at)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'snapshots' && (
              <div className="grid grid-cols-2 gap-3">
                {detail.snapshots.length === 0 ? (
                  <p className="col-span-2 text-xs text-zinc-500 py-4">No webcam snapshots uploaded.</p>
                ) : (
                  detail.snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-950"
                    >
                      <SnapshotImage snapshotId={snap.id} className="w-full aspect-[4/3] object-cover" />
                      <div className="p-2 text-[11px] flex items-center justify-between gap-2">
                        <Badge tone={snap.reason === 'violation' ? 'danger' : 'neutral'}>{snap.reason}</Badge>
                        <span className="text-zinc-500 tabular-nums">
                          {snap.face_count} face(s) · {formatDateTime(snap.captured_at)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'answers' && (
              <div className="space-y-2.5">
                {detail.answers.map((ans) => (
                  <div
                    key={ans.question_id}
                    className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        Q{ans.position} · {QUESTION_KIND_LABELS[ans.kind] || ans.kind}
                      </span>
                      <span className="tabular-nums text-zinc-500">
                        {ans.awarded_marks !== null ? `${ans.awarded_marks} / ${ans.max_marks}` : `${ans.max_marks} marks`}
                      </span>
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 line-clamp-2">{ans.prompt}</p>
                    <pre className="rounded bg-zinc-50 dark:bg-zinc-950 p-2 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
                      {ans.response == null
                        ? '(unanswered)'
                        : typeof ans.response === 'object'
                          ? JSON.stringify(ans.response, null, 2)
                          : String(ans.response)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmForce}
        onClose={() => setConfirmForce(false)}
        onConfirm={handleForceSubmit}
        loading={working}
        danger
        confirmLabel="Force submit"
        title="Force submit this attempt?"
        message="The candidate's session will be locked and scored immediately with their currently saved answers."
      />

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleReset}
        loading={working}
        danger
        requireTypedWord="RESET"
        confirmLabel="Permanently reset attempt"
        title="Reset candidate attempt?"
        message="This permanently deletes the candidate's attempt, answers, events, and snapshots so they can start the exam again."
      />
    </>
  );
}

