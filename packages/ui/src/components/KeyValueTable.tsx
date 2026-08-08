import { X } from 'lucide-react';
import type { KeyValue } from '@crafillio/core';
import { blankRow, withTrailingBlank } from '../lib/defaults';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Hides the value column for tables that only collect names. */
  valueLabel?: string;
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
                  onChange={(e) => update(row.id, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="kv-input"
                  value={row.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) => update(row.id, { value: e.target.value })}
                />
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
  );
}
