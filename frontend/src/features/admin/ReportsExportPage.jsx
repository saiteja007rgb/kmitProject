import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { adminExamsApi, adminMonitorApi, adminPeopleApi } from '../../api/endpoints';
import { downloadTextFile, extractApiError } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Select, Skeleton, StatCard, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ReportsExportPage() {
  const { notify } = useToast();
  const [exams, setExams] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    Promise.all([adminExamsApi.listExams(), adminPeopleApi.listBatches()])
      .then(([examList, batchList]) => {
        setExams(examList);
        setBatches(batchList);
        if (examList.length > 0) setSelectedExamId(examList[0].id);
      })
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  }, [notify]);

  const loadMarks = useCallback(async () => {
    if (!selectedExamId) {
      setDataset(null);
      return;
    }
    setLoading(true);
    try {
      setDataset(await adminMonitorApi.getMarksJson(selectedExamId, selectedBatchId));
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [notify, selectedBatchId, selectedExamId]);

  useEffect(() => {
    loadMarks();
  }, [loadMarks]);

  const handleDownload = async (kind) => {
    if (!selectedExamId && kind !== 'consolidated') return;
    setExporting(kind);
    try {
      if (kind === 'xlsx') {
        const blob = await adminMonitorApi.downloadMarksXlsx(selectedExamId, selectedBatchId);
        triggerBlobDownload(blob, `marks-${selectedExamId.slice(0, 8)}.xlsx`);
      } else if (kind === 'csv') {
        const blob = await adminMonitorApi.downloadMarksCsv(selectedExamId, selectedBatchId);
        triggerBlobDownload(blob, `marks-${selectedExamId.slice(0, 8)}.csv`);
      } else if (kind === 'json' && dataset) {
        downloadTextFile(`marks-${selectedExamId.slice(0, 8)}.json`, JSON.stringify(dataset, null, 2), 'application/json');
      } else if (kind === 'consolidated') {
        const blob = await adminMonitorApi.downloadConsolidatedXlsx(selectedBatchId);
        triggerBlobDownload(blob, 'consolidated-cohort-marks.xlsx');
      }
      notify('Export downloaded.', 'success');
    } catch (error) {
      notify(extractApiError(error, 'Export failed.'), 'danger');
    } finally {
      setExporting('');
    }
  };

  const summary = dataset?.summary;
  const grades = summary ? Object.entries(summary.grade_distribution || {}) : [];
  const maxGradeCount = Math.max(1, ...grades.map(([, count]) => count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Marks export &amp; reports</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Generate styled multi-sheet Excel workbooks, CSV/JSON feeds, consolidated batch registers, and printable official marksheets.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={exporting === 'consolidated'}
          onClick={() => handleDownload('consolidated')}
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          Consolidated batch register (.xlsx)
        </Button>
      </div>

      {/* Filter & export toolbar */}
      <Card className="p-4 no-print">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid sm:grid-cols-2 gap-3 flex-1 min-w-[260px]">
            <Select
              label="Examination"
              value={selectedExamId}
              onChange={(event) => setSelectedExamId(event.target.value)}
            >
              {exams.length === 0 && <option value="">No exams available</option>}
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title} ({exam.status})
                </option>
              ))}
            </Select>
            <Select
              label="Filter by batch"
              value={selectedBatchId}
              onChange={(event) => setSelectedBatchId(event.target.value)}
            >
              <option value="">All batches</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              loading={exporting === 'xlsx'}
              disabled={!selectedExamId}
              onClick={() => handleDownload('xlsx')}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel (.xlsx)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={exporting === 'csv'}
              disabled={!selectedExamId}
              onClick={() => handleDownload('csv')}
            >
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!dataset}
              onClick={() => handleDownload('json')}
            >
              <FileJson className="h-4 w-4" />
              JSON
            </Button>
            <Button size="sm" variant="secondary" disabled={!dataset} onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Skeleton className="h-72" />
      ) : !dataset ? (
        <Card>
          <EmptyState icon={FileText} title="Select an examination" description="Choose an exam above to inspect and export marks." />
        </Card>
      ) : (
        <>
          {/* Print-only official header */}
          <div className="hidden print:block border-b-2 border-zinc-900 pb-3 mb-4">
            <div className="text-lg font-bold">ExamPulse — Official Examination Marks Register</div>
            <div className="text-sm">{summary.exam_title}</div>
            <div className="text-xs text-zinc-600 mt-1">
              Generated: {new Date().toLocaleString()} &middot; Max Marks: {summary.max_marks} &middot; Pass Rate:{' '}
              {summary.pass_rate}%
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard label="Submitted / Enrolled" value={`${summary.submitted} / ${summary.enrolled}`} />
            <StatCard label="Mean score" value={summary.mean} sublabel={`Out of ${summary.max_marks}`} />
            <StatCard label="Median / SD" value={summary.median} sublabel={`SD ${summary.std_dev}`} />
            <StatCard label="High / Low" value={summary.highest} sublabel={`Lowest ${summary.lowest}`} />
            <StatCard label="Pass rate (>= 40%)" value={`${summary.pass_rate}%`} />
          </div>

          {/* Grade distribution strip */}
          <Card className="p-4 print-break-avoid">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Grade distribution</h2>
            <div className="grid grid-cols-6 gap-3">
              {grades.map(([grade, count]) => (
                <div key={grade} className="space-y-1.5 text-center">
                  <div className="h-16 flex items-end justify-center">
                    <div
                      className={`w-10 rounded-t transition-all ${
                        grade === 'F' ? 'bg-red-500/80' : 'bg-indigo-600/85 dark:bg-indigo-500/85'
                      }`}
                      style={{ height: `${Math.max(8, Math.round((count / maxGradeCount) * 60))}px` }}
                    />
                  </div>
                  <div className="text-xs font-semibold tabular-nums">{count}</div>
                  <div className="text-[11px] font-mono text-zinc-500">{grade}</div>
                </div>
              ))}
            </div>
          </Card>

          <TableShell>
            <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Roll / Student</th>
                <th className="px-4 py-3 text-left font-medium">Batch</th>
                <th className="px-4 py-3 text-right font-medium">Objective</th>
                <th className="px-4 py-3 text-right font-medium">Coding</th>
                <th className="px-4 py-3 text-right font-medium">Theory</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-right font-medium">%</th>
                <th className="px-4 py-3 text-center font-medium">Grade</th>
                <th className="px-4 py-3 text-center font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
              {dataset.records.map((row) => (
                <tr key={row.candidate_code} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.full_name}</div>
                    <div className="font-mono text-[11px] text-zinc-500">{row.candidate_code}</div>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{row.batch || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.objective_score ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.coding_score ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.theory_score ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {row.total_score !== null ? `${row.total_score} / ${row.max_score}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.percentage !== null ? `${row.percentage}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono font-semibold">{row.grade}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge
                      tone={row.result === 'PASS' ? 'success' : row.result === 'FAIL' ? 'danger' : 'neutral'}
                    >
                      {row.result}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}
