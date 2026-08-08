import { Languages } from 'lucide-react';
import { LOCALES, useI18n, useT, type LocaleCode } from '../i18n';
import { useStore } from '../state/store';

/**
 * Language picker.
 *
 * Each language is listed in its own script, which is how someone who cannot
 * read the current interface language finds theirs.
 */
export function LanguagePicker() {
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const refreshSettings = useStore((s) => s.refreshSettings);
  const t = useT();

  return (
    <label className="lang-picker" title={t.titlebar.language}>
      <Languages size={13} aria-hidden="true" />
      <select
        value={locale}
        aria-label={t.titlebar.language}
        onChange={async (e) => {
          const next = e.target.value as LocaleCode;
          // Switch first so the change is instant, then persist.
          await setLocale(next);
          await window.crafillio.settings.save({ locale: next });
          await refreshSettings();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
