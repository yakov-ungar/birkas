import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export function Field({
  label,
  error,
  ...props
}: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...props} />
      {error && (
        <span className="field-err" id={`${id}-e`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  ...props
}: { label: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...props}>
        {children}
      </select>
      {error && (
        <span className="field-err" id={`${id}-e`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  return (
    <p className="bad" role="alert" style={{ minHeight: '1.5em', margin: '8px 0 0' }}>
      {message ?? ''}
    </p>
  );
}
