import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A vertical split with a draggable divider.
 *
 * The divider already looked draggable — it carried `cursor: row-resize` — but
 * nothing listened, so the panes were stuck at an even split and a long
 * response could not be given more room. A control that advertises an
 * affordance it does not have is worse than one that looks inert.
 *
 * The ratio is remembered per `id`, so the response pane keeps the size you
 * gave it across tab switches and restarts rather than snapping back.
 */

const MIN = 0.12;
const MAX = 0.88;

function stored(id: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`split:${id}`);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(MAX, Math.max(MIN, value)) : fallback;
  } catch {
    // Private mode, or storage disabled — an even split is a fine answer.
    return fallback;
  }
}

export function Split({
  id,
  top,
  bottom,
  initial = 0.5,
}: {
  /** Identifies the ratio in storage; panes with the same id share a size. */
  id: string;
  top: React.ReactNode;
  bottom: React.ReactNode;
  initial?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => stored(id, initial));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(`split:${id}`, String(ratio));
    } catch {
      /* Not being able to remember the size is not worth failing over. */
    }
  }, [id, ratio]);

  const apply = useCallback((clientY: number) => {
    const box = container.current?.getBoundingClientRect();
    if (!box || box.height === 0) return;
    const next = (clientY - box.top) / box.height;
    setRatio(Math.min(MAX, Math.max(MIN, next)));
  }, []);

  // Listeners live on the window, not the divider: the pointer routinely
  // outruns a 5px target mid-drag, and dropping the drag when it does is
  // exactly the stickiness this is meant to fix.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent): void => {
      e.preventDefault();
      apply(e.clientY);
    };
    const stop = (): void => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    // Stops the drag from selecting text in either pane.
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.userSelect = previous;
    };
  }, [dragging, apply]);

  return (
    <div
      ref={container}
      className="split"
      style={{ gridTemplateRows: `minmax(0, ${ratio}fr) 5px minmax(0, ${1 - ratio}fr)` }}
    >
      {top}

      <div
        className={`splitter ${dragging ? 'dragging' : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the response pane"
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setRatio(initial)}
        // Keyboard resizing, so the pane is not mouse-only.
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowUp') setRatio((r) => Math.max(MIN, r - step));
          else if (e.key === 'ArrowDown') setRatio((r) => Math.min(MAX, r + step));
          else if (e.key === 'Home') setRatio(initial);
          else return;
          e.preventDefault();
        }}
        title="Drag to resize · double-click to reset · arrow keys when focused"
      />

      {bottom}
    </div>
  );
}
