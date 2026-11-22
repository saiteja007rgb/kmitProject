import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, CheckCircle2, FileText, MessageSquarePlus, Printer, TrendingUp } from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { extractApiError, formatDateTime } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Modal, Skeleton, StatCard, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { FeedbackFormCard } from './FeedbackFormCard';

export default function CandidateTranscriptPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackAttemptId, setFeedbackAttemptId] = useState(null);

  const loadTranscript = () => {
    setLoading(true);
    candidateApi
      .getTranscript()
      .then(setTranscript)
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTranscript();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!transcript) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Performance transcript</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {transcript.full_name} &middot; <span className="font-mono">{transcript.candidate_code}</span>
            {transcript.batch_name ? ` · ${transcript.batch_name}` : ''}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="no-print" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Exams completed" value={transcript.exams_completed} icon={FileText} />
        <StatCard label="Average score" value={`${transcript.average_percentage}%`} icon={TrendingUp} />
        <StatCard label="Highest score" value={`${transcript.highest_percentage}%`} icon={Award} />
        <StatCard
          label="Passed"
          value={`${transcript.pass_count} / ${transcript.exams_completed}`}
          icon={CheckCircle2}
        />
      </div>

      {transcript.entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Award}
            title="No published results yet"
            description="Completed exams with published results will appear on your official transcript."
          />
        </Card>
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Examination</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
              <th className="px-4 py-3 text-right font-medium">Percentage</th>
              <th className="px-4 py-3 text-center font-medium">Grade</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium no-print">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {transcript.entries.map((entry) => (
              <tr key={entry.attempt_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-3 font-medium">{entry.exam_title}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {entry.score} / {entry.max_score}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{entry.percentage}%</td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={entry.passed ? 'success' : 'danger'}>{entry.grade}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{formatDateTime(entry.submitted_at)}</td>
                <td className="px-4 py-3 text-right no-print">
                  <div className="inline-flex items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => navigate(`/candidate/attempts/${entry.attempt_id}/result`)}
                    >
                      Review
                    </Button>
                    <Button
                      size="xs"
                      variant={entry.feedback_submitted ? 'ghost' : 'secondary'}
                      onClick={() => setFeedbackAttemptId(entry.attempt_id)}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      {entry.feedback_submitted ? 'Edit feedback' : 'Feedback'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={Boolean(feedbackAttemptId)}
        onClose={() => setFeedbackAttemptId(null)}
        title="Exam feedback"
        maxWidth="max-w-lg"
      >
        {feedbackAttemptId && (
          <FeedbackFormCard
            attemptId={feedbackAttemptId}
            onSubmitted={() => {
              setFeedbackAttemptId(null);
              loadTranscript();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
