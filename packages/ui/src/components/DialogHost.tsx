import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { useDialogs } from '../state/dialogs';

/** Renders whichever dialog is pending. Mounted once, near the app root. */
export function DialogHost() {
  const current = useDialogs((s) => s.current);
  const dismiss = useDialogs((s) => s.dismiss);

  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!current) return;
    if (current.kind === 'prompt') setValue(current.defaultValue);
    if (current.kind === 'choice') setValue(current.options[0]?.value ?? '');
    // Focus and select so typing immediately replaces the suggested name.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const settle = (result: string | boolean | null): void => {
    if (current.kind === 'confirm') current.resolve(result as boolean);
    else current.resolve(result as string | null);
    useDialogs.setState({ current: null });
  };

  if (current.kind === 'confirm') {
    return (
      <Modal
        title={current.title}
        width={460}
        onClose={dismiss}
        footer={
          <>
            <button className="btn" onClick={() => settle(false)}>
              Cancel
            </button>
            <button
              className={current.danger ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={() => settle(true)}
              autoFocus
            >
              {current.confirmLabel}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {current.danger && (
            <AlertTriangle size={20} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
          )}
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{current.message}</div>
        </div>
      </Modal>
    );
  }

  if (current.kind === 'choice') {
    return (
      <Modal
        title={current.title}
        width={460}
        onClose={dismiss}
        footer={
          <>
            <button className="btn" onClick={() => settle(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => settle(value)} disabled={!value}>
              {current.confirmLabel}
            </button>
          </>
        }
      >
        <div className="field">
          <label>{current.label}</label>
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
            {current.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.hint ? ` — ${option.hint}` : ''}
              </option>
            ))}
          </select>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={current.title}
      width={460}
      onClose={dismiss}
      footer={
        <>
          <button className="btn" onClick={() => settle(null)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => settle(value.trim() ? value.trim() : null)}
            disabled={!value.trim()}
          >
            {current.confirmLabel}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{current.label}</label>
        <input
          ref={inputRef}
          className="input"
          value={value}
          placeholder={current.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) settle(value.trim());
          }}
        />
      </div>
    </Modal>
  );
}
