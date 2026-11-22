import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ClipboardList, Clock, FileCheck, Maximize2, Play, RotateCcw } from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { EXAM_STATUS_META, extractApiError, formatDateTime, formatDurationClock } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export default function CandidateDashboardPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    candidateApi
      .listEnrolledExams()
      .then(setExams)
      .catch((error) => notify(extractApiError(error, 'Failed to load enrolled exams.'), 'danger'))
      .finally(() => setLoading(false));
  }, [notify]);

  // Tick once per second only if there is an upcoming scheduled exam.
  useEffect(() => {
    const hasScheduled = exams.some((exam) => exam.status === 'scheduled');
    if (!hasScheduled) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [exams]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">My examinations</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Exams you are enrolled in appear below. Live exams can be started or resumed immediately.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : exams.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No enrolled examinations"
            description="When your administrator enrolls you or your batch in an exam, it will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => {
            const statusMeta = EXAM_STATUS_META[exam.status] || { label: exam.status, tone: 'neutral' };
            const startsInSeconds = Math.max(0, Math.floor((new Date(exam.starts_at).getTime() - nowMs) / 1000));
            const attempt = exam.attempt;

            return (
              <Card key={exam.id} className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{exam.title}</h2>
                      <Badge tone={statusMeta.tone} dot>
                        {statusMeta.label}
                      </Badge>
                      {attempt?.status === 'submitted' && <Badge tone="success">Submitted</Badge>}
                      {attempt?.status === 'in_progress' && <Badge tone="info">In progress</Badge>}
                    </div>

                    {exam.description && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">{exam.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {exam.duration_minutes} min
                      </span>
                      <span>{exam.question_count} questions</span>
                      <span>{exam.total_marks} marks</span>
                      <span>Window: {formatDateTime(exam.starts_at)} – {formatDateTime(exam.ends_at)}</span>
                      {exam.require_webcam && (
                        <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                          <Camera className="h-3.5 w-3.5" /> Camera required
                        </span>
                      )}
                      {exam.require_fullscreen && (
                        <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                          <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {attempt?.status === 'in_progress' && exam.status !== 'ended' && (
                      <Button onClick={() => navigate(`/candidate/attempts/${attempt.id}`)}>
                        <RotateCcw className="h-4 w-4" />
                        Resume exam
                      </Button>
                    )}

                    {!attempt && exam.status === 'live' && (
                      <Button onClick={() => navigate(`/candidate/exams/${exam.id}/check`)}>
                        <Play className="h-4 w-4" />
                        Start exam
                      </Button>
                    )}

                    {!attempt && exam.status === 'scheduled' && (
                      <div className="text-right">
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Starts in</div>
                        <div className="text-sm font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                          {formatDurationClock(startsInSeconds)}
                        </div>
                      </div>
                    )}

                    {attempt?.status === 'submitted' && exam.results_available && (
                      <Button variant="secondary" onClick={() => navigate(`/candidate/attempts/${attempt.id}/result`)}>
                        <FileCheck className="h-4 w-4" />
                        View result ({attempt.score}/{attempt.max_score})
                      </Button>
                    )}

                    {attempt?.status === 'submitted' && !exam.results_available && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Results pending publication</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
