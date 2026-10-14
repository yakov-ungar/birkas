import { useId, useState } from 'react';
import { agorotToInput, formatMoney, parseShekels } from '@tuition/shared';

export function Money({ a, className }: { a: number; className?: string }) {
  return <span className={`ltr ${className ?? ''}`}>{formatMoney(a)}</span>;
}

/** Shekel input that reports agorot (or null while invalid). */
export function MoneyField({
  label,
  value,
  onChange,
  error,
  autoFocus,
  hideLabel,
}: {
  label: string;
  value: number | null;
  onChange: (agorot: number | null) => void;
  error?: string;
  autoFocus?: boolean;
  /** Visually hidden label (still read by screen readers), e.g. inside a table row. */
  hideLabel?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value !== null ? agorotToInput(value) : '');
  const parsed = text.trim() ? parseShekels(text) : null;
  const bad = !!text.trim() && parsed === null;
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        dir="ltr"
        autoFocus={autoFocus}
        value={text}
        aria-invalid={bad || !!error}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.trim() ? parseShekels(e.target.value) : null);
        }}
      />
      {(bad || error) && <span className="field-err">{bad ? 'סכום לא תקין' : error}</span>}
    </div>
  );
}
