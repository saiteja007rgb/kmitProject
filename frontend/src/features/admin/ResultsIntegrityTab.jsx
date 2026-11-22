import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Eye, EyeOff, ShieldAlert, Trophy } from 'lucide-react';
import { adminExamsApi, adminMonitorApi } from '../../api/endpoints';
import { extractApiError, formatDateTime, formatDurationClock } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Skeleton, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function ResultsIntegrityTab({ exam, onExamUpdated }) {
  const { notify } = useToast();
  const [leaderboard, setLeaderboard] = useState([]);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [togglingResults, setTogglingResults] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [lb, flagList] = await Promise.all([
        adminMonitorApi.getLeaderboard(exam.id),
        adminMonitorApi.listCollusionFlags(exam.id),
      ]);
      setLeaderboard(lb);
      setFlags(flagList);
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [exam.id, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleResults = async () => {
    setTogglingResults(true);
    try {
      const updated = await adminExamsApi.setResultsPublished(exam.id, !exam.results_published);
      onExamUpdated?.(updated);
      notify(updated.results_published ? 'Results published to candidates.' : 'Results hidden from candidates.', 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setTogglingResults(false);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      const blob = await adminMonitorApi.downloadResultsCsv(exam.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `exam-${exam.id.slice(0, 8)}-results.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(extractApiError(error, 'CSV export failed.'), 'danger');
    }
  };

  const handleRunCollusionScan = async () => {
    setScanning(true);
    try {
      const result = await adminMonitorApi.runCollusionScan(exam.id);
      notify(`Collusion scan complete: ${result.flags_detected} pair(s) flagged.`, result.flags_detected ? 'warning' : 'success');
      loadData();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={togglingResults} onClick={handleToggleResults}>
            {exam.results_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {exam.results_published ? 'Hide results' : 'Publish results'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownloadCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <Button size="sm" loading={scanning} onClick={handleRunCollusionScan}>
          <ShieldAlert className="h-4 w-4" />
          Run collusion scanner
        </Button>
      </div>

      {/* Collusion detection flags */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Collusion detection ({flags.length})</h3>
        {flags.length === 0 ? (
          <Card className="p-4 text-xs text-zinc-500">
            No suspicious wrong-answer pairings detected. Click &ldquo;Run collusion scanner&rdquo; after candidates answer objective questions.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {flags.map((flag) => (
              <Card key={flag.id} className="p-4 border-red-200 dark:border-red-900/70 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span>
                      {flag.candidate_a_code} &harr; {flag.candidate_b_code}
                    </span>
                  </div>
                  <Badge tone={flag.risk_level === 'critical' || flag.risk_level === 'high' ? 'danger' : 'warning'}>
                    {flag.risk_level} · {Math.round(flag.similarity_score * 100)}%
                  </Badge>
                </div>
                <div className="text-xs text-zinc-500">
                  {flag.candidate_a_name} &amp; {flag.candidate_b_name}
                </div>
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{flag.reason}</p>
                <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 tabular-nums pt-1 border-t border-zinc-100 dark:border-zinc-800">
                  <span>Shared wrong: {flag.evidence.matching_incorrect_count}</span>
                  <span>Match rate: {flag.evidence.raw_similarity_pct}%</span>
                  <span>Coincidence p: {flag.evidence.coincidence_probability}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Leaderboard ({leaderboard.length})</h3>
        {leaderboard.length === 0 ? (
          <Card>
            <EmptyState
              icon={Trophy}
              title="No submissions yet"
              description="Ranked candidate scores appear here as attempts are submitted."
            />
          </Card>
        ) : (
          <TableShell>
            <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Rank</th>
                <th className="px-4 py-3 text-left font-medium">Candidate</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
                <th className="px-4 py-3 text-right font-medium">Percentage</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 text-right font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
              {leaderboard.map((row) => (
                <tr key={`${row.rank}-${row.candidate_code}`}>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">#{row.rank}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.full_name}</span>{' '}
                    <span className="font-mono text-zinc-500">({row.candidate_code})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {row.score} / {row.max_score}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.percentage}%</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-500">
                    {formatDurationClock(row.duration_seconds)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">{formatDateTime(row.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}
