import { X } from 'lucide-react';
import type { KeyValue } from '@crafillio/core';
import { blankRow, withTrailingBlank } from '../lib/defaults';
import { COMMON_HEADERS, HEADER_NAME_LIST, valuesFor } from '../lib/headers';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Hides the value column for tables that only collect names. */
  valueLabel?: string;
  /** Offers header-name and header-value completion. */
  autocomplete?: 'headers' | false;
}

/**
 * The header/query/metadata grid. Always renders one empty trailing row so
 * there is somewhere to type without pressing an "add" button first.
 */
export function KeyValueTable({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  valueLabel = 'Value',
  autocomplete = false,
}: Props) {
  const display = withTrailingBlank(rows, blankRow);

  const update = (id: string, patch: Partial<KeyValue>): void => {
    const next = display.map((row) => (row.id === id ? { ...row, ...patch } : row));
    onChange(withTrailingBlank(next, blankRow));
  };

  const remove = (id: string): void => {
    const next = display.filter((row) => row.id !== id);
    onChange(next.length ? next : [blankRow()]);
  };

  return (
    <>
      {autocomplete === 'headers' && (
        // One shared list for every name field in the table.
        <datalist id={HEADER_NAME_LIST}>
          {COMMON_HEADERS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      <table className="kv">
      <thead>
        <tr>
          <th style={{ width: 34 }} />
          <th>Key</th>
          <th>{valueLabel}</th>
          <th style={{ width: 34 }} />
        </tr>
      </thead>
      <tbody>
        {display.map((row, index) => {
          const isTrailing = index === display.length - 1 && row.key === '' && row.value === '';
          return (
            <tr key={row.id} className={`kv-row ${row.enabled ? '' : 'disabled'}`}>
              <td className="kv-check">
                {!isTrailing && (
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={row.enabled}
                    onChange={(e) => update(row.id, { enabled: e.target.checked })}
                    aria-label={`Enable ${row.key || 'row'}`}
                  />
                )}
              </td>
              <td>
                <input
                  className="kv-input"
                  value={row.key}
                  placeholder={keyPlaceholder}
                  list={autocomplete === 'headers' ? HEADER_NAME_LIST : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => update(row.id, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="kv-input"
                  value={row.value}
                  placeholder={valuePlaceholder}
                  // Value suggestions depend on the name typed in this row.
                  list={
                    autocomplete === 'headers' && valuesFor(row.key).length
                      ? `${HEADER_NAME_LIST}-v-${row.id}`
                      : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => update(row.id, { value: e.target.value })}
                />
                {autocomplete === 'headers' && valuesFor(row.key).length > 0 && (
                  <datalist id={`${HEADER_NAME_LIST}-v-${row.id}`}>
                    {valuesFor(row.key).map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                )}
              </td>
              <td className="kv-remove">
                {!isTrailing && (
                  <button
                    className="row-action"
                    style={{ opacity: 1 }}
                    onClick={() => remove(row.id)}
                    title="Remove row"
                  >
                    <X size={13} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
