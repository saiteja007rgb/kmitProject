import React, { useCallback, useEffect, useState } from 'react';
import { BookMarked, Plus, Search, Trash2 } from 'lucide-react';
import { adminExamsApi } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { extractApiError, QUESTION_KIND_LABELS } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const DIFFICULTY_TONES = {
  easy: 'success',
  medium: 'warning',
  hard: 'danger',
};

export default function QuestionBankPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { notify } = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [kind, setKind] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    subject: 'Computer Science',
    difficulty: 'medium',
    tags: '',
    kind: 'mcq_single',
    prompt: '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    correct_answer: 'A',
    marks: 2,
    explanation: '',
  });

  const loadBank = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (difficulty) params.difficulty = difficulty;
      if (kind) params.kind = kind;
      setItems(await adminExamsApi.listQuestionBank(params));
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setLoading(false);
    }
  }, [difficulty, kind, notify, search]);

  useEffect(() => {
    const timer = window.setTimeout(loadBank, 200);
    return () => window.clearTimeout(timer);
  }, [loadBank]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const options =
        form.kind === 'mcq_single' || form.kind === 'mcq_multi'
          ? [
              { id: 'A', text: form.optionA },
              { id: 'B', text: form.optionB },
              { id: 'C', text: form.optionC },
              { id: 'D', text: form.optionD },
            ].filter((o) => o.text.trim())
          : form.kind === 'true_false'
            ? [
                { id: 'T', text: 'True' },
                { id: 'F', text: 'False' },
              ]
            : [];

      const correct =
        form.kind === 'theory'
          ? null
          : form.kind === 'mcq_multi'
            ? form.correct_answer
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean)
            : form.correct_answer;

      await adminExamsApi.createQuestionBankItem({
        title: form.title.trim(),
        subject: form.subject.trim(),
        difficulty: form.difficulty,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        kind: form.kind,
        prompt: form.prompt.trim(),
        options,
        correct_answer: correct,
        marks: Number(form.marks),
        explanation: form.explanation.trim() || null,
      });
      setCreateOpen(false);
      notify('Saved to question bank.', 'success');
      loadBank();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId) => {
    try {
      await adminExamsApi.deleteQuestionBankItem(itemId);
      notify('Removed from question bank.', 'info');
      loadBank();
    } catch (error) {
      notify(extractApiError(error), 'danger');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Question bank</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Curated institutional questions ready to insert into any examination.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add question
          </Button>
        )}
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2 relative">
          <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5 pointer-events-none" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, subject, or prompt…"
            className="pl-9"
          />
        </div>
        <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
          <option value="">All difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </Select>
        <Select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">All types</option>
          {Object.entries(QUESTION_KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookMarked}
            title="No questions found"
            description="Add reusable questions to quickly assemble new exams."
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((item) => (
            <Card key={item.id} className="p-4 flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                    <div className="text-xs text-zinc-500">{item.subject}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge tone={DIFFICULTY_TONES[item.difficulty] || 'neutral'}>{item.difficulty}</Badge>
                    <Badge tone="neutral">{QUESTION_KIND_LABELS[item.kind] || item.kind}</Badge>
                  </div>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 line-clamp-3 whitespace-pre-wrap">
                  {item.prompt}
                </p>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                    {item.marks} marks
                  </span>
                  {(item.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
                {isAdmin && (
                  <IconButton
                    label="Delete question"
                    className="hover:text-red-600"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add to question bank" maxWidth="max-w-xl">
        <form onSubmit={handleCreate} className="space-y-3.5">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Short title"
              value={form.title}
              onChange={(event) => setForm((p) => ({ ...p, title: event.target.value }))}
              required
            />
            <Input
              label="Subject"
              value={form.subject}
              onChange={(event) => setForm((p) => ({ ...p, subject: event.target.value }))}
              required
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Select
              label="Type"
              value={form.kind}
              onChange={(event) => setForm((p) => ({ ...p, kind: event.target.value }))}
            >
              <option value="mcq_single">Single Choice</option>
              <option value="mcq_multi">Multiple Choice</option>
              <option value="true_false">True / False</option>
              <option value="numeric">Numeric</option>
              <option value="short_text">Short Answer</option>
              <option value="theory">Theory</option>
            </Select>
            <Select
              label="Difficulty"
              value={form.difficulty}
              onChange={(event) => setForm((p) => ({ ...p, difficulty: event.target.value }))}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
            <Input
              label="Marks"
              type="number"
              min={0.5}
              step="0.5"
              value={form.marks}
              onChange={(event) => setForm((p) => ({ ...p, marks: event.target.value }))}
              required
            />
          </div>
          <Textarea
            label="Prompt"
            rows={3}
            value={form.prompt}
            onChange={(event) => setForm((p) => ({ ...p, prompt: event.target.value }))}
            required
          />
          {(form.kind === 'mcq_single' || form.kind === 'mcq_multi') && (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {['A', 'B', 'C', 'D'].map((letter) => (
                <Input
                  key={letter}
                  label={`Option ${letter}`}
                  value={form[`option${letter}`]}
                  onChange={(event) => setForm((p) => ({ ...p, [`option${letter}`]: event.target.value }))}
                  required={letter === 'A' || letter === 'B'}
                />
              ))}
            </div>
          )}
          {form.kind !== 'theory' && (
            <Input
              label="Correct answer"
              value={form.correct_answer}
              onChange={(event) => setForm((p) => ({ ...p, correct_answer: event.target.value }))}
              hint={form.kind === 'mcq_multi' ? 'Comma-separated option IDs, e.g. A,C' : undefined}
              required
            />
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Tags (comma separated)"
              value={form.tags}
              onChange={(event) => setForm((p) => ({ ...p, tags: event.target.value }))}
              placeholder="sql, indexing"
            />
            <Input
              label="Explanation / rubric"
              value={form.explanation}
              onChange={(event) => setForm((p) => ({ ...p, explanation: event.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save to bank
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
