import React, { useEffect, useState } from 'react';
import { CheckCircle2, MessageSquarePlus, Star } from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { extractApiError } from '../../lib/format';
import { Button, Card, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const DIFFICULTY_OPTIONS = [
  { value: 'too_easy', label: 'Too easy' },
  { value: 'just_right', label: 'Balanced' },
  { value: 'challenging', label: 'Challenging' },
  { value: 'too_hard', label: 'Too hard' },
];

function StarPicker({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${label}: ${star} out of 5`}
            onClick={() => onChange(star)}
            className="p-0.5 rounded hover:scale-110 transition-transform"
          >
            <Star
              className={`h-4 w-4 ${
                star <= value
                  ? 'text-amber-500 fill-amber-400'
                  : 'text-zinc-300 dark:text-zinc-700'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedbackFormCard({ attemptId, questions = [], onSubmitted }) {
  const { notify } = useToast();
  const [existing, setExisting] = useState(null);
  const [overallRating, setOverallRating] = useState(5);
  const [clarityRating, setClarityRating] = useState(5);
  const [platformRating, setPlatformRating] = useState(5);
  const [difficulty, setDifficulty] = useState('just_right');
  const [flaggedQuestionId, setFlaggedQuestionId] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!attemptId) return;
    candidateApi
      .getAttemptFeedback(attemptId)
      .then((item) => {
        if (!item) return;
        setExisting(item);
        setOverallRating(item.overall_rating);
        setClarityRating(item.clarity_rating);
        setPlatformRating(item.platform_rating);
        setDifficulty(item.difficulty);
        setFlaggedQuestionId(item.flagged_question_id || '');
        setComments(item.comments || '');
      })
      .catch(() => {});
  }, [attemptId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await candidateApi.submitAttemptFeedback(attemptId, {
        overall_rating: overallRating,
        difficulty,
        clarity_rating: clarityRating,
        platform_rating: platformRating,
        comments: comments.trim() || null,
        flagged_question_id: flaggedQuestionId || null,
      });
      setExisting(saved);
      notify('Thank you — your exam feedback was recorded.', 'success');
      onSubmitted?.(saved);
    } catch (error) {
      notify(extractApiError(error, 'Could not submit feedback.'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-semibold">Post-exam feedback</h3>
        </div>
        {existing && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3.5">
          <StarPicker label="Overall experience" value={overallRating} onChange={setOverallRating} />
          <StarPicker label="Question clarity & fairness" value={clarityRating} onChange={setClarityRating} />
          <StarPicker label="Platform & compiler stability" value={platformRating} onChange={setPlatformRating} />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Perceived difficulty</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DIFFICULTY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDifficulty(opt.value)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  difficulty === opt.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {questions.length > 0 && (
          <Select
            label="Flag a specific question with an issue (optional)"
            value={flaggedQuestionId}
            onChange={(event) => setFlaggedQuestionId(event.target.value)}
          >
            <option value="">None</option>
            {questions.map((question) => (
              <option key={question.id || question.question_id} value={question.id || question.question_id}>
                Q{question.position}: {(question.prompt || '').slice(0, 72)}
              </option>
            ))}
          </Select>
        )}

        <Textarea
          label="Comments or suggestions (optional)"
          rows={3}
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Share any issues with questions, time limit, or technical experience…"
        />

        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={saving}>
            {existing ? 'Update feedback' : 'Submit feedback'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
