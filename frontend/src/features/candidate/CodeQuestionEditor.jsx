/** Multi-language CodeMirror 6 editor with sample & custom-input sandbox execution. */
import React, { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { Play, Terminal } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Select, Textarea } from '../../components/ui';

const LANGUAGE_LABELS = {
  python: 'Python 3',
  c: 'C (GCC 17)',
  cpp: 'C++ 17',
  java: 'Java (Main)',
  javascript: 'JavaScript (Node)',
};

const VERDICT_TONES = {
  passed: { label: 'Passed', tone: 'success' },
  wrong_answer: { label: 'Wrong Answer', tone: 'danger' },
  runtime_error: { label: 'Runtime Error', tone: 'danger' },
  time_limit: { label: 'Time Limit', tone: 'warning' },
  memory_limit: { label: 'Memory Limit', tone: 'warning' },
  custom: { label: 'Ran', tone: 'info' },
};

function getLanguageExtension(language) {
  switch (language) {
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'java':
      return java();
    case 'c':
    case 'cpp':
      return cpp();
    default:
      return [];
  }
}

export default function CodeQuestionEditor({
  codingSpec,
  value,
  onChange,
  onRunCode,
  running,
  runResult,
  disabled,
}) {
  const { theme } = useTheme();
  const allowedLanguages = codingSpec?.languages || ['python'];
  const activeLanguage = value?.language && allowedLanguages.includes(value.language)
    ? value.language
    : allowedLanguages[0];
  const activeCode =
    value?.code !== undefined
      ? value.code
      : codingSpec?.starter_code?.[activeLanguage] || '';

  const [draftsByLanguage, setDraftsByLanguage] = useState({});
  const [useCustomInput, setUseCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const extensions = useMemo(() => [getLanguageExtension(activeLanguage)], [activeLanguage]);

  const handleLanguageChange = (nextLanguage) => {
    setDraftsByLanguage((prev) => ({ ...prev, [activeLanguage]: activeCode }));
    const nextCode =
      draftsByLanguage[nextLanguage] !== undefined
        ? draftsByLanguage[nextLanguage]
        : codingSpec?.starter_code?.[nextLanguage] || '';
    onChange({ language: nextLanguage, code: nextCode });
  };

  const handleCodeChange = (nextCode) => {
    onChange({ language: activeLanguage, code: nextCode });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-44">
            <Select
              aria-label="Programming language"
              value={activeLanguage}
              onChange={(event) => handleLanguageChange(event.target.value)}
              disabled={disabled}
            >
              {allowedLanguages.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang] || lang}
                </option>
              ))}
            </Select>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Limit: {codingSpec?.time_limit_ms || 2000} ms
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setUseCustomInput((prev) => !prev)}
            disabled={disabled}
          >
            <Terminal className="h-3.5 w-3.5" />
            {useCustomInput ? 'Hide custom input' : 'Custom input'}
          </Button>
          <Button
            size="sm"
            loading={running}
            disabled={disabled || !activeCode.trim()}
            onClick={() => onRunCode(activeLanguage, activeCode, useCustomInput ? customInput : null)}
          >
            <Play className="h-3.5 w-3.5" />
            {useCustomInput ? 'Run custom input' : 'Run sample tests'}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
        <CodeMirror
          value={activeCode}
          height="320px"
          theme={theme === 'dark' ? 'dark' : 'light'}
          extensions={extensions}
          editable={!disabled}
          onChange={handleCodeChange}
          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: true }}
        />
      </div>

      {useCustomInput && (
        <Textarea
          label="Standard input (stdin)"
          rows={3}
          value={customInput}
          onChange={(event) => setCustomInput(event.target.value)}
          placeholder="Enter custom input to pass to your program..."
          className="font-mono text-xs"
        />
      )}

      {codingSpec?.sample_tests?.length > 0 && !runResult && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Sample test cases</div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {codingSpec.sample_tests.map((testCase, index) => (
              <div
                key={index}
                className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2.5 text-xs font-mono space-y-1.5"
              >
                <div>
                  <span className="text-zinc-500">Input #{index + 1}:</span>
                  <pre className="mt-0.5 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{testCase.input || '(empty)'}</pre>
                </div>
                <div>
                  <span className="text-zinc-500">Expected:</span>
                  <pre className="mt-0.5 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{testCase.expected_output}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {runResult && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Execution output</span>
            {runResult.status === 'compile_error' ? (
              <Badge tone="danger">Compile error</Badge>
            ) : (
              <Badge tone="neutral">
                {runResult.results.filter((item) => item.verdict === 'passed').length}/{runResult.results.length} passed
              </Badge>
            )}
          </div>

          {runResult.compile_output && (
            <pre className="rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 p-3 text-xs font-mono text-red-700 dark:text-red-300 overflow-x-auto whitespace-pre-wrap">
              {runResult.compile_output}
            </pre>
          )}

          {runResult.results.length > 0 && (
            <div className="space-y-2">
              {runResult.results.map((item, idx) => {
                const verdictMeta = VERDICT_TONES[item.verdict] || { label: item.verdict, tone: 'neutral' };
                return (
                  <div
                    key={idx}
                    className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {item.verdict === 'custom' ? 'Custom Input' : `Test #${idx + 1}`}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 tabular-nums">{item.time_ms} ms</span>
                        <Badge tone={verdictMeta.tone}>{verdictMeta.label}</Badge>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-2 font-mono text-[11px]">
                      <div>
                        <div className="text-zinc-500">Input</div>
                        <pre className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{item.input || '(empty)'}</pre>
                      </div>
                      {item.expected_output !== null && (
                        <div>
                          <div className="text-zinc-500">Expected</div>
                          <pre className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{item.expected_output}</pre>
                        </div>
                      )}
                      <div>
                        <div className="text-zinc-500">Actual</div>
                        <pre className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{item.actual_output || '(empty)'}</pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

