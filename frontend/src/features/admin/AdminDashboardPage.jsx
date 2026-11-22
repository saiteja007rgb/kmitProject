import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, ClipboardList, Plus, Radio, Users } from 'lucide-react';
import { adminPeopleApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { EXAM_STATUS_META, extractApiError, formatRelativeSeconds } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminPeopleApi
      .getDashboard()
      .then(setData)
      .catch((error) => notify(extractApiError(error, 'Failed to load dashboard.'), 'danger'))
      .finally(() => setLoading(false));
  }, [notify]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const counts = data?.counts || {
    candidates: 0,
    active_candidates: 0,
    exams: 0,
    live_exams: 0,
    in_progress_sessions: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Operations overview</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Live examination status, active sittings, and recent administrative activity.
          </p>
        </div>
        {user?.role === 'admin' && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/admin/candidates')}>
              Manage candidates
            </Button>
            <Button onClick={() => navigate('/admin/exams/new')}>
              <Plus className="h-4 w-4" />
              New exam
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Candidates"
          value={counts.candidates}
          sublabel={`${counts.active_candidates} active`}
          icon={Users}
        />
        <StatCard label="Total exams" value={counts.exams} icon={ClipboardList} />
        <StatCard
          label="Live exams"
          value={counts.live_exams}
          sublabel="Currently running or paused"
          icon={Radio}
        />
        <StatCard
          label="Active sittings"
          value={counts.in_progress_sessions}
          sublabel="Candidates currently in exam"
          icon={Activity}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Running examinations</h2>
            <Link to="/admin/exams" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              View all
            </Link>
          </div>

          {!data?.live_exams?.length ? (
            <EmptyState
              icon={Radio}
              title="No exams running right now"
              description="Publish a scheduled or draft exam to start live monitoring."
            />
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.live_exams.map((exam) => {
                const statusMeta = EXAM_STATUS_META[exam.status] || { label: exam.status, tone: 'neutral' };
                return (
                  <div key={exam.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/admin/exams/${exam.id}`}
                          className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 truncate"
                        >
                          {exam.title}
                        </Link>
                        <Badge tone={statusMeta.tone} dot>
                          {statusMeta.label}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {exam.in_progress_count} in progress &middot; {exam.submitted_count} submitted &middot;{' '}
                        {exam.enrolled_count} enrolled
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/exams/${exam.id}`)}>
                      Monitor
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            {user?.role === 'admin' && (
              <Link to="/admin/audit" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                Full log
              </Link>
            )}
          </div>
          {!data?.recent_activity?.length ? (
            <EmptyState title="No recent events" description="Administrative and security events appear here." />
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.recent_activity.slice(0, 10).map((entry) => (
                <li key={entry.id} className="px-5 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate">{entry.action}</span>
                    <span className="text-zinc-400 shrink-0">{formatRelativeSeconds(entry.created_at)}</span>
                  </div>
                  <div className="mt-0.5 text-zinc-500">
                    {entry.actor_username || 'system'}
                    {entry.target_type ? ` · ${entry.target_type}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

