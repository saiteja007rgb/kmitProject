import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  Flag,
  Maximize2,
  PauseCircle,
  Send,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { candidateApi } from '../../api/endpoints';
import { useLiveSocket } from '../../hooks/useLiveSocket';
import { extractApiError, formatDateTime, formatDurationClock, QUESTION_KIND_LABELS } from '../../lib/format';
import { Badge, Button, Card, Input, Modal, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';
import { useBrowserLockdown } from '../proctoring/useBrowserLockdown';
import { useWebcamProctor } from '../proctoring/useWebcamProctor';
import { CameraPreview } from '../proctoring/CameraPreview';

const CodeQuestionEditor = lazy(() => import('./CodeQuestionEditor'));

function isAnswered(question, responseValue) {
  if (responseValue === null || responseValue === undefined) return false;
  if (question.kind === 'mcq_multi') return Array.isArray(responseValue) && responseValue.length > 0;
  if (question.kind === 'coding') return Boolean(responseValue?.code?.trim());
  return String(responseValue).trim() !== '';
}

function offlineQueueKey(attemptId) {
  return `exampulse_offline_queue_${attemptId}`;
}

export default function ExamRoomPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [attempt, setAttempt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answersByQuestion, setAnswersByQuestion] = useState({});
  const [saveState, setSaveState] = useState('saved'); // saved | saving | offline
  const [examStatus, setExamStatus] = useState('live');
  const [violationCount, setViolationCount] = useState(0);
  const [announcements, setAnnouncements] = useState([]);
  const [dismissedAnnouncementId, setDismissedAnnouncementId] = useState(null);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);

  // Monotonic timer anchor: uses performance.now() deltas, never Date.now(), so OS clock changes have zero effect.
  const timerAnchorRef = useRef({ remainingSeconds: 0, anchoredAtMs: performance.now() });
  const [displaySeconds, setDisplaySeconds] = useState(null);
  const warnedThresholdsRef = useRef(new Set());
  const debounceTimersRef = useRef({});

  // Code runner state per question.
  const [runningCode, setRunningCode] = useState(false);
  const [codeResultsByQuestion, setCodeResultsByQuestion] = useState({});

  const syncTimerFromServer = useCallback((remainingSeconds) => {
    const safe = Math.max(0, Math.floor(remainingSeconds ?? 0));
    timerAnchorRef.current = { remainingSeconds: safe, anchoredAtMs: performance.now() };
    setDisplaySeconds(safe);
  }, []);

  // Load initial attempt state and merge any unsent offline drafts.
  useEffect(() => {
    let cancelled = false;
    candidateApi
      .getAttempt(attemptId)
      .then((data) => {
        if (cancelled) return;
        setAttempt(data);
        setExamStatus(data.exam.status);
        setViolationCount(data.violation_count);
        setAnnouncements(data.announcements || []);
        syncTimerFromServer(data.remaining_seconds);

        const initialMap = {};
        for (const answer of data.answers || []) {
          initialMap[answer.question_id] = {
            response: answer.response,
            isFlagged: answer.is_flagged,
            version: answer.version,
          };
        }

        // Restore queued offline edits if newer than server state.
        try {
          const queued = JSON.parse(localStorage.getItem(offlineQueueKey(attemptId)) || '{}');
          for (const [qId, item] of Object.entries(queued)) {
            if (!initialMap[qId] || item.version > initialMap[qId].version) {
              initialMap[qId] = item;
            }
          }
        } catch {
          // Ignore corrupted storage.
        }
        setAnswersByQuestion(initialMap);

        if (data.status === 'submitted') {
          candidateApi.submitAttempt(attemptId).then((res) => !cancelled && setReceipt(res)).catch(() => {});
        }
      })
      .catch((error) => {
        notify(extractApiError(error, 'Failed to open exam session.'), 'danger');
        navigate('/candidate', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attemptId, navigate, notify, syncTimerFromServer]);

  const isRunning = Boolean(attempt && !receipt && attempt.status === 'in_progress');
  const isPaused = examStatus === 'paused';

  const handleFinalSubmit = useCallback(async () => {
    if (submitting || receipt) return;
    setSubmitting(true);
    try {
      const result = await candidateApi.submitAttempt(attemptId);
      localStorage.removeItem(offlineQueueKey(attemptId));
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setReceipt(result);
      setSubmitModalOpen(false);
    } catch (error) {
      notify(extractApiError(error, 'Submission failed. Please retry.'), 'danger');
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, notify, receipt, submitting]);

  // Monotonic 1s UI countdown (frozen while exam is paused).
  useEffect(() => {
    if (!isRunning || displaySeconds === null || isPaused) return undefined;
    const interval = window.setInterval(() => {
      const elapsedSeconds = Math.floor((performance.now() - timerAnchorRef.current.anchoredAtMs) / 1000);
      const nextSeconds = Math.max(0, timerAnchorRef.current.remainingSeconds - elapsedSeconds);
      setDisplaySeconds(nextSeconds);

      for (const threshold of [600, 300, 60]) {
        if (nextSeconds <= threshold && nextSeconds > 0 && !warnedThresholdsRef.current.has(threshold)) {
          warnedThresholdsRef.current.add(threshold);
          notify(`${Math.ceil(threshold / 60)} minute(s) remaining.`, 'warning');
        }
      }
      if (nextSeconds <= 0) {
        handleFinalSubmit();
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [displaySeconds, handleFinalSubmit, isPaused, isRunning, notify]);

  // Persist answer to server; queue in localStorage on network drop.
  const persistAnswer = useCallback(
    async (questionId, entry) => {
      setSaveState('saving');
      try {
        await candidateApi.saveAnswer(attemptId, questionId, entry.response, entry.isFlagged, entry.version);
        // Remove from offline queue if present.
        try {
          const queued = JSON.parse(localStorage.getItem(offlineQueueKey(attemptId)) || '{}');
          if (queued[questionId] && queued[questionId].version <= entry.version) {
            delete queued[questionId];
            localStorage.setItem(offlineQueueKey(attemptId), JSON.stringify(queued));
          }
        } catch {
          // Ignore storage errors.
        }
        setSaveState('saved');
      } catch (error) {
        const statusCode = error?.response?.status;
        if (statusCode === 423) {
          setExamStatus('paused');
          setSaveState('saved');
          return;
        }
        if (statusCode === 403) {
          notify('Examination time has expired.', 'danger');
          handleFinalSubmit();
          return;
        }
        try {
          const queued = JSON.parse(localStorage.getItem(offlineQueueKey(attemptId)) || '{}');
          queued[questionId] = entry;
          localStorage.setItem(offlineQueueKey(attemptId), JSON.stringify(queued));
        } catch {
          // Ignore quota errors.
        }
        setSaveState('offline');
      }
    },
    [attemptId, handleFinalSubmit, notify]
  );

  const flushOfflineQueue = useCallback(async () => {
    try {
      const queued = JSON.parse(localStorage.getItem(offlineQueueKey(attemptId)) || '{}');
      const entries = Object.entries(queued);
      if (entries.length === 0) return;
      for (const [questionId, entry] of entries) {
        await persistAnswer(questionId, entry);
      }
    } catch {
      // Ignore parse errors.
    }
  }, [attemptId, persistAnswer]);

  // 15-second heartbeat resyncs timer, detects pause/submission, and flushes queued answers.
  useEffect(() => {
    if (!isRunning) return undefined;
    const sendHeartbeat = async () => {
      try {
        const beat = await candidateApi.heartbeat(attemptId);
        setExamStatus(beat.exam_status);
        setViolationCount(beat.violation_count);
        syncTimerFromServer(beat.remaining_seconds);
        if (beat.status === 'submitted') {
          handleFinalSubmit();
          return;
        }
        flushOfflineQueue();
      } catch {
        // Stay resilient during transient network loss.
      }
    };
    const timer = window.setInterval(sendHeartbeat, 15000);
    window.addEventListener('online', flushOfflineQueue);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', flushOfflineQueue);
    };
  }, [attemptId, flushOfflineQueue, handleFinalSubmit, isRunning, syncTimerFromServer]);

  // Real-time WebSocket for announcements, pause/resume, deadline extensions, force-submit.
  const wsStatus = useLiveSocket(
    isRunning ? `/ws/candidate/attempts/${attemptId}` : null,
    (message) => {
      if (message.type === 'exam_status_changed') {
        setExamStatus(message.status);
        if (message.status === 'paused') notify('Exam paused by invigilator.', 'warning');
        if (message.status === 'live') notify('Exam resumed. Timer extended for pause duration.', 'info');
      } else if (message.type === 'deadline_changed') {
        syncTimerFromServer(message.remaining_seconds);
        notify('Your examination deadline has been updated.', 'info');
      } else if (message.type === 'announcement') {
        setAnnouncements((prev) => [
          { id: message.id, message: message.message, created_at: message.created_at },
          ...prev,
        ]);
        setDismissedAnnouncementId(null);
        notify(`Announcement: ${message.message}`, 'info', 7000);
      } else if (message.type === 'attempt_submitted') {
        handleFinalSubmit();
      }
    },
    isRunning
  );

  // Proctoring event reporter (shared by lockdown + webcam face detector).
  const reportProctoringEvent = useCallback(
    async (kind, detail) => {
      if (!isRunning || isPaused) return;
      try {
        const result = await candidateApi.recordEvent(attemptId, kind, detail);
        setViolationCount(result.violation_count);
        if (result.auto_submitted) {
          notify(result.message, 'danger', 8000);
          handleFinalSubmit();
        } else {
          notify(result.message, 'warning');
        }
      } catch {
        // Ignore transient errors while logging.
      }
    },
    [attemptId, handleFinalSubmit, isPaused, isRunning, notify]
  );

  const uploadSnapshot = useCallback(
    async (blob, reason, faceCount) => {
      if (!isRunning || isPaused) return;
      try {
        await candidateApi.uploadSnapshot(attemptId, blob, reason, faceCount);
      } catch {
        // Non-blocking.
      }
    },
    [attemptId, isPaused, isRunning]
  );

  useBrowserLockdown({
    enabled: isRunning && !isPaused,
    requireFullscreen: Boolean(attempt?.exam?.require_fullscreen),
    onEvent: reportProctoringEvent,
  });

  const webcam = useWebcamProctor({
    enabled: Boolean(isRunning && attempt?.exam?.require_webcam),
    reportViolations: !isPaused,
    onViolation: reportProctoringEvent,
    onSnapshot: uploadSnapshot,
  });

  const questions = attempt?.questions || [];
  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? answersByQuestion[currentQuestion.id] : null;

  const updateAnswer = useCallback(
    (questionId, updater, immediate = false) => {
      if (isPaused || !isRunning) return;
      setAnswersByQuestion((prev) => {
        const existing = prev[questionId] || { response: null, isFlagged: false, version: 0 };
        const patch = typeof updater === 'function' ? updater(existing) : updater;
        const nextEntry = {
          response: patch.response !== undefined ? patch.response : existing.response,
          isFlagged: patch.isFlagged !== undefined ? patch.isFlagged : existing.isFlagged,
          version: existing.version + 1,
        };

        window.clearTimeout(debounceTimersRef.current[questionId]);
        if (immediate) {
          persistAnswer(questionId, nextEntry);
        } else {
          setSaveState('saving');
          debounceTimersRef.current[questionId] = window.setTimeout(() => {
            persistAnswer(questionId, nextEntry);
          }, 600);
        }
        return { ...prev, [questionId]: nextEntry };
      });
    },
    [isPaused, isRunning, persistAnswer]
  );

  // Keyboard shortcuts: Left/Right navigate, 1-9 choose option, F toggles flag (disabled inside inputs/editor).
  useEffect(() => {
    if (!isRunning || isPaused || !currentQuestion) return undefined;
    const handleKeyDown = (event) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.closest?.('.cm-editor');
      if (isEditing || event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'ArrowRight' && currentIndex < questions.length - 1) {
        setCurrentIndex((index) => index + 1);
      } else if (event.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((index) => index - 1);
      } else if (event.key.toLowerCase() === 'f') {
        updateAnswer(currentQuestion.id, (prev) => ({ isFlagged: !prev.isFlagged }), true);
      } else if (/^[1-9]$/.test(event.key) && ['mcq_single', 'true_false'].includes(currentQuestion.kind)) {
        const option = currentQuestion.options[Number(event.key) - 1];
        if (option) {
          updateAnswer(currentQuestion.id, { response: option.id }, true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, currentQuestion, isPaused, isRunning, questions.length, updateAnswer]);

  const counts = useMemo(() => {
    let answered = 0;
    let flagged = 0;
    for (const q of questions) {
      const entry = answersByQuestion[q.id];
      if (entry && isAnswered(q, entry.response)) answered += 1;
      if (entry?.isFlagged) flagged += 1;
    }
    return { answered, flagged, unanswered: Math.max(0, questions.length - answered) };
  }, [answersByQuestion, questions]);

  const handleRunCode = async (language, code, customInput) => {
    if (!currentQuestion) return;
    setRunningCode(true);
    try {
      const result = await candidateApi.runCode(attemptId, currentQuestion.id, language, code, customInput);
      setCodeResultsByQuestion((prev) => ({ ...prev, [currentQuestion.id]: result }));
    } catch (error) {
      notify(extractApiError(error, 'Code execution failed.'), 'danger');
    } finally {
      setRunningCode(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (receipt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
        <Card className="w-full max-w-lg p-6 space-y-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Examination submitted</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Your responses have been recorded and locked.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Receipt ID</dt>
              <dd className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{receipt.receipt_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Submitted at</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">{formatDateTime(receipt.submitted_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Answered</dt>
              <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {receipt.answered_count} / {receipt.total_questions}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Reason</dt>
              <dd className="font-medium capitalize text-zinc-900 dark:text-zinc-100">
                {receipt.submit_reason.replace('_', ' ')}
              </dd>
            </div>
            {receipt.results_visible && (
              <div className="col-span-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <dt className="text-xs text-zinc-500">Score</dt>
                <dd className="text-xl font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                  {receipt.score} / {receipt.max_score}
                </dd>
              </div>
            )}
          </dl>

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate('/candidate', { replace: true })}>
              Back to dashboard
            </Button>
            {receipt.results_visible && (
              <Button onClick={() => navigate(`/candidate/attempts/${attemptId}/result`, { replace: true })}>
                Review solutions
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const latestAnnouncement = announcements[0];
  const timerToneClass =
    displaySeconds !== null && displaySeconds < 300
      ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40'
      : displaySeconds !== null && displaySeconds < 600
        ? 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40'
        : 'text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60';

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Top sticky exam header */}
      <header className="sticky top-0 z-30 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">{attempt?.exam?.title}</h1>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              {wsStatus === 'connected' ? (
                <Wifi className="h-3 w-3 text-emerald-500" />
              ) : (
                <WifiOff className="h-3 w-3 text-amber-500" />
              )}
              {wsStatus === 'connected' ? 'Live' : 'Syncing'}
            </span>
            <span className="inline-flex items-center gap-1">
              {saveState === 'offline' ? (
                <>
                  <CloudOff className="h-3 w-3 text-amber-500" /> Offline — queued
                </>
              ) : saveState === 'saving' ? (
                'Saving…'
              ) : (
                'Saved'
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {attempt?.exam?.require_fullscreen && !document.fullscreenElement && (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Fullscreen
            </Button>
          )}

          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold tabular-nums ${timerToneClass}`}
          >
            <Clock className="h-4 w-4" />
            <span>{formatDurationClock(displaySeconds)}</span>
          </div>

          <Button size="sm" onClick={() => setSubmitModalOpen(true)} disabled={isPaused}>
            <Send className="h-3.5 w-3.5" />
            Submit
          </Button>
        </div>
      </header>

      {/* Integrity alert banner */}
      {violationCount > 0 && (
        <div className="border-b border-red-200 dark:border-red-900 bg-red-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Integrity alert: {violationCount} event(s) recorded and logged for invigilator review.
          </span>
          <span className="tabular-nums opacity-90">
            {Math.max(0, (attempt?.exam?.max_violations || 5) - violationCount)} remaining before auto-submit
          </span>
        </div>
      )}

      {/* Latest live announcement banner */}
      {latestAnnouncement && latestAnnouncement.id !== dismissedAnnouncementId && (
        <div className="border-b border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/60 px-4 py-2 text-xs text-indigo-900 dark:text-indigo-200 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 shrink-0" />
            <strong>Invigilator:</strong> {latestAnnouncement.message}
          </span>
          <button
            type="button"
            className="text-indigo-700 dark:text-indigo-300 hover:underline shrink-0"
            onClick={() => setDismissedAnnouncementId(latestAnnouncement.id)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main split workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 grid lg:grid-cols-[1fr_270px] gap-5">
        {/* Active question card */}
        {currentQuestion && (
          <Card className="p-5 sm:p-6 flex flex-col justify-between">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Question {currentIndex + 1} of {questions.length}
                  </span>
                  <Badge tone="neutral">{QUESTION_KIND_LABELS[currentQuestion.kind] || currentQuestion.kind}</Badge>
                  <Badge tone="info">{currentQuestion.marks} marks</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={currentAnswer?.isFlagged ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() =>
                      updateAnswer(currentQuestion.id, (prev) => ({ isFlagged: !prev.isFlagged }), true)
                    }
                  >
                    <Flag
                      className={`h-3.5 w-3.5 ${currentAnswer?.isFlagged ? 'text-amber-500 fill-amber-500' : ''}`}
                    />
                    {currentAnswer?.isFlagged ? 'Flagged' : 'Flag'}
                  </Button>
                  {isAnswered(currentQuestion, currentAnswer?.response) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => updateAnswer(currentQuestion.id, { response: null }, true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              <div className="text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                {currentQuestion.prompt}
              </div>

              {/* Kind-specific response renderer */}
              {(currentQuestion.kind === 'mcq_single' || currentQuestion.kind === 'true_false') && (
                <div className="space-y-2">
                  {currentQuestion.options.map((option, idx) => {
                    const selected = currentAnswer?.response === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isPaused}
                        onClick={() => updateAnswer(currentQuestion.id, { response: option.id }, true)}
                        className={`w-full text-left flex items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                          selected
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-zinc-900 dark:text-zinc-100'
                            : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                            selected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-zinc-300 dark:border-zinc-600 text-zinc-500'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="leading-snug">{option.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.kind === 'mcq_multi' && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Select all options that apply.</p>
                  {currentQuestion.options.map((option) => {
                    const selectedList = Array.isArray(currentAnswer?.response) ? currentAnswer.response : [];
                    const checked = selectedList.includes(option.id);
                    const toggleOption = () => {
                      const next = checked
                        ? selectedList.filter((item) => item !== option.id)
                        : [...selectedList, option.id];
                      updateAnswer(currentQuestion.id, { response: next }, true);
                    };
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={isPaused}
                        onClick={toggleOption}
                        className={`w-full text-left flex items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                          checked
                            ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40'
                            : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600"
                        />
                        <span className="leading-snug">{option.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.kind === 'numeric' && (
                <div className="max-w-xs">
                  <Input
                    label="Numeric answer"
                    type="text"
                    inputMode="decimal"
                    disabled={isPaused}
                    value={currentAnswer?.response ?? ''}
                    onChange={(event) => updateAnswer(currentQuestion.id, { response: event.target.value }, false)}
                    placeholder="e.g. 0.037"
                  />
                </div>
              )}

              {currentQuestion.kind === 'short_text' && (
                <div className="max-w-lg">
                  <Input
                    label="Short answer"
                    disabled={isPaused}
                    value={currentAnswer?.response ?? ''}
                    onChange={(event) => updateAnswer(currentQuestion.id, { response: event.target.value }, false)}
                    placeholder="Type a concise answer"
                  />
                </div>
              )}

              {currentQuestion.kind === 'theory' && (
                <div className="space-y-1.5">
                  <Textarea
                    label="Written response"
                    rows={9}
                    disabled={isPaused}
                    value={currentAnswer?.response ?? ''}
                    onChange={(event) => updateAnswer(currentQuestion.id, { response: event.target.value }, false)}
                    placeholder="Write your complete explanation here..."
                  />
                  <div className="text-right text-xs text-zinc-500 tabular-nums">
                    {String(currentAnswer?.response || '')
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean).length}{' '}
                    words
                  </div>
                </div>
              )}

              {currentQuestion.kind === 'coding' && (
                <Suspense
                  fallback={
                    <div className="h-80 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 rounded-lg">
                      <Spinner />
                    </div>
                  }
                >
                  <CodeQuestionEditor
                    codingSpec={currentQuestion.coding}
                    value={currentAnswer?.response}
                    onChange={(nextValue) => updateAnswer(currentQuestion.id, { response: nextValue }, false)}
                    onRunCode={handleRunCode}
                    running={runningCode}
                    runResult={codeResultsByQuestion[currentQuestion.id]}
                    disabled={isPaused}
                  />
                </Suspense>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="hidden sm:inline text-[11px] text-zinc-400">
                Shortcuts: &larr;/&rarr; navigate &middot; 1-9 select &middot; F flag
              </span>
              {currentIndex < questions.length - 1 ? (
                <Button onClick={() => setCurrentIndex((idx) => Math.min(questions.length - 1, idx + 1))}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => setSubmitModalOpen(true)} disabled={isPaused}>
                  Review &amp; submit
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Right rail: question palette + webcam preview */}
        <aside className="space-y-4">
          {attempt?.exam?.require_webcam && (
            <CameraPreview
              compact
              videoRef={webcam.videoRef}
              cameraState={webcam.cameraState}
              detectorReady={webcam.detectorReady}
              gazeStatus={webcam.gazeStatus}
              errorMessage={webcam.errorMessage}
            />
          )}

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Question palette
              </h2>
              <span className="text-xs tabular-nums text-zinc-500">
                {counts.answered}/{questions.length}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {questions.map((question, idx) => {
                const entry = answersByQuestion[question.id];
                const answered = entry && isAnswered(question, entry.response);
                const flagged = Boolean(entry?.isFlagged);
                const isCurrent = idx === currentIndex;

                let cellClass =
                  'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300';
                if (answered) {
                  cellClass =
                    'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300';
                }
                if (flagged) {
                  cellClass =
                    'border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300';
                }
                if (isCurrent) {
                  cellClass = 'border-indigo-600 bg-indigo-600 text-white';
                }

                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-8 rounded-md border text-xs font-semibold tabular-nums transition-colors ${cellClass}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
              <span>Answered: {counts.answered}</span>
              <span>Flagged: {counts.flagged}</span>
              <span>Left: {counts.unanswered}</span>
            </div>
          </Card>
        </aside>
      </div>

      {/* Pause overlay */}
      {isPaused && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm">
          <Card className="max-w-md w-full p-6 text-center space-y-3">
            <PauseCircle className="h-9 w-9 text-amber-500 mx-auto" />
            <h2 className="text-base font-semibold">Exam paused by invigilator</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Your timer is frozen at <span className="font-semibold tabular-nums">{formatDurationClock(displaySeconds)}</span>.
              Stay on this screen until the invigilator resumes the examination.
            </p>
          </Card>
        </div>
      )}

      {/* Submit confirmation modal */}
      <Modal
        open={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        title="Submit examination?"
        description="Once submitted, your answers are locked and evaluated immediately."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubmitModalOpen(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button onClick={handleFinalSubmit} loading={submitting}>
              Confirm submission
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-lg font-semibold tabular-nums text-emerald-600">{counts.answered}</div>
            <div className="text-xs text-zinc-500">Answered</div>
          </div>
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-lg font-semibold tabular-nums text-amber-600">{counts.flagged}</div>
            <div className="text-xs text-zinc-500">Flagged</div>
          </div>
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-lg font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{counts.unanswered}</div>
            <div className="text-xs text-zinc-500">Unanswered</div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
