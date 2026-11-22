/** Restrained, accessible in-house UI primitives (zinc neutrals + single indigo-600 accent). */
import React, { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';

const BUTTON_VARIANTS = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 border border-transparent shadow-sm',
  secondary:
    'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800',
  ghost:
    'bg-transparent text-zinc-700 dark:text-zinc-300 border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 border border-transparent shadow-sm',
  dangerOutline:
    'bg-transparent text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40',
};

const BUTTON_SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className = '', children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center h-8 w-8 rounded-md text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

const INPUT_BASE =
  'w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 transition-colors disabled:opacity-50';

export function Input({ label, hint, error, className = '', id, ...props }) {
  const fieldId = id || (label ? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        className={`${INPUT_BASE} h-9 ${error ? 'border-red-500 dark:border-red-500' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Textarea({ label, hint, error, className = '', rows = 3, id, ...props }) {
  const fieldId = id || (label ? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        rows={rows}
        className={`${INPUT_BASE} ${error ? 'border-red-500 dark:border-red-500' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Select({ label, hint, error, className = '', id, children, ...props }) {
  const fieldId = id || (label ? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      <select
        id={fieldId}
        className={`${INPUT_BASE} h-9 pr-8 ${error ? 'border-red-500' : ''} ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled = false }) {
  return (
    <label className={`flex items-start gap-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug">
        {label}
        {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</div>
        {description && <div className="text-xs text-zinc-500 dark:text-zinc-400">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
        } disabled:opacity-50`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
  info: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900',
  success:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-900',
};

export function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  const dotColors = {
    neutral: 'bg-zinc-400',
    info: 'bg-indigo-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_TONES[tone] || BADGE_TONES.neutral} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors[tone] || dotColors.neutral}`} />}
      {children}
    </span>
  );
}

export function Card({ className = '', children }) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({ label, value, sublabel, icon: Icon }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
        {value}
      </div>
      {sublabel && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sublabel}</div>}
    </Card>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {item.label}
              {item.badge !== undefined && item.badge !== null && (
                <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
                  {item.badge}
                </span>
              )}
            </span>
            {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, description, maxWidth = 'max-w-lg', children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidth} max-h-[90vh] flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          {onClose && (
            <IconButton label="Close dialog" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800 px-5 py-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  requireTypedWord = null,
}) {
  const [typed, setTyped] = React.useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const canConfirm = !requireTypedWord || typed.trim() === requireTypedWord;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{message}</p>
      {requireTypedWord && (
        <div className="mt-4">
          <Input
            label={`Type "${requireTypedWord}" to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={requireTypedWord}
            autoFocus
          />
        </div>
      )}
    </Modal>
  );
}

export function Drawer({ open, onClose, title, subtitle, widthClass = 'max-w-2xl', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-zinc-950/50 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${widthClass} h-full flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export function Spinner({ size = 'md', className = '' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' };
  return <Loader2 className={`animate-spin text-indigo-600 dark:text-indigo-400 ${sizes[size]} ${className}`} />;
}

export function TableShell({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${className}`}>
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">{children}</table>
    </div>
  );
}
