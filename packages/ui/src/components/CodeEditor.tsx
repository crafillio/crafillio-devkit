import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { useMemo } from 'react';
import { useStore } from '../state/store';
import { resolveTheme } from './ThemeToggle';

/**
 * Syntax colours resolve from the app's CSS variables rather than literal hex,
 * so the editor tracks the active scheme. CodeMirror writes these into a
 * stylesheet, and `var()` resolves at paint time — which is exactly what makes
 * a theme switch apply without rebuilding the editor.
 */
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syn-key)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: [tags.bool, tags.null, tags.keyword], color: 'var(--syn-atom)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--red)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-dim)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, & ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 14px' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-3)',
    color: 'var(--text-muted)',
    border: 'none',
  },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--amber-soft)', outline: '1px solid var(--amber)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)' },
  '.cm-placeholder': { color: 'var(--text-dim)' },
});

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language?: 'json' | 'text';
  readOnly?: boolean;
  wrap?: boolean;
  placeholder?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  wrap = true,
  placeholder,
}: Props) {
  const settings = useStore((s) => s.settings);
  const scheme = resolveTheme(settings?.theme ?? 'dark');

  const extensions = useMemo(() => {
    const list = [
      theme,
      // `dark: true` only flips CodeMirror's own light/dark heuristics for
      // selection and cursor contrast; the colours above still come from vars.
      EditorView.theme({}, { dark: scheme === 'dark' }),
      syntaxHighlighting(highlight),
    ];
    if (language === 'json') list.push(json());
    if (wrap) list.push(EditorView.lineWrapping);
    return list;
  }, [language, wrap, scheme]);

  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        extensions={extensions}
        placeholder={placeholder}
        // Suppress the library's bundled light theme; ours is in `extensions`
        // and would otherwise be overridden, leaving a white editor surface.
        theme="none"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          autocompletion: false,
          searchKeymap: true,
          // The app owns Cmd+Enter for "send"; CodeMirror must not swallow it.
          defaultKeymap: true,
        }}
      />
    </div>
  );
}
