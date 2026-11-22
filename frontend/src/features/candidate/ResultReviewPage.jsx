import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Printer, Scale, XCircle } from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { extractApiError, formatDateTime, QUESTION_KIND_LABELS } from '../../lib/format';
import { Badge, Button, Card, Modal, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { FeedbackFormCard } from './FeedbackFormCard';

function formatResponseDisplay(kind, value) {
  if (value === null || value === undefined || value === '') return 'Unanswered';
  if (kind === 'mcq_multi' && Array.isArray(value)) return value.join(', ') || 'Unanswered';
  if (kind === 'coding' && typeof value === 'object') return `[${value.language || 'code'}]\n${value.code || ''}`;
  return String(value);
}

export default function ResultReviewPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [result, setResult] = useState(null);
  const [regrades, setRegrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appealQuestion, setAppealQuestion] = useState(null);
  const [appealReason, setAppealReason] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);

  const loadResult = () => {
    Promise.all([candidateApi.getResult(attemptId), candidateApi.listAttemptRegrades(attemptId)])
      .then(([res, regradeList]) => {
        setResult(res);
        setRegrades(regradeList);
      })
      .catch((error) => {
        notify(extractApiError(error, 'Results are not available.'), 'danger');
        navigate('/candidate', { replace: true });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadResult();
  }, [attemptId]);

  const handleSubmitAppeal = async (event) => {
    event.preventDefault();
    if (!appealQuestion || appealReason.trim().length < 5) return;
    setSubmittingAppeal(true);
    try {
      await candidateApi.createRegradeRequest(attemptId, appealQuestion.question_id, appealReason.trim());
      notify('Regrade request submitted to invigilator.', 'success');
      setAppealQuestion(null);
      setAppealReason('');
      loadResult();
    } catch (error) {
      notify(extractApiError(error, 'Could not submit regrade request.'), 'danger');
    } finally {
      setSubmittingAppeal(false);
    }
  };

  if (loading || !result) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const regradeByQuestion = Object.fromEntries(regrades.map((item) => [item.question_id, item]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between no-print">
        <button
          type="button"
          onClick={() => navigate('/candidate')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to exams
        </button>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{result.exam_title}</h1>
            {result.grading_pending && <Badge tone="warning">Theory grading pending</Badge>}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Submitted {formatDateTime(result.submitted_at)}
          </p>
        </div>

        <div className="text-right tabular-nums">
          <div className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
            {result.score} / {result.max_score}
          </div>
          <div className="text-xs text-zinc-500">{result.percentage}%</div>
        </div>
      </Card>

      <div className="space-y-3">
        {result.questions.map((question) => {
          const existingAppeal = regradeByQuestion[question.question_id];
          return (
            <Card key={question.question_id} className="p-5 space-y-3 print-break-avoid">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-500 tabular-nums">Q{question.position}</span>
                  <Badge tone="neutral">{QUESTION_KIND_LABELS[question.kind] || question.kind}</Badge>
                  {existingAppeal && (
                    <Badge
                      tone={
                        existingAppeal.status === 'approved'
                          ? 'success'
                          : existingAppeal.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      Regrade {existingAppeal.status}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs font-medium tabular-nums">
                  {question.awarded_marks === null ? (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Clock className="h-3.5 w-3.5" /> Pending review
                    </span>
                  ) : question.is_correct ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> +{question.awarded_marks} / {question.max_marks}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="h-3.5 w-3.5" /> {question.awarded_marks} / {question.max_marks}
                    </span>
                  )}

                  {!existingAppeal && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="no-print"
                      onClick={() => {
                        setAppealQuestion(question);
                        setAppealReason('');
                      }}
                    >
                      <Scale className="h-3.5 w-3.5" /> Appeal
                    </Button>
                  )}
                </div>
              </div>

              <p className="text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{question.prompt}</p>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                  <div className="font-medium text-zinc-500 mb-1">Your response</div>
                  <pre className="whitespace-pre-wrap font-sans text-zinc-900 dark:text-zinc-100">
                    {formatResponseDisplay(question.kind, question.response)}
                  </pre>
                </div>
                {question.correct_answer !== null && question.correct_answer !== undefined && (
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                    <div className="font-medium text-zinc-500 mb-1">Correct answer</div>
                    <div className="text-zinc-900 dark:text-zinc-100">
                      {Array.isArray(question.correct_answer)
                        ? question.correct_answer.join(', ')
                        : String(question.correct_answer)}
                    </div>
                  </div>
                )}
              </div>

              {question.explanation && (
                <div className="rounded-md bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 px-3 py-2 text-xs text-indigo-950 dark:text-indigo-200">
                  <span className="font-semibold">Explanation / rubric: </span>
                  {question.explanation}
                </div>
              )}

              {question.feedback && (
                <div className="rounded-md bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-200">
                  <span className="font-semibold">Invigilator feedback: </span>
                  {question.feedback}
                </div>
              )}

              {existingAppeal?.resolution_note && (
                <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <span className="font-semibold">Regrade decision: </span>
                  {existingAppeal.resolution_note}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="no-print">
        <FeedbackFormCard attemptId={attemptId} questions={result.questions} />
      </div>

      <Modal
        open={Boolean(appealQuestion)}
        onClose={() => setAppealQuestion(null)}
        title={`Request regrade — Q${appealQuestion?.position || ''}`}
        description="Explain clearly why your answer deserves a review."
      >
        <form onSubmit={handleSubmitAppeal} className="space-y-4">
          <Textarea
            label="Reason for regrade"
            rows={4}
            value={appealReason}
            onChange={(event) => setAppealReason(event.target.value)}
            placeholder="Describe what was missed or why your response matches the rubric…"
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAppealQuestion(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={submittingAppeal} disabled={appealReason.trim().length < 5}>
              Submit appeal
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
