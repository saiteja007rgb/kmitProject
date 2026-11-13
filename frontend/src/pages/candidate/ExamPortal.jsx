import React, { useState, useEffect, useRef, useCallback } from 'react';
import { examAPI } from '../../services/api';
import {
  Clock, AlertTriangle, CheckCircle, Save, RotateCcw,
  ChevronLeft, ChevronRight, Flag, Send, Award, Eye, XCircle, BookOpen
} from 'lucide-react';

export default function ExamPortal({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { qId: { answer: 'A', isMarked: false, version: 1 } }
  const [autosaveState, setAutosaveState] = useState('saved'); // 'saved', 'saving', 'error'
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [violationCount, setViolationCount] = useState(0);
  const [showViolationModal, setShowViolationModal] = useState(false);
  const [violationAutoSubmitted, setViolationAutoSubmitted] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const [reviewTab, setReviewTab] = useState('score'); // 'score' | 'review'
  const [loadingReview, setLoadingReview] = useState(false);

  // 1. Initial Load: Fetch questions & prior saved answers
  useEffect(() => {
    async function loadExamData() {
      try {
        setLoading(true);
        // Check if already submitted
        if (session.status === 'submitted') {
          const sub = await examAPI.getSubmission(session.session_id);
          setSubmissionResult(sub);
          setLoading(false);
          return;
        }

        const [qData, aData, statusData] = await Promise.all([
          examAPI.getQuestions(session.session_id),
          examAPI.getAnswers(session.session_id),
          examAPI.getSessionStatus(session.session_id),
        ]);

        setQuestions(qData);
        setRemainingSeconds(statusData.remaining_seconds);

        // Populate answers map
        const ansMap = {};
        aData.forEach((a) => {
          ansMap[a.question_id] = {
            answer: a.selected_answer,
            isMarked: a.is_marked_for_review,
            version: a.version,
          };
        });
        setAnswers(ansMap);
      } catch (err) {
        setErrorMessage('Failed to load examination state. Please refresh.');
      } finally {
        setLoading(false);
      }
    }
    loadExamData();
  }, [session.session_id]);

  // 2. Authoritative Timer Countdown
  useEffect(() => {
    if (remainingSeconds === null || submissionResult) return;

    if (remainingSeconds <= 0) {
      handleFinalSubmit();
      return;
    }

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [remainingSeconds, submissionResult]);

  // 3. Anti-Cheat Proctoring — Tab-switch / window blur detection
  useEffect(() => {
    if (submissionResult) return;

    const handleViolation = async (type) => {
      if (submissionResult) return;
      try {
        const res = await examAPI.logViolation(session.session_id, type, `Browser event: ${type}`);
        setViolationCount(res.violation_count);
        if (res.auto_submitted) {
          setViolationAutoSubmitted(true);
          // Force-fetch the final submission result
          try {
            const sub = await examAPI.getSubmission(session.session_id);
            setSubmissionResult(sub);
          } catch (_) {}
        } else {
          setShowViolationModal(true);
        }
      } catch (_) {}
    };

    const onVisChange = () => {
      if (document.hidden) handleViolation('tab_switch');
    };
    const onBlur = () => handleViolation('window_blur');

    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [session.session_id, submissionResult]);

  // 4. Load solution review data
  const handleLoadReview = async () => {
    if (reviewData) { setReviewTab('review'); return; }
    setLoadingReview(true);
    try {
      const data = await examAPI.getSolutionReview(session.session_id);
      setReviewData(data);
      setReviewTab('review');
    } catch (_) {} finally {
      setLoadingReview(false);
    }
  };

  // 3. Answer Selection with Durable Background Autosave
  const handleSelectAnswer = async (selectedOptionId) => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult) return;

    const existing = answers[currentQ.id] || { isMarked: false, version: 0 };
    const nextVersion = existing.version + 1;

    // 1. Immediate optimistic UI update
    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        answer: selectedOptionId,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');

    // 2. Durable backend persist
    try {
      await examAPI.saveAnswer(
        session.session_id,
        currentQ.id,
        selectedOptionId,
        existing.isMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 4. Clear Answer
  const handleClearAnswer = async () => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult) return;

    const existing = answers[currentQ.id] || { isMarked: false, version: 0 };
    const nextVersion = existing.version + 1;

    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        answer: null,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');
    try {
      await examAPI.saveAnswer(
        session.session_id,
        currentQ.id,
        null,
        existing.isMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 5. Toggle Mark for Review
  const handleToggleMark = async () => {
    const currentQ = questions[currentIndex];
    if (!currentQ || submissionResult) return;

    const existing = answers[currentQ.id] || { answer: null, isMarked: false, version: 0 };
    const nextMarked = !existing.isMarked;
    const nextVersion = existing.version + 1;

    setAnswers((prev) => ({
      ...prev,
      [currentQ.id]: {
        ...existing,
        isMarked: nextMarked,
        version: nextVersion,
      },
    }));

    setAutosaveState('saving');
    try {
      await examAPI.saveAnswer(
        session.session_id,
        currentQ.id,
        existing.answer,
        nextMarked,
        nextVersion
      );
      setAutosaveState('saved');
    } catch (err) {
      setAutosaveState('error');
    }
  };

  // 6. Submit Exam
  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await examAPI.submitExam(session.session_id);
      setSubmissionResult(res);
      setShowSubmitModal(false);
    } catch (err) {
      setErrorMessage(err.response?.data?.detail || 'Failed to submit examination.');
    } finally {
      setSubmitting(false);
    }
  };

  // Timer Formatting
  const formatTime = (secs) => {
    if (secs === null) return '--:--';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // --- Post Submission Results Screen ---
  if (submissionResult) {
    const sr = submissionResult;
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Violation auto-submit banner */}
        {violationAutoSubmitted && (
          <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center space-x-3">
            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <p className="text-sm text-rose-700 dark:text-rose-300 font-medium">
              Your exam was automatically submitted due to exceeding the maximum security violations (3/3).
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors overflow-hidden">
          {/* Header */}
          <div className="p-8 text-center border-b border-slate-100 dark:border-slate-800">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Award className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Examination Submitted!</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Your answers have been securely recorded and evaluated by the server.
            </p>
          </div>

          {/* Score Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
            {[
              { label: 'Score', value: `${sr.score} / ${sr.total_marks}`, color: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Correct', value: sr.correct_count, color: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Incorrect', value: sr.incorrect_count, color: 'text-rose-500 dark:text-rose-400' },
              { label: 'Unanswered', value: sr.unanswered_count, color: 'text-slate-600 dark:text-slate-300' },
            ].map((m) => (
              <div key={m.label} className="p-5 text-center">
                <span className="block text-xs uppercase font-semibold text-slate-400 dark:text-slate-500 mb-1">{m.label}</span>
                <span className={`text-2xl font-bold ${m.color}`}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setReviewTab('score')}
              className={`flex-1 py-3 text-sm font-semibold transition ${reviewTab === 'score' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Score Summary
            </button>
            <button
              onClick={handleLoadReview}
              className={`flex-1 py-3 text-sm font-semibold transition flex items-center justify-center space-x-1.5 ${reviewTab === 'review' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{loadingReview ? 'Loading…' : 'Review Answers'}</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6 sm:p-8">
            {reviewTab === 'score' && (
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                <p>Your final score has been calculated using server-side authoritative scoring. Negative marking was applied where applicable.</p>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <p className="font-semibold text-slate-700 dark:text-slate-200 mb-2">What happens next?</p>
                  <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-slate-400">
                    <li>Your answers are permanently recorded and cannot be altered.</li>
                    <li>Switch to <strong className="text-slate-700 dark:text-slate-300">Review Answers</strong> to see correct solutions and explanations.</li>
                    <li>Return to lobby to view the leaderboard once results are released.</li>
                  </ul>
                </div>
                <button onClick={handleLoadReview} className="inline-flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition">
                  <Eye className="w-4 h-4" />
                  <span>View Detailed Solutions</span>
                </button>
              </div>
            )}

            {reviewTab === 'review' && reviewData && (
              <div className="space-y-6">
                {reviewData.questions.map((q, idx) => {
                  const userAns = q.selected_answer;
                  const correctAns = q.correct_answer;
                  const isCorrect = q.is_correct;
                  const isUnanswered = !userAns;

                  return (
                    <div key={q.id} className={`p-5 rounded-2xl border ${isCorrect ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20' : isUnanswered ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40' : 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20'}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          <span className="text-slate-400 dark:text-slate-500 font-normal mr-1">Q{q.order}.</span>
                          {q.question_text}
                        </p>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-bold ${isCorrect ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300' : isUnanswered ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400' : 'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300'}`}>
                          {isCorrect ? `+${q.marks_earned}` : isUnanswered ? '0' : `${q.marks_earned}`}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt) => {
                          const isUserChoice = opt.id === userAns;
                          const isCorrectOpt = opt.id === correctAns;
                          let cls = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400';
                          if (isCorrectOpt) cls = 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold';
                          else if (isUserChoice && !isCorrectOpt) cls = 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 line-through';
                          return (
                            <div key={opt.id} className={`flex items-center space-x-2 px-3 py-2 rounded-xl border text-xs ${cls}`}>
                              <span className="font-bold w-5 shrink-0">{opt.id}</span>
                              <span>{opt.text}</span>
                              {isCorrectOpt && <CheckCircle className="w-3.5 h-3.5 ml-auto shrink-0 text-emerald-600 dark:text-emerald-400" />}
                            </div>
                          );
                        })}
                      </div>

                      {q.explanation && (
                        <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl">
                          <p className="text-xs text-indigo-700 dark:text-indigo-300">
                            <span className="font-bold">Explanation: </span>{q.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-center">
            <button
              onClick={onExit}
              className="px-8 py-2.5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white font-medium text-sm transition"
            >
              Return to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex] || {};
  const currentAnswerData = answers[currentQ.id] || {};
  const answeredCount = Object.values(answers).filter((a) => a.answer !== null && a.answer !== undefined).length;
  const markedCount = Object.values(answers).filter((a) => a.isMarked).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors">
      {/* Top Authoritative Bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-16 z-20 shadow-xs transition-colors">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{session.title}</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Session ID: {session.session_id.slice(0, 8)}...</span>
        </div>

        <div className="flex items-center space-x-4">
          {/* Autosave Status Badge */}
          <div className="flex items-center space-x-1.5 text-xs font-medium px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
            {autosaveState === 'saving' && (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></div>
                <span className="text-amber-700 dark:text-amber-400">Saving...</span>
              </>
            )}
            {autosaveState === 'saved' && (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">Saved</span>
              </>
            )}
            {autosaveState === 'error' && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                <span className="text-rose-700 dark:text-rose-400">Retrying save...</span>
              </>
            )}
          </div>

          {/* Server-Authoritative Timer */}
          <div
            className={`flex items-center space-x-2 font-mono text-sm font-bold px-3 py-1.5 rounded-xl border ${
              remainingSeconds !== null && remainingSeconds < 300
                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900 animate-pulse'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Clock className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <span>{formatTime(remainingSeconds)}</span>
          </div>

          {/* Violation Counter Badge */}
          {violationCount > 0 && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-100 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{violationCount}/3 Violations</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={() => setShowSubmitModal(true)}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-sm"
          >
            Submit Exam
          </button>
        </div>
      </div>

      {/* Main Examination Work Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Pane: Question & Options (8 cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 flex flex-col justify-between shadow-xs transition-colors">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
              <span className="text-xs uppercase font-bold tracking-wider px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Marks: <strong>{currentQ.marks}</strong> (Negative: -0.25)</span>
            </div>

            <h3 className="text-lg font-medium text-slate-900 dark:text-white leading-relaxed mb-6">
              {currentQ.question_text}
            </h3>

            {/* MCQ Options list */}
            <div className="space-y-3">
              {currentQ.options &&
                currentQ.options.map((opt) => {
                  const isSelected = currentAnswerData.answer === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectAnswer(opt.id)}
                      className={`w-full text-left p-4 rounded-xl border text-sm transition flex items-start space-x-3.5 ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 font-medium ring-1 ring-indigo-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5 ${
                          isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {opt.id}
                      </span>
                      <span className="flex-1">{opt.text}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Action Navigation Footer */}
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleToggleMark}
                className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                  currentAnswerData.isMarked
                    ? 'bg-purple-50 dark:bg-purple-950/50 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                <span>{currentAnswerData.isMarked ? 'Marked for Review' : 'Mark for Review'}</span>
              </button>

              {currentAnswerData.answer && (
                <button
                  type="button"
                  onClick={handleClearAnswer}
                  className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Selection</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="inline-flex items-center space-x-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <button
                type="button"
                disabled={currentIndex === questions.length - 1}
                onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                className="inline-flex items-center space-x-1 px-4 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-40 transition"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Pane: Question Palette (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs transition-colors">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-4">Question Palette</h4>

            {/* Quick Summary Counts */}
            <div className="grid grid-cols-3 gap-2 mb-6 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
                <span className="block text-emerald-800 dark:text-emerald-300 font-bold text-base">{answeredCount}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Answered</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="block text-slate-800 dark:text-slate-200 font-bold text-base">{unansweredCount}</span>
                <span className="text-slate-500 dark:text-slate-400 font-medium">Unanswered</span>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-800">
                <span className="block text-purple-800 dark:text-purple-300 font-bold text-base">{markedCount}</span>
                <span className="text-purple-600 dark:text-purple-400 font-medium">Marked</span>
              </div>
            </div>

            {/* Numbered Palette Buttons */}
            <div className="grid grid-cols-5 gap-2 max-h-[360px] overflow-y-auto p-1">
              {questions.map((q, idx) => {
                const ans = answers[q.id];
                const hasAnswer = ans && ans.answer !== null && ans.answer !== undefined;
                const isMarked = ans && ans.isMarked;
                const isCurrent = idx === currentIndex;

                let btnClass = 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'; // Unanswered
                if (hasAnswer && isMarked) {
                  btnClass = 'bg-purple-600 border-purple-600 text-white font-bold ring-2 ring-purple-300 dark:ring-purple-700';
                } else if (isMarked) {
                  btnClass = 'bg-purple-100 dark:bg-purple-900/60 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200 font-semibold';
                } else if (hasAnswer) {
                  btnClass = 'bg-emerald-600 border-emerald-600 text-white font-semibold';
                }

                if (isCurrent) {
                  btnClass += ' ring-2 ring-indigo-600 dark:ring-indigo-400 ring-offset-2 dark:ring-offset-slate-900';
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-10 rounded-xl border text-xs flex items-center justify-center transition shadow-2xs ${btnClass}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Violation Warning Modal */}
      {showViolationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-rose-200 dark:border-rose-800">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Security Violation Detected</h3>
                <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">Warning {violationCount} of 3</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">
              You switched tabs or left the exam window. This has been recorded.{' '}
              <strong className="text-rose-600 dark:text-rose-400">
                {3 - violationCount} warning{3 - violationCount !== 1 ? 's' : ''} remaining
              </strong>{' '}
              before your exam is automatically submitted.
            </p>
            <button
              onClick={() => setShowViolationModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white font-medium text-sm transition"
            >
              I Understand — Resume Exam
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-xl border border-slate-200 dark:border-slate-800 transition-colors">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Submit Examination?</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              Please review your question progress before finalizing your submission:
            </p>

            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2 mb-6 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Total Questions:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{questions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-700 dark:text-emerald-400">Answered Questions:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{answeredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Unanswered Questions:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">{unansweredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-purple-700 dark:text-purple-400">Marked for Review:</span>
                <span className="font-bold text-purple-700 dark:text-purple-400">{markedCount}</span>
              </div>
            </div>

            {errorMessage && (
              <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs rounded-xl border border-rose-200 dark:border-rose-900">
                {errorMessage}
              </div>
            )}

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="w-1/2 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Continue Exam
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinalSubmit}
                className="w-1/2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Confirm Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

