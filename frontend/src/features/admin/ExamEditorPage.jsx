import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, BookMarked, Copy, Plus, Trash2, Upload } from 'lucide-react';
import { adminExamsApi } from '../../api/endpoints';
import {
  extractApiError,
  fromDatetimeLocalValue,
  QUESTION_KIND_LABELS,
  toDatetimeLocalValue,
} from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  IconButton,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '../../components/ui';
import { useToast } from '../../components/ui/ToastProvider';

const ALL_CODING_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript'];

function createBlankQuestion(kind = 'mcq_single') {
  if (kind === 'mcq_single') {
    return {
      kind,
      prompt: '',
      options: [
        { id: 'A', text: '' },
        { id: 'B', text: '' },
        { id: 'C', text: '' },
        { id: 'D', text: '' },
      ],
      correct_answer: 'A',
      marks: 1,
      negative_marks: null,
      explanation: '',
      numeric_tolerance: 0,
      coding: null,
    };
  }
  if (kind === 'mcq_multi') {
    return {
      kind,
      prompt: '',
      options: [
        { id: 'A', text: '' },
        { id: 'B', text: '' },
        { id: 'C', text: '' },
        { id: 'D', text: '' },
      ],
      correct_answer: ['A'],
      marks: 2,
      negative_marks: null,
      explanation: '',
      numeric_tolerance: 0,
      coding: null,
    };
  }
  if (kind === 'true_false') {
    return {
      kind,
      prompt: '',
      options: [
        { id: 'T', text: 'True' },
        { id: 'F', text: 'False' },
      ],
      correct_answer: 'T',
      marks: 1,
      negative_marks: null,
      explanation: '',
      numeric_tolerance: 0,
      coding: null,
    };
  }
  if (kind === 'numeric') {
    return {
      kind,
      prompt: '',
      options: [],
      correct_answer: '0',
      marks: 2,
      negative_marks: 0,
      explanation: '',
      numeric_tolerance: 0.01,
      coding: null,
    };
  }
  if (kind === 'short_text') {
    return {
      kind,
      prompt: '',
      options: [],
      correct_answer: '',
      marks: 2,
      negative_marks: 0,
      explanation: '',
      numeric_tolerance: 0,
      coding: null,
    };
  }
  if (kind === 'coding') {
    return {
      kind,
      prompt: '',
      options: [],
      correct_answer: null,
      marks: 10,
      negative_marks: 0,
      explanation: '',
      numeric_tolerance: 0,
      coding: {
        languages: ['python', 'cpp', 'java', 'javascript'],
        starter_code: { python: '# Read from stdin and print answer\n' },
        time_limit_ms: 2000,
        memory_limit_mb: 256,
        sample_tests: [{ input: '1 2\n', expected_output: '3\n' }],
        hidden_tests: [{ input: '10 20\n', expected_output: '30\n' }],
      },
    };
  }
  return {
    kind: 'theory',
    prompt: '',
    options: [],
    correct_answer: null,
    marks: 5,
    negative_marks: 0,
    explanation: '',
    numeric_tolerance: 0,
    coding: null,
  };
}

export default function ExamEditorPage() {
  const { examId } = useParams();
  const isEditing = Boolean(examId);
  const navigate = useNavigate();
  const { notify } = useToast();

  const now = new Date();
  const defaultStart = toDatetimeLocalValue(now.toISOString());
  const defaultEnd = toDatetimeLocalValue(new Date(now.getTime() + 7 * 86400 * 1000).toISOString());

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [questionsLocked, setQuestionsLocked] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [bankOpen, setBankOpen] = useState(false);
  const [bankItems, setBankItems] = useState([]);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [settings, setSettings] = useState({
    shuffle_questions: true,
    shuffle_options: true,
    negative_marking: 0.25,
    max_violations: 5,
    require_webcam: true,
    require_fullscreen: true,
    show_results_immediately: false,
  });
  const [questions, setQuestions] = useState([createBlankQuestion('mcq_single')]);

  useEffect(() => {
    if (!isEditing) return;
    adminExamsApi
      .getExam(examId)
      .then((detail) => {
        setTitle(detail.title);
        setDescription(detail.description || '');
        setInstructions(detail.instructions || '');
        setAccessCode(detail.access_code || '');
        setStartsAt(toDatetimeLocalValue(detail.starts_at));
        setEndsAt(toDatetimeLocalValue(detail.ends_at));
        setDurationMinutes(detail.duration_minutes);
        setSettings(detail.settings);
        setQuestions(detail.questions.length ? detail.questions : [createBlankQuestion('mcq_single')]);
        setQuestionsLocked(detail.in_progress_count > 0 || detail.submitted_count > 0);
      })
      .catch((error) => {
        notify(extractApiError(error), 'danger');
        navigate('/admin/exams', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [examId, isEditing, navigate, notify]);

  const updateQuestion = (index, patch) => {
    setQuestions((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const changeQuestionKind = (index, nextKind) => {
    setQuestions((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const fresh = createBlankQuestion(nextKind);
        return { ...fresh, prompt: item.prompt, explanation: item.explanation };
      })
    );
  };

  const moveQuestion = (index, direction) => {
    setQuestions((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const duplicateQuestion = (index) => {
    setQuestions((prev) => {
      const copy = [...prev];
      copy.splice(index + 1, 0, JSON.parse(JSON.stringify(prev[index])));
      return copy;
    });
  };

  const removeQuestion = (index) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev));
  };

  const handleImportQuestions = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const imported = await adminExamsApi.importQuestionsFile(file);
      setQuestions((prev) => {
        const onlyEmptyFirst = prev.length === 1 && !prev[0].prompt.trim();
        return onlyEmptyFirst ? imported.questions : [...prev, ...imported.questions];
      });
      notify(imported.message, 'success');
    } catch (error) {
      notify(extractApiError(error, 'Question import failed.'), 'danger');
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        access_code: accessCode.trim() || null,
        starts_at: fromDatetimeLocalValue(startsAt),
        ends_at: fromDatetimeLocalValue(endsAt),
        duration_minutes: Number(durationMinutes),
        settings: {
          ...settings,
          negative_marking: Number(settings.negative_marking),
          max_violations: Number(settings.max_violations),
        },
        questions: questions.map((question) => ({
          kind: question.kind,
          prompt: question.prompt.trim(),
          options: question.options || [],
          correct_answer: question.correct_answer,
          marks: Number(question.marks),
          negative_marks:
            question.negative_marks === '' || question.negative_marks === null
              ? null
              : Number(question.negative_marks),
          explanation: question.explanation?.trim() || null,
          numeric_tolerance: Number(question.numeric_tolerance || 0),
          coding: question.kind === 'coding' ? question.coding : null,
        })),
      };

      const saved = isEditing
        ? await adminExamsApi.updateExam(examId, payload)
        : await adminExamsApi.createExam(payload);
      notify(isEditing ? 'Exam updated.' : 'Exam created as draft.', 'success');
      navigate(`/admin/exams/${saved.id}`);
    } catch (error) {
      notify(extractApiError(error, 'Could not save exam. Check question fields.'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/exams')}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to exams
          </button>
          <h1 className="text-xl font-semibold tracking-tight">{isEditing ? 'Edit examination' : 'Create examination'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/admin/exams')}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEditing ? 'Save changes' : 'Save draft'}
          </Button>
        </div>
      </div>

      {/* Metadata & schedule */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">Details &amp; schedule</h2>
        <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <div className="grid sm:grid-cols-2 gap-4">
          <Textarea
            label="Description (optional)"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Textarea
            label="Candidate instructions (optional)"
            rows={2}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>
        <div className="grid sm:grid-cols-4 gap-4">
          <Input
            label="Window starts"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
          <Input
            label="Window ends"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
          />
          <Input
            label="Duration (minutes)"
            type="number"
            min={1}
            max={600}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            required
          />
          <Input
            label="Proctor PIN (optional)"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="e.g. LAB-409"
          />
        </div>
      </Card>

      {/* Proctoring & grading settings */}
      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">Security &amp; grading settings</h2>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
          <Switch
            label="Require webcam proctoring"
            description="In-browser face detection and periodic snapshots"
            checked={settings.require_webcam}
            onChange={(checked) => setSettings((prev) => ({ ...prev, require_webcam: checked }))}
          />
          <Switch
            label="Require fullscreen"
            description="Log violation if candidate exits fullscreen"
            checked={settings.require_fullscreen}
            onChange={(checked) => setSettings((prev) => ({ ...prev, require_fullscreen: checked }))}
          />
          <Switch
            label="Shuffle question order"
            description="Deterministic SHA-256 order per candidate"
            checked={settings.shuffle_questions}
            onChange={(checked) => setSettings((prev) => ({ ...prev, shuffle_questions: checked }))}
          />
          <Switch
            label="Shuffle MCQ options"
            description="Deterministic per-candidate option order"
            checked={settings.shuffle_options}
            onChange={(checked) => setSettings((prev) => ({ ...prev, shuffle_options: checked }))}
          />
          <Switch
            label="Show results immediately"
            description="Allow candidates to review solutions right after submit"
            checked={settings.show_results_immediately}
            onChange={(checked) => setSettings((prev) => ({ ...prev, show_results_immediately: checked }))}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <Input
            label="Default negative marking factor (0 to 1)"
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={settings.negative_marking}
            onChange={(event) => setSettings((prev) => ({ ...prev, negative_marking: event.target.value }))}
          />
          <Input
            label="Max violations before auto-submit"
            type="number"
            min={1}
            max={50}
            value={settings.max_violations}
            onChange={(event) => setSettings((prev) => ({ ...prev, max_violations: event.target.value }))}
          />
        </div>
      </Card>

      {/* Question builder */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Questions ({questions.length})</h2>
            {questionsLocked && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Candidates have already started this exam; question edits are locked.
              </p>
            )}
          </div>
          {!questionsLocked && (
            <div className="flex items-center gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".txt,.csv,.xlsx"
                  className="hidden"
                  onChange={handleImportQuestions}
                  disabled={importing}
                />
                <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <Upload className="h-3.5 w-3.5" />
                  {importing ? 'Importing…' : 'Import .txt / .csv / .xlsx'}
                </span>
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  setBankOpen(true);
                  try {
                    setBankItems(await adminExamsApi.listQuestionBank());
                  } catch {
                    // ignore
                  }
                }}
              >
                <BookMarked className="h-3.5 w-3.5" /> From bank
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setQuestions((prev) => [...prev, createBlankQuestion('mcq_single')])}
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </Button>
            </div>
          )}
        </div>

        {questions.map((question, index) => (
          <Card key={index} className="p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Q{index + 1}</Badge>
                <div className="w-40">
                  <Select
                    disabled={questionsLocked}
                    value={question.kind}
                    onChange={(event) => changeQuestionKind(index, event.target.value)}
                  >
                    {Object.entries(QUESTION_KIND_LABELS).map(([kindKey, label]) => (
                      <option key={kindKey} value={kindKey}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    step="0.5"
                    min={0.5}
                    disabled={questionsLocked}
                    value={question.marks}
                    onChange={(event) => updateQuestion(index, { marks: event.target.value })}
                    aria-label="Marks"
                    placeholder="Marks"
                  />
                </div>
                <span className="text-xs text-zinc-500">marks</span>
              </div>

              {!questionsLocked && (
                <div className="flex items-center gap-0.5">
                  <IconButton label="Move up" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={index === questions.length - 1}
                    onClick={() => moveQuestion(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Duplicate question" onClick={() => duplicateQuestion(index)}>
                    <Copy className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Remove question"
                    disabled={questions.length <= 1}
                    className="hover:text-red-600"
                    onClick={() => removeQuestion(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )}
            </div>

            <Textarea
              label="Prompt"
              rows={2}
              disabled={questionsLocked}
              value={question.prompt}
              onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
              required
            />

            {/* Options for mcq_single and mcq_multi */}
            {(question.kind === 'mcq_single' || question.kind === 'mcq_multi') && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Options (mark correct answer{question.kind === 'mcq_multi' ? 's' : ''})
                </div>
                {question.options.map((opt, optIdx) => {
                  const isCorrect =
                    question.kind === 'mcq_single'
                      ? question.correct_answer === opt.id
                      : Array.isArray(question.correct_answer) && question.correct_answer.includes(opt.id);
                  return (
                    <div key={opt.id} className="flex items-center gap-2">
                      <input
                        type={question.kind === 'mcq_single' ? 'radio' : 'checkbox'}
                        name={`correct-${index}`}
                        disabled={questionsLocked}
                        checked={isCorrect}
                        onChange={() => {
                          if (question.kind === 'mcq_single') {
                            updateQuestion(index, { correct_answer: opt.id });
                          } else {
                            const current = Array.isArray(question.correct_answer) ? question.correct_answer : [];
                            const next = isCorrect
                              ? current.filter((item) => item !== opt.id)
                              : [...current, opt.id];
                            updateQuestion(index, { correct_answer: next });
                          }
                        }}
                      />
                      <span className="w-5 text-xs font-mono text-zinc-500">{opt.id}</span>
                      <Input
                        disabled={questionsLocked}
                        value={opt.text}
                        onChange={(event) => {
                          const nextOptions = question.options.map((o, i) =>
                            i === optIdx ? { ...o, text: event.target.value } : o
                          );
                          updateQuestion(index, { options: nextOptions });
                        }}
                        placeholder={`Option ${opt.id}`}
                        required
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {question.kind === 'true_false' && (
              <div className="w-44">
                <Select
                  label="Correct answer"
                  disabled={questionsLocked}
                  value={question.correct_answer || 'T'}
                  onChange={(event) => updateQuestion(index, { correct_answer: event.target.value })}
                >
                  <option value="T">True</option>
                  <option value="F">False</option>
                </Select>
              </div>
            )}

            {question.kind === 'numeric' && (
              <div className="grid sm:grid-cols-2 gap-3 max-w-md">
                <Input
                  label="Expected number"
                  disabled={questionsLocked}
                  value={question.correct_answer ?? ''}
                  onChange={(event) => updateQuestion(index, { correct_answer: event.target.value })}
                  required
                />
                <Input
                  label="Tolerance (+/-)"
                  type="number"
                  step="0.001"
                  min={0}
                  disabled={questionsLocked}
                  value={question.numeric_tolerance ?? 0}
                  onChange={(event) => updateQuestion(index, { numeric_tolerance: event.target.value })}
                />
              </div>
            )}

            {question.kind === 'short_text' && (
              <Input
                label="Expected text (case-insensitive)"
                disabled={questionsLocked}
                value={question.correct_answer ?? ''}
                onChange={(event) => updateQuestion(index, { correct_answer: event.target.value })}
                required
              />
            )}

            {question.kind === 'coding' && question.coding && (
              <CodingSpecEditor
                spec={question.coding}
                disabled={questionsLocked}
                onChange={(nextCoding) => updateQuestion(index, { coding: nextCoding })}
              />
            )}

            <Input
              label={question.kind === 'theory' ? 'Model answer / grading rubric' : 'Explanation (optional)'}
              disabled={questionsLocked}
              value={question.explanation || ''}
              onChange={(event) => updateQuestion(index, { explanation: event.target.value })}
            />
          </Card>
        ))}
      </div>

      <Modal
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        title="Insert from question bank"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-2.5 max-h-96 overflow-y-auto">
          {bankItems.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">Question bank is empty.</p>
          ) : (
            bankItems.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    <Badge tone="neutral">{QUESTION_KIND_LABELS[item.kind] || item.kind}</Badge>
                    <Badge tone="info">{item.marks}m</Badge>
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{item.prompt}</p>
                </div>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    const importedQ = {
                      kind: item.kind,
                      prompt: item.prompt,
                      options: item.options || [],
                      correct_answer: item.correct_answer,
                      marks: item.marks,
                      negative_marks: item.negative_marks,
                      explanation: item.explanation || '',
                      numeric_tolerance: item.numeric_tolerance || 0,
                      coding: item.coding || null,
                    };
                    setQuestions((prev) =>
                      prev.length === 1 && !prev[0].prompt.trim() ? [importedQ] : [...prev, importedQ]
                    );
                    notify(`Added "${item.title}"`, 'success');
                  }}
                >
                  Insert
                </Button>
              </div>
            ))
          )}
        </div>
      </Modal>
    </form>
  );
}

function CodingSpecEditor({ spec, onChange, disabled }) {
  const [starterLang, setStarterLang] = useState(spec.languages[0] || 'python');

  const toggleLanguage = (lang, checked) => {
    const next = checked ? [...new Set([...spec.languages, lang])] : spec.languages.filter((item) => item !== lang);
    if (next.length === 0) return;
    onChange({ ...spec, languages: next });
    if (!next.includes(starterLang)) setStarterLang(next[0]);
  };

  const updateTestList = (field, idx, key, value) => {
    const nextList = spec[field].map((tc, i) => (i === idx ? { ...tc, [key]: value } : tc));
    onChange({ ...spec, [field]: nextList });
  };

  const addTest = (field) => {
    onChange({ ...spec, [field]: [...spec[field], { input: '', expected_output: '' }] });
  };

  const removeTest = (field, idx) => {
    onChange({ ...spec, [field]: spec[field].filter((_, i) => i !== idx) });
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 space-y-4">
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Allowed languages</div>
        <div className="flex flex-wrap gap-4">
          {ALL_CODING_LANGUAGES.map((lang) => (
            <Checkbox
              key={lang}
              label={lang}
              disabled={disabled}
              checked={spec.languages.includes(lang)}
              onChange={(checked) => toggleLanguage(lang, checked)}
            />
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Input
          label="Time limit (ms)"
          type="number"
          min={200}
          max={10000}
          disabled={disabled}
          value={spec.time_limit_ms}
          onChange={(event) => onChange({ ...spec, time_limit_ms: Number(event.target.value) })}
        />
        <Input
          label="Memory limit (MB)"
          type="number"
          min={32}
          max={512}
          disabled={disabled}
          value={spec.memory_limit_mb}
          onChange={(event) => onChange({ ...spec, memory_limit_mb: Number(event.target.value) })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Starter code</span>
          <div className="w-36">
            <Select value={starterLang} onChange={(event) => setStarterLang(event.target.value)}>
              {spec.languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Textarea
          rows={3}
          disabled={disabled}
          className="font-mono text-xs"
          value={spec.starter_code?.[starterLang] || ''}
          onChange={(event) =>
            onChange({
              ...spec,
              starter_code: { ...(spec.starter_code || {}), [starterLang]: event.target.value },
            })
          }
          placeholder={`Starter code for ${starterLang}…`}
        />
      </div>

      {[
        { field: 'sample_tests', label: 'Sample tests (visible to candidate)' },
        { field: 'hidden_tests', label: 'Hidden tests (used for server-side grading)' },
      ].map(({ field, label }) => (
        <div key={field} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
            {!disabled && (
              <Button size="xs" variant="secondary" onClick={() => addTest(field)}>
                <Plus className="h-3 w-3" /> Add case
              </Button>
            )}
          </div>
          {spec[field].map((testCase, idx) => (
            <div key={idx} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-start">
              <Textarea
                rows={2}
                disabled={disabled}
                className="font-mono text-xs"
                placeholder="stdin"
                value={testCase.input}
                onChange={(event) => updateTestList(field, idx, 'input', event.target.value)}
              />
              <Textarea
                rows={2}
                disabled={disabled}
                className="font-mono text-xs"
                placeholder="expected stdout"
                value={testCase.expected_output}
                onChange={(event) => updateTestList(field, idx, 'expected_output', event.target.value)}
              />
              {!disabled && (
                <IconButton label="Remove test case" onClick={() => removeTest(field, idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

