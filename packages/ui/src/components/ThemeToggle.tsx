import { useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { Settings } from '@crafillio/core';
import { useStore } from '../state/store';

type Theme = Settings['theme'];

/** Resolves `system` against the OS preference. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
  // Tells the engine to render native widgets (scrollbars, form controls) to
  // match, which is what makes the light scheme feel finished rather than
  // half-applied.
  document.documentElement.style.colorScheme = resolveTheme(theme);
}

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Match system', Icon: Monitor },
];

export function ThemeToggle() {
  const settings = useStore((s) => s.settings);
  const refreshSettings = useStore((s) => s.refreshSettings);
  const current: Theme = settings?.theme ?? 'dark';

  // While on `system`, follow the OS if the user flips it mid-session.
  useEffect(() => {
    if (current !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [current]);

  const choose = async (theme: Theme): Promise<void> => {
    // Paint immediately, then persist — waiting on disk would make the click
    // feel laggy.
    applyTheme(theme);
    await window.crafillio.settings.save({ theme });
    await refreshSettings();
  };

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          className={current === value ? 'active' : ''}
          onClick={() => void choose(value)}
          title={label}
          aria-label={label}
          aria-pressed={current === value}
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  );
}
