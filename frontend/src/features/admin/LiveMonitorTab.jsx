import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { useLiveSocket } from '../../hooks/useLiveSocket';
import { extractApiError, formatDurationClock, formatRelativeSeconds } from '../../lib/format';
import { Badge, Card, EmptyState, Skeleton, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { AttemptDetailDrawer, SnapshotImage } from './AttemptDetailDrawer';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'not_started', label: 'Not started' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'offline', label: 'Offline' },
];

export function LiveMonitorTab({ examId, onExamSummaryUpdated }) {
  const { notify } = useToast();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status'); // status | progress | violations | code
  const [selectedAttemptId, setSelectedAttemptId] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadBoard = useCallback(async () => {
    try {
      const data = await adminMonitorApi.getLiveBoard(examId);
      setBoard(data);
      onExamSummaryUpdated?.(data.exam);
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [examId, notify, onExamSummaryUpdated]);

  useEffect(() => {
    loadBoard();
    const poll = window.setInterval(loadBoard, 20000);
    return () => window.clearInterval(poll);
  }, [loadBoard]);

  // Tick remaining times once per second on the live board.
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  // Incremental live updates from Redis Pub/Sub via WebSocket.
  const wsStatus = useLiveSocket(
    `/ws/admin/exams/${examId}`,
    (event) => {
      if (event.type === 'exam_status_changed') {
        loadBoard();
        return;
      }
      setBoard((prev) => {
        if (!prev) return prev;
        let touched = false;
        const candidates = prev.candidates.map((row) => {
          if (row.candidate_id !== event.candidate_id) return row;
          touched = true;
          if (event.type === 'attempt_started') {
            return { ...row, attempt_id: event.attempt_id, status: 'in_progress', is_online: true, last_seen_at: new Date().toISOString() };
          }
          if (event.type === 'answer_saved') {
            return { ...row, answered_count: event.answered_count, is_online: true, last_seen_at: new Date().toISOString() };
          }
          if (event.type === 'proctoring_event') {
            return { ...row, violation_count: event.violation_count };
          }
          if (event.type === 'snapshot_uploaded') {
            return { ...row, latest_snapshot_id: event.snapshot_id };
          }
          if (event.type === 'attempt_submitted') {
            return { ...row, status: 'submitted', is_online: false, submit_reason: event.submit_reason, score: event.score };
          }
          return row;
        });
        if (!touched) {
          loadBoard();
          return prev;
        }
        return { ...prev, candidates };
      });
    },
    true
  );

  const visibleRows = useMemo(() => {
    if (!board) return [];
    const filtered = board.candidates.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'flagged') return row.violation_count > 0 || row.collusion_flagged;
      if (filter === 'offline') return row.status === 'in_progress' && !row.is_online;
      return row.status === filter;
    });

    const statusRank = { in_progress: 0, submitted: 1, not_started: 2 };
    return [...filtered].sort((a, b) => {
      if (sortBy === 'violations') return b.violation_count - a.violation_count;
      if (sortBy === 'progress') return b.answered_count - a.answered_count;
      if (sortBy === 'code') return a.candidate_code.localeCompare(b.candidate_code);
      return statusRank[a.status] - statusRank[b.status] || a.candidate_code.localeCompare(b.candidate_code);
    });
  }, [board, filter, sortBy]);

  if (loading) return <Skeleton className="h-72" />;
  if (!board) return null;

  const avgPct = Math.round((board.average_progress || 0) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-[11px] text-zinc-500">Enrolled</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{board.counts.enrolled}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-zinc-500">In progress</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
            {board.counts.in_progress}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-zinc-500">Submitted</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {board.counts.submitted}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-zinc-500">Not started</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{board.counts.not_started}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-zinc-500">Flagged</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
            {board.counts.flagged}
          </div>
        </Card>
      </div>

      <Card className="px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-zinc-500">Average cohort completion</span>
            <span className="font-semibold tabular-nums">{avgPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${avgPct}%` }} />
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          {wsStatus === 'connected' ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-emerald-500" /> Live stream connected
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-amber-500" /> Polling fallback
            </>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                filter === item.key
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Sort candidates"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs"
        >
          <option value="status">Sort by status</option>
          <option value="violations">Sort by violations</option>
          <option value="progress">Sort by progress</option>
          <option value="code">Sort by code</option>
        </select>
      </div>

      {visibleRows.length === 0 ? (
        <Card>
          <EmptyState
            title="No candidates match this filter"
            description="Enroll candidates under the Enrollments tab or clear the filter."
          />
        </Card>
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Candidate</th>
              <th className="px-4 py-3 text-left font-medium">Camera</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Progress</th>
              <th className="px-4 py-3 text-left font-medium">Remaining</th>
              <th className="px-4 py-3 text-left font-medium">Integrity</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visibleRows.map((row) => {
              const pct = row.total_questions ? Math.round((row.answered_count / row.total_questions) * 100) : 0;
              const remainingSeconds =
                row.status === 'in_progress' && row.deadline
                  ? Math.max(0, Math.floor((new Date(row.deadline).getTime() - nowMs) / 1000))
                  : null;

              return (
                <tr
                  key={row.candidate_id}
                  onClick={() => row.attempt_id && setSelectedAttemptId(row.attempt_id)}
                  className={row.attempt_id ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40' : ''}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        title={row.is_online ? 'Online' : 'Offline'}
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          row.is_online ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
                        }`}
                      />
                      <div>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.full_name}</div>
                        <div className="text-xs text-zinc-500">
                          {row.candidate_code}
                          {row.batch_name ? ` · ${row.batch_name}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.latest_snapshot_id ? (
                      <SnapshotImage snapshotId={row.latest_snapshot_id} />
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        row.status === 'in_progress'
                          ? 'info'
                          : row.status === 'submitted'
                            ? 'success'
                            : 'neutral'
                      }
                      dot
                    >
                      {row.status.replace('_', ' ')}
                    </Badge>
                    {row.last_seen_at && row.status === 'in_progress' && (
                      <div className="mt-0.5 text-[11px] text-zinc-400">{formatRelativeSeconds(row.last_seen_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 w-36">
                    <div className="flex items-center justify-between text-xs tabular-nums mb-1">
                      <span>
                        {row.answered_count}/{row.total_questions}
                      </span>
                      <span className="text-zinc-400">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                    {remainingSeconds !== null ? formatDurationClock(remainingSeconds) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {row.violation_count > 0 ? (
                        <Badge tone="danger">
                          <AlertTriangle className="h-3 w-3" /> {row.violation_count}
                        </Badge>
                      ) : (
                        <span className="text-xs text-zinc-400">Clean</span>
                      )}
                      {row.collusion_flagged && <Badge tone="danger">Collusion</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums">
                    {row.score !== null ? `${row.score} / ${row.max_score}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <AttemptDetailDrawer
        attemptId={selectedAttemptId}
        onClose={() => setSelectedAttemptId(null)}
        onUpdated={loadBoard}
      />
    </div>
  );
}
