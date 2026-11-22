import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, FileSpreadsheet, Pause, Pencil, Play, Square } from 'lucide-react';
import { adminExamsApi, adminMonitorApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { EXAM_STATUS_META, extractApiError, formatDateTime } from '../../lib/format';
import { Badge, Button, ConfirmDialog, Input, Modal, Spinner, Tabs } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { LiveMonitorTab } from './LiveMonitorTab';
import { EnrollmentsTab } from './EnrollmentsTab';
import { GradingTab } from './GradingTab';
import { AnalyticsTab } from './AnalyticsTab';
import { ResultsIntegrityTab } from './ResultsIntegrityTab';
import { AnnouncementsTab } from './AnnouncementsTab';
import { FeedbackTab } from './FeedbackTab';
import { RegradesTab } from './RegradesTab';

export default function ExamWorkspacePage() {
  const { examId } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const { notify } = useToast();

  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('live');
  const [lifecycleConfirm, setLifecycleConfirm] = useState(null);
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [working, setWorking] = useState(false);

  const loadExam = useCallback(async () => {
    try {
      const detail = await adminExamsApi.getExam(examId);
      setExam(detail);
    } catch (error) {
      notify(extractApiError(error), 'danger');
      navigate('/admin/exams', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [examId, navigate, notify]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  const handleLifecycle = async () => {
    if (!lifecycleConfirm) return;
    setWorking(true);
    try {
      const updated = await adminExamsApi.lifecycleAction(exam.id, lifecycleConfirm);
      setExam((prev) => ({ ...prev, ...updated }));
      setLifecycleConfirm(null);
      notify(`Exam status is now ${updated.status}.`, 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  const handleExtendAll = async () => {
    setWorking(true);
    try {
      const res = await adminExamsApi.extendAllAttempts(exam.id, Number(extendMinutes));
      setExtendModalOpen(false);
      notify(`Extended ${res.sessions_extended} active session(s) by ${extendMinutes} min.`, 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setWorking(false);
    }
  };

  if (loading || !exam) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const statusMeta = EXAM_STATUS_META[exam.status] || { label: exam.status, tone: 'neutral' };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/exams')}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to exams
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{exam.title}</h1>
            <Badge tone={statusMeta.tone} dot>
              {statusMeta.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            {exam.question_count} questions &middot; {exam.total_marks} marks &middot; {exam.duration_minutes} min &middot;{' '}
            {formatDateTime(exam.starts_at)} – {formatDateTime(exam.ends_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {exam.status === 'draft' && (
            <Button size="sm" onClick={() => setLifecycleConfirm('publish')}>
              <Play className="h-3.5 w-3.5" /> Publish
            </Button>
          )}
          {exam.status === 'live' && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setExtendModalOpen(true)}>
                <Clock className="h-3.5 w-3.5" /> Extend all
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setLifecycleConfirm('pause')}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            </>
          )}
          {exam.status === 'paused' && (
            <Button size="sm" onClick={() => setLifecycleConfirm('resume')}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {(exam.status === 'live' || exam.status === 'paused') && (
            <Button size="sm" variant="dangerOutline" onClick={() => setLifecycleConfirm('end')}>
              <Square className="h-3.5 w-3.5" /> End exam
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                const blob = await adminMonitorApi.downloadMarksXlsx(exam.id);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `marks-${exam.id.slice(0, 8)}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                notify('Marks Excel workbook downloaded.', 'success');
              } catch (error) {
                notify(extractApiError(error), 'danger');
              }
            }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export Marks (.xlsx)
          </Button>
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/exams/${exam.id}/edit`)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { value: 'live', label: 'Live monitor', badge: exam.in_progress_count },
          { value: 'enrollments', label: 'Enrollments', badge: exam.enrolled_count },
          { value: 'grading', label: 'Grading' },
          { value: 'regrades', label: 'Regrades' },
          { value: 'analytics', label: 'Analytics' },
          { value: 'results', label: 'Results & integrity', badge: exam.submitted_count },
          { value: 'feedback', label: 'Feedback' },
          { value: 'announcements', label: 'Announcements' },
        ]}
      />

      {activeTab === 'live' && (
        <LiveMonitorTab
          examId={exam.id}
          onExamSummaryUpdated={(summary) => setExam((prev) => ({ ...prev, ...summary }))}
        />
      )}
      {activeTab === 'enrollments' && <EnrollmentsTab examId={exam.id} />}
      {activeTab === 'grading' && <GradingTab examId={exam.id} />}
      {activeTab === 'regrades' && <RegradesTab examId={exam.id} />}
      {activeTab === 'analytics' && <AnalyticsTab examId={exam.id} />}
      {activeTab === 'results' && (
        <ResultsIntegrityTab
          exam={exam}
          onExamUpdated={(updated) => setExam((prev) => ({ ...prev, ...updated }))}
        />
      )}
      {activeTab === 'feedback' && <FeedbackTab examId={exam.id} />}
      {activeTab === 'announcements' && <AnnouncementsTab examId={exam.id} />}

      <ConfirmDialog
        open={Boolean(lifecycleConfirm)}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={handleLifecycle}
        loading={working}
        danger={lifecycleConfirm === 'end'}
        confirmLabel={lifecycleConfirm === 'end' ? 'End exam & submit all' : `Confirm ${lifecycleConfirm || ''}`}
        title={`Confirm ${lifecycleConfirm || ''}?`}
        message={
          lifecycleConfirm === 'end'
            ? 'All in-progress candidate attempts will be auto-submitted immediately.'
            : lifecycleConfirm === 'pause'
              ? 'Candidate timers will freeze and answer saves will pause until you resume.'
              : lifecycleConfirm === 'resume'
                ? 'Active deadlines will be extended automatically by the paused duration.'
                : 'Publishing makes this exam visible to all enrolled candidates.'
        }
      />

      <Modal
        open={extendModalOpen}
        onClose={() => setExtendModalOpen(false)}
        title="Extend time for all active candidates"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExtendModalOpen(false)}>
              Cancel
            </Button>
            <Button loading={working} onClick={handleExtendAll}>
              Extend all
            </Button>
          </>
        }
      >
        <Input
          label="Additional minutes"
          type="number"
          min={1}
          max={180}
          value={extendMinutes}
          onChange={(event) => setExtendMinutes(event.target.value)}
        />
      </Modal>
    </div>
  );
}

