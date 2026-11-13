import React, { useState, useEffect } from 'react';
import { adminAPI, examAPI } from '../../services/api';
import {
  Users, CheckCircle2, Clock, AlertTriangle, ShieldAlert,
  Trophy, RefreshCw, Radio, Search, Filter, Eye,
  PlusCircle, X, Trash2
} from 'lucide-react';

export default function AdminDashboard() {
  const [examId, setExamId] = useState(null);
  const [overview, setOverview] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [suspiciousActivity, setSuspiciousActivity] = useState([]);
  const [activeTab, setActiveTab] = useState('candidates'); // 'candidates', 'leaderboard', 'collusion'
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [violations, setViolations] = useState([]); // { id, candidate_code, count, timestamp, type }
  const [showExamCreator, setShowExamCreator] = useState(false);
  const [creatorStep, setCreatorStep] = useState('meta'); // 'meta' | 'questions'
  const [examMeta, setExamMeta] = useState({ title: '', description: '', duration_minutes: 60, negative_marking_rate: 0.25 });
  const [examQuestions, setExamQuestions] = useState([
    { question_text: '', options: [{ id: 'A', text: '' }, { id: 'B', text: '' }, { id: 'C', text: '' }, { id: 'D', text: '' }], correct_answer: 'A', marks: 1, negative_marks: 0.25, explanation: '' },
  ]);
  const [creatorSubmitting, setCreatorSubmitting] = useState(false);
  const [creatorError, setCreatorError] = useState('');

  // 1. Fetch exams and initial data
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const exams = await examAPI.listExams();
        if (exams.length > 0) {
          const currentExamId = exams[0].id;
          setExamId(currentExamId);
          await refreshAllData(currentExamId);
        }
      } catch (err) {
        console.error('Error initializing admin dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const refreshAllData = async (eId) => {
    try {
      const [ov, cands, lb, susp] = await Promise.all([
        adminAPI.getOverview(eId),
        adminAPI.getCandidates(eId),
        adminAPI.getLeaderboard(eId),
        adminAPI.getSuspiciousActivity(eId),
      ]);
      setOverview(ov);
      setCandidates(cands);
      setLeaderboard(lb);
      setSuspiciousActivity(susp);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    }
  };

  // 2. Real-Time WebSocket Connection to Distributed Bus
  useEffect(() => {
    if (!examId) return;

    let socket;
    let pingInterval;

    function connectWS() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/admin/exams/${examId}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsConnected(true);
        pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send('ping');
          }
        }, 15000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // If a candidate started, answered, or submitted, refresh live metrics
          if (['candidate_started', 'answer_saved', 'candidate_submitted'].includes(msg.type)) {
            refreshAllData(examId);
          }
          // Proctoring violation event
          if (msg.type === 'proctoring_violation') {
            setViolations((prev) => [
              {
                id: Date.now(),
                candidate_code: msg.candidate_code || 'Unknown',
                count: msg.violation_count || 1,
                type: msg.violation_type || 'tab_switch',
                timestamp: new Date().toLocaleTimeString(),
              },
              ...prev.slice(0, 49), // keep last 50
            ]);
          }
        } catch (e) {
          // pong or non-json message
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        clearInterval(pingInterval);
        // Retry connection after 3s
        setTimeout(connectWS, 3000);
      };
    }

    connectWS();

    return () => {
      clearInterval(pingInterval);
      if (socket) socket.close();
    };
  }, [examId]);

  if (loading || !overview) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Filter candidates
  const filteredCandidates = candidates.filter((c) => {
    const matchesSearch =
      c.candidate_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.display_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Exam Creator helpers
  const addQuestion = () => setExamQuestions((prev) => [
    ...prev,
    { question_text: '', options: [{ id: 'A', text: '' }, { id: 'B', text: '' }, { id: 'C', text: '' }, { id: 'D', text: '' }], correct_answer: 'A', marks: 1, negative_marks: 0.25, explanation: '' },
  ]);
  const removeQuestion = (idx) => setExamQuestions((prev) => prev.filter((_, i) => i !== idx));
  const updateQuestion = (idx, field, val) => setExamQuestions((prev) => prev.map((q, i) => i === idx ? { ...q, [field]: val } : q));
  const updateOption = (qIdx, optId, text) => setExamQuestions((prev) => prev.map((q, i) => i === qIdx ? { ...q, options: q.options.map((o) => o.id === optId ? { ...o, text } : o) } : q));

  const handleCreateExam = async () => {
    setCreatorSubmitting(true);
    setCreatorError('');
    try {
      const payload = {
        ...examMeta,
        duration_minutes: Number(examMeta.duration_minutes),
        negative_marking_rate: Number(examMeta.negative_marking_rate),
        questions: examQuestions.map((q) => ({
          question_text: q.question_text,
          options: q.options,
          correct_answer: q.correct_answer,
          marks: Number(q.marks),
          negative_marks: Number(q.negative_marks),
          explanation: q.explanation || '',
        })),
      };
      await examAPI.createExam(payload);
      setShowExamCreator(false);
      setCreatorStep('meta');
      await refreshAllData(examId);
    } catch (err) {
      setCreatorError(err.response?.data?.detail || 'Failed to create exam. Check all fields.');
    } finally {
      setCreatorSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Invigilator Command Center</h1>
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              ></span>
              <span className={wsConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                {wsConnected ? 'Real-Time Bus Active' : 'Connecting Event Bus...'}
              </span>
            </div>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{overview.title}</p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => { setShowExamCreator(true); setCreatorStep('meta'); setCreatorError(''); }}
            className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Create Exam</span>
          </button>
          <button
            onClick={() => refreshAllData(examId)}
            className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Violation Alert Banner */}
      {violations.length > 0 && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 animate-pulse" />
              <span className="text-sm font-bold text-rose-700 dark:text-rose-300">Security Violations ({violations.length})</span>
            </div>
            <button onClick={() => setViolations([])} className="text-xs text-rose-500 hover:text-rose-700 dark:hover:text-rose-300">Clear</button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {violations.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-xs text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/40 rounded-lg px-3 py-1.5">
                <span><strong>{v.candidate_code}</strong> — {v.type.replace('_', ' ')}</span>
                <span className="text-rose-500 dark:text-rose-400">{v.count}/3 violations · {v.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Registered</span>
            <Users className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          </div>
          <span className="text-2xl font-bold text-slate-900 dark:text-white">{overview.total_registered}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">In-Progress</span>
            <Radio className="w-4 h-4 text-amber-500 animate-pulse" />
          </div>
          <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{overview.active_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Submitted</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          </div>
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{overview.submitted_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Not Started</span>
            <Clock className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          </div>
          <span className="text-2xl font-bold text-slate-600 dark:text-slate-300">{overview.not_started_count}</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs col-span-2 md:col-span-1 transition-colors">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500 mb-2">
            <span className="text-xs uppercase font-bold tracking-wider">Collusion Flags</span>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">{overview.suspicious_count}</span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex space-x-8">
        <button
          onClick={() => setActiveTab('candidates')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'candidates'
              ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Live Candidates ({candidates.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'leaderboard'
              ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>Live Leaderboard ({leaderboard.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('collusion')}
          className={`pb-4 text-sm font-semibold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'collusion'
              ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Collusion Detection ({suspiciousActivity.length})</span>
        </button>
      </div>

      {/* Tab 1: Live Candidates Monitor */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 transition-colors">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidate code or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-slate-200 dark:border-slate-700 rounded-xl text-xs py-2 px-3 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="in_progress">In-Progress</option>
                <option value="submitted">Submitted</option>
                <option value="not_started">Not Started</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs transition-colors">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Candidate Code</th>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Progress (Answered / Total)</th>
                    <th className="py-3 px-4">Review Marked</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Flags</th>
                    <th className="py-3 px-4">Last Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredCandidates.map((c) => (
                    <tr key={c.candidate_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">{c.candidate_code}</td>
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{c.display_name}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full font-semibold ${
                            c.status === 'in_progress'
                              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                              : c.status === 'submitted'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{c.answered_count} / 20</span>
                          <div className="w-20 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-1.5 rounded-full"
                              style={{ width: `${(c.answered_count / 20) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {c.marked_count > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-semibold">
                            {c.marked_count} marked
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-bold text-indigo-600 dark:text-indigo-400">
                        {c.score !== null ? `${c.score} pts` : '-'}
                      </td>
                      <td className="py-3 px-4">
                        {c.is_suspicious ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Flagged</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Clean</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {c.last_activity ? new Date(c.last_activity).toLocaleTimeString() : 'No activity'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Live Leaderboard */}
      {activeTab === 'leaderboard' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs transition-colors">
          {leaderboard.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm">
              No submissions recorded yet. Rankings will appear as candidates complete their exams.
            </div>
          ) : (
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Candidate Code</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4">Correct</th>
                  <th className="py-3 px-4">Incorrect</th>
                  <th className="py-3 px-4">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leaderboard.map((item) => (
                  <tr key={item.candidate_code} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold ${
                          item.rank === 1
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                            : item.rank === 2
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                            : item.rank === 3
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">{item.candidate_code}</td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">{item.display_name}</td>
                    <td className="py-3 px-4 font-bold text-base text-indigo-600 dark:text-indigo-400">{item.score} pts</td>
                    <td className="py-3 px-4 text-emerald-600 dark:text-emerald-400 font-semibold">{item.correct_count}</td>
                    <td className="py-3 px-4 text-rose-500 dark:text-rose-400 font-semibold">{item.incorrect_count}</td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {item.submitted_at ? new Date(item.submitted_at).toLocaleTimeString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Collusion Detection */}
      {activeTab === 'collusion' && (
        <div className="space-y-4">
          {suspiciousActivity.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 p-12 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-slate-400 dark:text-slate-500 text-sm transition-colors">
              No collusion patterns detected across active submissions.
            </div>
          ) : (
            <div className="grid gap-4">
              {suspiciousActivity.map((flag) => (
                <div key={flag.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-2xs transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {flag.candidate_a_code} & {flag.candidate_b_code}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300">
                            {flag.risk_level} Risk
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{flag.reason}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-xs uppercase font-semibold text-slate-400 dark:text-slate-500">Similarity Score</span>
                      <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                        {(flag.similarity_score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                    <span className="font-bold text-slate-700 dark:text-slate-300 block">Statistical Evidence:</span>
                    <pre className="text-[11px] text-slate-600 dark:text-slate-300 overflow-x-auto font-mono bg-white dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      {JSON.stringify(flag.evidence, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Exam Creator Modal */}
      {showExamCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create New Exam</h2>
              <button onClick={() => setShowExamCreator(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800">
              {['meta', 'questions'].map((step) => (
                <button key={step} onClick={() => setCreatorStep(step)}
                  className={`flex-1 py-3 text-sm font-semibold transition ${creatorStep === step ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {step === 'meta' ? '1. Exam Details' : '2. Questions'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {creatorStep === 'meta' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Exam Title *</label>
                    <input value={examMeta.title} onChange={(e) => setExamMeta((p) => ({ ...p, title: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. Computer Networks Mid-Term" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Description</label>
                    <textarea value={examMeta.description} onChange={(e) => setExamMeta((p) => ({ ...p, description: e.target.value }))}
                      rows={2} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                      placeholder="Brief description of this exam" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Duration (minutes) *</label>
                      <input type="number" min="5" value={examMeta.duration_minutes} onChange={(e) => setExamMeta((p) => ({ ...p, duration_minutes: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Negative Marking Rate</label>
                      <input type="number" min="0" max="1" step="0.25" value={examMeta.negative_marking_rate} onChange={(e) => setExamMeta((p) => ({ ...p, negative_marking_rate: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  </div>
                  <button onClick={() => setCreatorStep('questions')}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition">
                    Next: Add Questions →
                  </button>
                </>
              )}

              {creatorStep === 'questions' && (
                <div className="space-y-5">
                  {examQuestions.map((q, qIdx) => (
                    <div key={qIdx} className="p-4 border border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Question {qIdx + 1}</span>
                        {examQuestions.length > 1 && (
                          <button onClick={() => removeQuestion(qIdx)} className="text-rose-400 hover:text-rose-600 transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <input value={q.question_text} onChange={(e) => updateQuestion(qIdx, 'question_text', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Enter question text..." />
                      <div className="grid grid-cols-2 gap-2">
                        {q.options.map((opt) => (
                          <div key={opt.id} className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-5">{opt.id}.</span>
                            <input value={opt.text} onChange={(e) => updateOption(qIdx, opt.id, e.target.value)}
                              className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder={`Option ${opt.id}`} />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center space-x-4">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-2">Correct:</label>
                          <select value={q.correct_answer} onChange={(e) => updateQuestion(qIdx, 'correct_answer', e.target.value)}
                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none">
                            {q.options.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">Marks:</label>
                          <input type="number" min="1" value={q.marks} onChange={(e) => updateQuestion(qIdx, 'marks', e.target.value)}
                            className="w-14 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none" />
                        </div>
                      </div>
                      <input value={q.explanation} onChange={(e) => updateQuestion(qIdx, 'explanation', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Explanation (optional — shown to candidates after submission)" />
                    </div>
                  ))}
                  <button onClick={addQuestion}
                    className="w-full py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl text-sm text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                    + Add Another Question
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            {creatorStep === 'questions' && (
              <div className="p-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
                {creatorError && <p className="text-xs text-rose-600 dark:text-rose-400">{creatorError}</p>}
                <div className="flex space-x-3">
                  <button onClick={() => setCreatorStep('meta')} className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                    ← Back
                  </button>
                  <button onClick={handleCreateExam} disabled={creatorSubmitting}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition disabled:opacity-50">
                    {creatorSubmitting ? 'Creating...' : `Create Exam (${examQuestions.length} Q)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

