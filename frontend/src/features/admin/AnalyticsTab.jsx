import React, { useEffect, useState } from 'react';
import { adminMonitorApi } from '../../api/endpoints';
import { extractApiError, QUESTION_KIND_LABELS } from '../../lib/format';
import { Badge, Card, Skeleton, StatCard, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function AnalyticsTab({ examId }) {
  const { notify } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminMonitorApi
      .getAnalytics(examId)
      .then(setData)
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  }, [examId, notify]);

  if (loading) return <Skeleton className="h-72" />;
  if (!data) return null;

  const { stats, score_histogram: histogram, questions, violations_by_kind: violations } = data;
  const maxBucket = Math.max(1, ...histogram.map((bucket) => bucket.count));
  const violationEntries = Object.entries(violations || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Submitted" value={`${stats.submitted} / ${stats.attempts}`} />
        <StatCard label="Mean / Median" value={stats.mean} sublabel={`Median ${stats.median} · SD ${stats.std_dev}`} />
        <StatCard label="High / Low" value={stats.highest} sublabel={`Lowest ${stats.lowest}`} />
        <StatCard label="Pass rate (>= 40%)" value={`${stats.pass_rate}%`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 p-5">
          <h3 className="text-sm font-semibold mb-4">Score distribution</h3>
          <svg viewBox="0 0 500 180" className="w-full h-44" role="img" aria-label="Score distribution histogram">
            {histogram.map((bucket, idx) => {
              const barHeight = Math.round((bucket.count / maxBucket) * 125);
              const x = idx * 48 + 14;
              const y = 145 - barHeight;
              return (
                <g key={bucket.label}>
                  <rect
                    x={x}
                    y={y}
                    width={34}
                    height={Math.max(barHeight, 2)}
                    rx={3}
                    className={bucket.count > 0 ? 'fill-indigo-600 dark:fill-indigo-500' : 'fill-zinc-200 dark:fill-zinc-800'}
                  />
                  {bucket.count > 0 && (
                    <text
                      x={x + 17}
                      y={y - 5}
                      textAnchor="middle"
                      className="fill-zinc-600 dark:fill-zinc-300 text-[10px] font-medium"
                    >
                      {bucket.count}
                    </text>
                  )}
                  <text
                    x={x + 17}
                    y={164}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[9px]"
                  >
                    {idx * 10}%
                  </text>
                </g>
              );
            })}
          </svg>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">Integrity events by type</h3>
          {violationEntries.length === 0 ? (
            <p className="text-xs text-zinc-500 py-8 text-center">No proctoring events logged.</p>
          ) : (
            <div className="space-y-2.5">
              {violationEntries.map(([kind, count]) => (
                <div key={kind} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">{kind}</span>
                  <Badge tone="danger">{count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <TableShell>
        <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Question (hardest first)</th>
            <th className="px-4 py-3 text-left font-medium">Kind</th>
            <th className="px-4 py-3 text-right font-medium">Attempted</th>
            <th className="px-4 py-3 text-right font-medium">Correct</th>
            <th className="px-4 py-3 text-right font-medium">Accuracy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
          {questions.map((question) => (
            <tr key={question.question_id}>
              <td className="px-4 py-3">
                <span className="font-semibold text-zinc-500 mr-2">Q{question.position}</span>
                <span className="text-zinc-800 dark:text-zinc-200">{question.prompt}</span>
              </td>
              <td className="px-4 py-3">
                <Badge tone="neutral">{QUESTION_KIND_LABELS[question.kind] || question.kind}</Badge>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{question.attempted}</td>
              <td className="px-4 py-3 text-right tabular-nums">{question.correct}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                <span
                  className={
                    question.accuracy < 40
                      ? 'text-red-600'
                      : question.accuracy < 70
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                  }
                >
                  {question.accuracy}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

