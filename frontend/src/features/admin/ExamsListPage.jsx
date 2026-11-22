import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Copy,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
} from 'lucide-react';
import { adminExamsApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { EXAM_STATUS_META, extractApiError, formatDateTime } from '../../lib/format';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  TableShell,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export default function ExamsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const { notify } = useToast();

  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState(null); // { type, exam, action? }
  const [working, setWorking] = useState(false);

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      setExams(await adminExamsApi.listExams());
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  const handleDuplicate = async (exam) => {
    try {
      const clone = await adminExamsApi.duplicateExam(exam.id);
      notify(`Created draft copy "${clone.title}".`, 'success');
      loadExams();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  const handleConfirm = async () => {
    if (!confirmState) return;
    setWorking(true);
    try {
      if (confirmState.type === 'delete') {
        await adminExamsApi.deleteExam(confirmState.exam.id);
        notify('Exam deleted.', 'success');
      } else if (confirmState.type === 'lifecycle') {
        await adminExamsApi.lifecycleAction(confirmState.exam.id, confirmState.action);
        notify(`Exam ${confirmState.action} completed.`, 'success');
      }
      setConfirmState(null);
      loadExams();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Examinations</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Author assessments, control live status, enroll candidates, and inspect results.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => navigate('/admin/exams/new')}>
            <Plus className="h-4 w-4" />
            Create exam
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : exams.length === 0 ? (
        <TableShell>
          <tbody>
            <tr>
              <td>
                <EmptyState
                  icon={ClipboardList}
                  title="No examinations created"
                  description="Create your first exam with MCQ, theory, or coding questions."
                  action={
                    isAdmin && (
                      <Button onClick={() => navigate('/admin/exams/new')}>
                        <Plus className="h-4 w-4" /> Create exam
                      </Button>
                    )
                  }
                />
              </td>
            </tr>
          </tbody>
        </TableShell>
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Exam</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Schedule</th>
              <th className="px-4 py-3 text-left font-medium">Attendance</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {exams.map((exam) => {
              const statusMeta = EXAM_STATUS_META[exam.status] || { label: exam.status, tone: 'neutral' };
              return (
                <tr key={exam.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/exams/${exam.id}`}
                      className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600"
                    >
                      {exam.title}
                    </Link>
                    <div className="text-xs text-zinc-500 tabular-nums">
                      {exam.question_count} questions &middot; {exam.total_marks} marks &middot; {exam.duration_minutes} min
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusMeta.tone} dot>
                      {statusMeta.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 tabular-nums">
                    <div>{formatDateTime(exam.starts_at)}</div>
                    <div>to {formatDateTime(exam.ends_at)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300 tabular-nums">
                    <div>{exam.enrolled_count} enrolled</div>
                    <div className="text-zinc-500">
                      {exam.in_progress_count} live &middot; {exam.submitted_count} done
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button size="xs" variant="secondary" onClick={() => navigate(`/admin/exams/${exam.id}`)}>
                        <Radio className="h-3.5 w-3.5" />
                        Open
                      </Button>

                      {exam.status === 'draft' && (
                        <IconButton
                          label="Publish exam"
                          onClick={() => setConfirmState({ type: 'lifecycle', exam, action: 'publish' })}
                        >
                          <Play className="h-3.5 w-3.5 text-emerald-600" />
                        </IconButton>
                      )}
                      {exam.status === 'live' && (
                        <IconButton
                          label="Pause exam"
                          onClick={() => setConfirmState({ type: 'lifecycle', exam, action: 'pause' })}
                        >
                          <Pause className="h-3.5 w-3.5 text-amber-600" />
                        </IconButton>
                      )}
                      {exam.status === 'paused' && (
                        <IconButton
                          label="Resume exam"
                          onClick={() => setConfirmState({ type: 'lifecycle', exam, action: 'resume' })}
                        >
                          <Play className="h-3.5 w-3.5 text-emerald-600" />
                        </IconButton>
                      )}
                      {(exam.status === 'live' || exam.status === 'paused') && (
                        <IconButton
                          label="End exam now"
                          onClick={() => setConfirmState({ type: 'lifecycle', exam, action: 'end' })}
                        >
                          <Square className="h-3.5 w-3.5 text-red-600" />
                        </IconButton>
                      )}

                      {isAdmin && (
                        <>
                          <IconButton label="Edit exam" onClick={() => navigate(`/admin/exams/${exam.id}/edit`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton label="Duplicate exam" onClick={() => handleDuplicate(exam)}>
                            <Copy className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Delete exam"
                            className="hover:text-red-600"
                            onClick={() => setConfirmState({ type: 'delete', exam })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirm}
        loading={working}
        danger={confirmState?.type === 'delete' || confirmState?.action === 'end'}
        confirmLabel={
          confirmState?.type === 'delete'
            ? 'Delete exam'
            : confirmState?.action === 'end'
              ? 'End exam & submit all'
              : `Confirm ${confirmState?.action || ''}`
        }
        title={
          confirmState?.type === 'delete'
            ? `Delete "${confirmState?.exam?.title}"?`
            : `${(confirmState?.action || '').toUpperCase()} "${confirmState?.exam?.title}"?`
        }
        message={
          confirmState?.type === 'delete'
            ? 'Permanently delete this exam and all its questions? Exams with candidate attempts cannot be deleted.'
            : confirmState?.action === 'end'
              ? 'Ending this exam immediately auto-submits all in-progress candidate attempts.'
              : confirmState?.action === 'pause'
                ? 'Pausing freezes candidate timers and temporarily blocks answer edits until resumed.'
                : confirmState?.action === 'resume'
                  ? 'Resuming automatically extends every in-progress deadline by the paused duration.'
                  : 'Publishing makes this exam visible to enrolled candidates (live once the start time is reached).'
        }
      />
    </div>
  );
}
