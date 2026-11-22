import React, { useEffect, useState } from 'react';
import { MessageSquare, Star } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { extractApiError, formatDateTime } from '../../lib/format';
import { Badge, Card, EmptyState, Skeleton, StatCard } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const DIFFICULTY_LABELS = {
  too_easy: 'Too easy',
  just_right: 'Balanced',
  challenging: 'Challenging',
  too_hard: 'Too hard',
};

export function FeedbackTab({ examId = null }) {
  const { notify } = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const request = examId ? adminMonitorApi.getExamFeedback(examId) : adminMonitorApi.getAllFeedback();
    request
      .then(setSummary)
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  }, [examId, notify]);

  if (loading) return <Skeleton className="h-64" />;
  if (!summary) return null;

  const total = Math.max(1, summary.total_responses);

  return (
    <div className="space-y-5">
      {!examId && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Student feedback</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Post-exam ratings, perceived difficulty, and candidate remarks across examinations.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Responses" value={summary.total_responses} icon={MessageSquare} />
        <StatCard label="Overall rating" value={`${summary.avg_overall} / 5`} icon={Star} />
        <StatCard label="Question clarity" value={`${summary.avg_clarity} / 5`} icon={Star} />
        <StatCard label="Platform stability" value={`${summary.avg_platform} / 5`} icon={Star} />
      </div>

      {summary.total_responses === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquare}
            title="No candidate feedback yet"
            description="Candidates are prompted with a quick feedback form right after submitting an exam."
          />
        </Card>
      ) : (
        <>
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-semibold">Difficulty perception</h3>
            <div className="space-y-2">
              {Object.entries(DIFFICULTY_LABELS).map(([key, label]) => {
                const count = summary.difficulty_counts[key] || 0;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={key} className="grid grid-cols-[110px_1fr_54px] items-center gap-3 text-xs">
                    <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
                    <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-zinc-500">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-3">
            {summary.items.map((item) => (
              <Card key={item.id} className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">{item.candidate_name}</span>
                    <span className="font-mono text-zinc-500">{item.candidate_code}</span>
                    <Badge tone="neutral">{DIFFICULTY_LABELS[item.difficulty] || item.difficulty}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs tabular-nums text-zinc-500">
                    <span>Overall: <strong>{item.overall_rating}/5</strong></span>
                    <span>Clarity: {item.clarity_rating}/5</span>
                    <span>Platform: {item.platform_rating}/5</span>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                </div>
                {item.comments && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{item.comments}</p>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default FeedbackTab;
