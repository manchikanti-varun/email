// Generic form primitives: Input, Select, Checkbox, and a labeled Field wrapper.
// Built on the existing `.field` styling so they match the current auth forms.
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from 'react';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return <select {...rest}>{children}</select>;
}

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...props} />;
}

// Labeled field wrapper matching the existing `.field` layout.
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && (
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
