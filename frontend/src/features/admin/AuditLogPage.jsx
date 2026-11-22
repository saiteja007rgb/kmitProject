import React, { useEffect, useState } from 'react';
import { adminPeopleApi } from '../../api/endpoints';
import { extractApiError, formatDateTime } from '../../lib/format';
import { Button, Skeleton, TableShell } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const { notify } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminPeopleApi
      .listAuditLogs({ page, page_size: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((error) => notify(extractApiError(error), 'danger'))
      .finally(() => setLoading(false));
  }, [notify, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Immutable trail of authentication, user management, exam lifecycle, and grading events.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <TableShell>
          <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Time</th>
              <th className="px-4 py-3 text-left font-medium">Actor</th>
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Target</th>
              <th className="px-4 py-3 text-left font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
            {items.map((log) => (
              <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-2.5 whitespace-nowrap text-zinc-500 tabular-nums">
                  {formatDateTime(log.created_at)}
                </td>
                <td className="px-4 py-2.5 font-medium">{log.actor_username || 'system'}</td>
                <td className="px-4 py-2.5 font-mono text-zinc-700 dark:text-zinc-300">{log.action}</td>
                <td className="px-4 py-2.5 text-zinc-500 max-w-md truncate">
                  {log.target_type ? `${log.target_type} ` : ''}
                  {log.details ? JSON.stringify(log.details) : ''}
                </td>
                <td className="px-4 py-2.5 font-mono text-zinc-500">{log.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="tabular-nums">{total} total entries</span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button size="xs" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
