import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { adminMonitorApi } from '../../api/endpoints';
import { extractApiError, formatDateTime } from '../../lib/format';
import { Button, Card, EmptyState, Skeleton, Textarea } from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

export function AnnouncementsTab({ examId }) {
  const { notify } = useToast();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      setAnnouncements(await adminMonitorApi.listAnnouncements(examId));
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [examId, notify]);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  const handleSend = async (event) => {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      const created = await adminMonitorApi.sendAnnouncement(examId, message.trim());
      setAnnouncements((prev) => [created, ...prev]);
      setMessage('');
      notify('Announcement broadcast to all connected candidates.', 'success');
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <Card className="p-4">
        <form onSubmit={handleSend} className="space-y-3">
          <Textarea
            label="Broadcast live announcement"
            rows={2}
            maxLength={500}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. Clarification on Question 4: round your answer to 3 decimal places."
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 tabular-nums">{message.length}/500</span>
            <Button type="submit" size="sm" loading={sending} disabled={!message.trim()}>
              <Send className="h-3.5 w-3.5" /> Broadcast now
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <Skeleton className="h-40" />
      ) : announcements.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title="No announcements sent"
            description="Broadcast messages appear immediately as a banner inside active candidate exam rooms."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {announcements.map((item) => (
            <Card key={item.id} className="p-4 space-y-1">
              <p className="text-sm text-zinc-900 dark:text-zinc-100">{item.message}</p>
              <div className="text-xs text-zinc-500">
                {item.author} &middot; {formatDateTime(item.created_at)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
