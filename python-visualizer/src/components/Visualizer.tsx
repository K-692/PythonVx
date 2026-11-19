import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store';
import type { HeapObject, Step, Trace, ValueRef } from '../types';
import { clip, errorHint, errorStepIndex, explainStep, heapObject, isBoxed } from '../lib/explain';
import { isDesktop } from '../lib/runner';

interface Ctx {
  trace: Trace;
  step: Step;
  changed: Set<string>; // "frameId:name"
  hovered: number | null;
  setHovered: (id: number | null) => void;
}

export function Visualizer() {
  const trace = useAppStore((s) => s.trace);
  const stepIndex = useAppStore((s) => s.stepIndex);
  const status = useAppStore((s) => s.status);
  const runError = useAppStore((s) => s.runError);
  const tracedCode = useAppStore((s) => s.tracedCode);
  const dirty = useAppStore((s) => s.dirty);
  const [hovered, setHovered] = useState<number | null>(null);

  const lines = useMemo(() => tracedCode.split('\n'), [tracedCode]);

  if (runError) {
    return (
      <Shell>
        <div className="notice notice-error">
          <div className="notice-title">{isDesktop() ? 'Could not run your program' : 'Desktop app required'}</div>
          <pre className="notice-body">{runError}</pre>
        </div>
      </Shell>
    );
  }
  if (!trace) {
    return (
      <Shell>
        <div className="empty-hint">{status === 'running' ? 'Running your program…' : 'Write some Python on the left and press Run.'}</div>
      </Shell>
    );
  }
  if (!trace.steps.length) {
    return (
      <Shell>
        {trace.error ? <ErrorCard trace={trace} /> : <div className="empty-hint">The program has no steps to show.</div>}
      </Shell>
    );
  }

  const step = trace.steps[Math.min(stepIndex, trace.steps.length - 1)];
  const top = step.stack[step.stack.length - 1];
  const changed = new Set(step.changes.map(([n, , fid]) => `${fid ?? top?.id}:${n}`));
  const explanation = explainStep(trace, stepIndex, lines);
  const isLast = stepIndex === trace.steps.length - 1;
  const showError = trace.error && (stepIndex >= errorStepIndex(trace));

  return (
    <Shell stale={dirty}>
      <div className={`explain explain-${explanation.tone}`}>
        <div className="explain-title">
          <span className={`badge badge-${explanation.tone}`}>{badgeText(step, explanation.tone)}</span>
          {explanation.title}
        </div>
        {explanation.details.length > 0 && (
          <ul className="explain-details">
            {explanation.details.map((d, i) => (
              <li key={i}>{renderInlineCode(d)}</li>
            ))}
          </ul>
        )}
      </div>

      {showError && <ErrorCard trace={trace} />}
      {isLast && <Notices trace={trace} />}

      <MemoryView ctx={{ trace, step, changed, hovered, setHovered }} />
    </Shell>
  );
}

function badgeText(step: Step, tone: string) {
  if (tone === 'done') return 'done';
  if (step.event === 'call') return 'call';
  if (step.event === 'return') return step.unwinding ? 'error' : 'return';
  if (step.event === 'exception') return 'error';
  return `line ${step.line}`;
}

function renderInlineCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
  );
}

function Shell({ children, stale }: { children: React.ReactNode; stale?: boolean }) {
  return (
    <div className="pane pane-visualizer">
      <div className="panel-header">
        <span>What Python is doing</span>
        {stale && <span className="header-hint warn">showing the last run</span>}
      </div>
      <div className="visualizer-scroll">{children}</div>
    </div>
  );
}

function ErrorCard({ trace }: { trace: Trace }) {
  const err = trace.error!;
  const [open, setOpen] = useState(false);
  const hint = errorHint(err.type, err.msg);
  return (
    <div className="notice notice-error">
      <div className="notice-title">
        {err.type}
        {err.line ? ` on line ${err.line}` : ''}: <span className="notice-msg">{err.msg}</span>
      </div>
      {hint && <div className="notice-hint">💡 {hint}</div>}
      <button className="link-btn" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} full traceback
      </button>
      {open && <pre className="notice-body">{err.traceback}</pre>}
    </div>
  );
}

function Notices({ trace }: { trace: Trace }) {
  const items: string[] = [];
  if (trace.step_limit_hit)
    items.push(`Only the first ${trace.steps.length} steps are shown (step limit). The output below is from the complete run. You can raise the limit in Settings.`);
  if (trace.limit === 'time')
    items.push('The program was stopped because it ran too long — maybe a loop that never ends? You can change the time limit in Settings.');
  if (trace.exit_code !== null && trace.exit_code !== undefined)
    items.push(`The program called exit() with code ${trace.exit_code}.`);
  if (trace.sleep_capped) items.push('time.sleep() calls were shortened so you don’t have to wait.');
  if (trace.stdout_truncated) items.push('The program printed a lot; only the first 200 000 characters are kept.');
  if (!items.length) return null;
  return (
    <div className="notice notice-info">
      {items.map((t, i) => (
        <div key={i}>{t}</div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frames + Objects, with arrows for references
// ---------------------------------------------------------------------------

function collectBoxed(trace: Trace, step: Step): number[] {
  // Breadth-first from the frames, so objects appear in a natural order.
  const order: number[] = [];
  const seen = new Set<number>();
  const queue: ValueRef[] = [];
  for (const f of step.stack) for (const [, v] of f.vars) queue.push(v);
  if (step.ret) queue.push(step.ret);
  while (queue.length) {
    const ref = queue.shift()!;
    if (ref.ref === undefined || seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    const obj = heapObject(trace, step, ref);
    if (!obj) continue;
    if (isBoxed(obj)) order.push(ref.ref);
    for (const child of childRefs(obj)) queue.push(child);
  }
  return order;
}

function childRefs(obj: HeapObject): ValueRef[] {
  switch (obj.k) {
    case 'list':
    case 'tuple':
    case 'set':
    case 'namedtuple':
      return obj.items;
    case 'dict':
      return obj.entries.flat();
    case 'instance':
    case 'class':
      return obj.attrs.map(([, v]) => v);
    case 'function':
      return obj.self ? [obj.self] : [];
    default:
      return [];
  }
}

function MemoryView({ ctx }: { ctx: Ctx }) {
  const { trace, step } = ctx;
  const boxed = useMemo(() => collectBoxed(trace, step), [trace, step]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<{ d: string; id: number; key: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const targets = new Map<number, DOMRect>();
    root.querySelectorAll<HTMLElement>('[data-obj]').forEach((el) => targets.set(Number(el.dataset.obj), el.getBoundingClientRect()));
    const out: { d: string; id: number; key: string }[] = [];
    root.querySelectorAll<HTMLElement>('[data-pointer]').forEach((el, i) => {
      const id = Number(el.dataset.pointer);
      const t = targets.get(id);
      if (!t) return;
      const s = el.getBoundingClientRect();
      const x1 = s.left + s.width / 2 - base.left;
      const y1 = s.top + s.height / 2 - base.top;
      const x2 = t.left - base.left;
      const y2 = t.top + Math.min(18, t.height / 2) - base.top;
      const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
      out.push({ d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 2} ${y2}`, id, key: `${i}-${id}` });
    });
    setArrows(out);
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    const root = containerRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    root.querySelectorAll('.frames-col, .objects-col').forEach((el) => ro.observe(el));
    // re-measure after enter animations settle
    const t = setTimeout(measure, 260);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [measure, step, boxed]);

  return (
    <div className="memory" ref={containerRef}>
      <div className="frames-col">
        <div className="col-title">Variables (frames)</div>
        <AnimatePresence initial={false}>
          {step.stack.map((frame, i) => (
            <motion.div
              key={frame.id}
              className={`frame ${i === step.stack.length - 1 ? 'frame-active' : ''}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              <div className="frame-name">
                {frame.kind === 'module' || frame.name === 'Global'
                  ? 'Global variables'
                  : frame.kind === 'class'
                    ? `class ${frame.name} (being built)`
                    : frame.kind === 'comprehension'
                      ? frame.name
                      : `${frame.name}()`}
                {frame.kind !== 'module' && frame.name !== 'Global' && <span className="frame-line">line {frame.line}</span>}
              </div>
              {frame.vars.length === 0 && <div className="frame-empty">no variables yet</div>}
              {frame.vars.map(([name, ref]) => (
                <div key={name} className={`var-row ${ctx.changed.has(`${frame.id}:${name}`) ? 'var-changed' : ''}`}>
                  <span className="var-name">{name}</span>
                  <span className="var-value">
                    <Value ctx={ctx} vref={ref} flashKey={`${frame.id}:${name}`} />
                  </span>
                </div>
              ))}
              {i === step.stack.length - 1 && step.event === 'return' && step.ret && (
                <div className="var-row var-return">
                  <span className="var-name">return value</span>
                  <span className="var-value">
                    <Value ctx={ctx} vref={step.ret} flashKey="ret" />
                  </span>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="objects-col">
        <div className="col-title">Objects</div>
        {boxed.length === 0 && <div className="frame-empty">Lists, dictionaries and other objects appear here.</div>}
        <AnimatePresence initial={false}>
          {boxed.map((id) => {
            const obj = trace.objects[step.heap[String(id)]];
            return (
              <motion.div
                key={id}
                layout="position"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={`obj obj-${obj.k} ${ctx.hovered === id ? 'obj-hover' : ''}`}
                data-obj={id}
                onMouseEnter={() => ctx.setHovered(id)}
                onMouseLeave={() => ctx.setHovered(null)}
              >
                <ObjectBox ctx={ctx} id={id} obj={obj} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <svg className="arrows" width={size.w} height={size.h}>
        <defs>
          <marker id="pvx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
          </marker>
        </defs>
        {arrows.map((a) => (
          <path key={a.key} d={a.d} className={`arrow ${ctx.hovered === a.id ? 'arrow-hover' : ''}`} markerEnd="url(#pvx-arrow)" />
        ))}
      </svg>
    </div>
  );
}

function typeLabel(t: string) {
  return t === 'NoneType' ? 'None' : t;
}

/** A value: primitives inline, boxed objects as a pointer dot, others as a chip. */
function Value({ ctx, vref, flashKey }: { ctx: Ctx; vref: ValueRef; flashKey?: string }) {
  if (vref.ref === undefined) {
    const cls = vref.t === 'str' ? 'v-str' : vref.t === 'bool' || vref.t === 'NoneType' ? 'v-const' : 'v-num';
    return (
      <motion.span
        key={`${flashKey}-${vref.v}`}
        className={`prim ${cls}`}
        title={`${typeLabel(vref.t)}${vref.len !== undefined ? `, length ${vref.len}` : ''}: ${vref.v}`}
        initial={flashKey ? { backgroundColor: 'rgba(250, 204, 21, 0.35)' } : false}
        animate={{ backgroundColor: 'rgba(250, 204, 21, 0)' }}
        transition={{ duration: 1.1 }}
      >
        {vref.v}
      </motion.span>
    );
  }
  const obj = heapObject(ctx.trace, ctx.step, vref);
  if (!obj) return <span className="chip">…</span>;
  if (isBoxed(obj)) {
    return (
      <span
        className={`pointer ${ctx.hovered === vref.ref ? 'pointer-hover' : ''}`}
        data-pointer={vref.ref}
        title={`points to ${obj.type} #${vref.ref}`}
        onMouseEnter={() => ctx.setHovered(vref.ref!)}
        onMouseLeave={() => ctx.setHovered(null)}
      >
        <span className="pointer-dot" />
        <span className="pointer-label">{obj.type}</span>
      </span>
    );
  }
  switch (obj.k) {
    case 'function':
      return (
        <span className="chip chip-func" title={obj.type}>
          {obj.type === 'method' ? 'method ' : obj.user ? 'def ' : ''}
          {obj.name}
          <span className="chip-sig">{clip(obj.sig, 40)}</span>
        </span>
      );
    case 'class':
      return (
        <span className="chip chip-class" title={obj.bases.length ? `inherits from ${obj.bases.join(', ')}` : 'class'}>
          class {obj.name}
          {obj.attrs.length > 0 && <span className="chip-sig"> · {obj.attrs.map(([n]) => n).join(', ')}</span>}
        </span>
      );
    case 'module':
      return (
        <span className="chip chip-module" title={obj.doc}>
          module {obj.name}
        </span>
      );
    default:
      return (
        <span className="chip chip-other" title={`${obj.type}: ${obj.k === 'other' ? obj.repr : ''}`}>
          <span className="chip-type">{obj.type}</span>
          {obj.k === 'other' ? clip(obj.repr, 60) : ''}
        </span>
      );
  }
}

function ObjectBox({ ctx, id, obj }: { ctx: Ctx; id: number; obj: HeapObject }) {
  const header = (
    <div className="obj-head">
      <span className="obj-type">{obj.type}</span>
      {'len' in obj && obj.len !== undefined && <span className="obj-len">len {obj.len}</span>}
      <span className="obj-id">#{id}</span>
    </div>
  );
  const more = (shown: number, total: number) =>
    total > shown ? <div className="obj-more">… {total - shown} more not shown</div> : null;

  switch (obj.k) {
    case 'list':
    case 'tuple':
    case 'set':
    case 'namedtuple':
      return (
        <>
          {header}
          {obj.items.length === 0 ? (
            <div className="obj-emptyval">empty</div>
          ) : (
            <div className={`cells ${obj.k === 'set' ? 'cells-set' : ''}`}>
              {obj.items.map((item, i) => (
                <div className="cell" key={i}>
                  {obj.k !== 'set' && <div className="cell-index">{obj.k === 'namedtuple' ? obj.fields[i] : i}</div>}
                  <div className="cell-value">
                    <Value ctx={ctx} vref={item} flashKey={`${id}:${i}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {more(obj.items.length, obj.len)}
        </>
      );
    case 'dict':
      return (
        <>
          {header}
          {obj.entries.length === 0 ? (
            <div className="obj-emptyval">empty</div>
          ) : (
            <div className="kv">
              {obj.entries.map(([k, v], i) => (
                <div className="kv-row" key={i}>
                  <div className="kv-key">
                    <Value ctx={ctx} vref={k} />
                  </div>
                  <div className="kv-val">
                    <Value ctx={ctx} vref={v} flashKey={`${id}:${i}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {more(obj.entries.length, obj.len)}
        </>
      );
    case 'instance':
      return (
        <>
          <div className="obj-head">
            <span className="obj-type">{obj.type} object</span>
            <span className="obj-id">#{id}</span>
          </div>
          {obj.attrs.length === 0 ? (
            <div className="obj-emptyval">{obj.repr ?? 'no attributes'}</div>
          ) : (
            <div className="kv">
              {obj.attrs.map(([name, v]) => (
                <div className="kv-row" key={name}>
                  <div className="kv-key attr">{name}</div>
                  <div className="kv-val">
                    <Value ctx={ctx} vref={v} flashKey={`${id}:${name}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      );
    default:
      return header;
  }
}
