import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Block, Step, Tok, Trace, ValueRef } from '../types';
import { buildIndex, countAtOrBefore, lastAtOrBefore, resolveChain, scopeAt, topFrame, type FlowIndex } from '../lib/flow';
import { clip, describeValue, heapObject } from '../lib/explain';

interface Ctx {
  trace: Trace;
  index: FlowIndex;
  cur: number; // current step index
  step: Step;
  activeRow: number; // row that runs next
  doneRow: number; // row that just finished
  lines: string[];
}

const indexCache = new WeakMap<Trace, FlowIndex | null>();
function getIndex(trace: Trace) {
  if (!indexCache.has(trace)) indexCache.set(trace, buildIndex(trace));
  return indexCache.get(trace) ?? null;
}

export function FlowView({ trace, stepIndex, code }: { trace: Trace; stepIndex: number; code: string }) {
  const index = getIndex(trace);
  const lines = useMemo(() => code.split('\n'), [code]);
  if (!index || !trace.scaffold) return <div className="empty-hint">No diagram for this program.</div>;

  const cur = Math.min(stepIndex, trace.steps.length - 1);
  const step = trace.steps[cur];
  const top = topFrame(step);
  const activeRow = index.rowOf.get(step.line) ?? step.line;
  // The row that just finished = previous step of the same frame.
  let doneRow = -1;
  for (let i = cur - 1; i >= 0; i--) {
    const t = topFrame(trace.steps[i]);
    if (t && top && t.id === top.id) {
      if (trace.steps[i].event === 'line') doneRow = index.rowOf.get(trace.steps[i].line) ?? trace.steps[i].line;
      break;
    }
  }
  const ctx: Ctx = { trace, index, cur, step, activeRow, doneRow, lines };

  return (
    <div className="flow">
      {trace.scaffold.blocks.items?.map((b) => <BlockView key={`${b.k}-${b.l}`} b={b} ctx={ctx} />)}
    </div>
  );
}

function BlockView({ b, ctx }: { b: Block; ctx: Ctx }) {
  switch (b.k) {
    case 'stmt':
    case 'hdr':
      return <RowView b={b} ctx={ctx} />;
    case 'def':
      return <DefBlock b={b} ctx={ctx} />;
    case 'class':
      return <ClassBlock b={b} ctx={ctx} />;
    default:
      return <CompoundBlock b={b} ctx={ctx} />;
  }
}

const inRange = (b: Block, line: number) => line >= b.l && line <= b.e;

function frameIsDef(ctx: Ctx, b: Block) {
  return (f: { id: number }) => ctx.index.frameDef.get(f.id) === b.l;
}

function DefBlock({ b, ctx }: { b: Block; ctx: Ctx }) {
  const { trace, index, cur, step } = ctx;
  const isMine = frameIsDef(ctx, b);
  const frames = step.stack.filter(isMine);
  const live = frames[frames.length - 1];
  const isTop = !!live && topFrame(step)?.id === live.id;

  // Arguments: from the live frame, or from the most recent call.
  let argVars: [string, ValueRef][] = [];
  let argStep: Step = step;
  if (live) argVars = live.vars;
  else {
    const callIdx = lastAtOrBefore(index.callSteps.get(b.l), cur);
    if (callIdx >= 0) {
      argStep = trace.steps[callIdx];
      argVars = topFrame(argStep)?.vars ?? [];
    }
  }
  const retIdx = lastAtOrBefore(index.retSteps.get(b.l), cur);
  const retStep = retIdx >= 0 ? trace.steps[retIdx] : null;
  const calls = countAtOrBefore(index.callSteps.get(b.l), cur);
  const params = (b.args ?? []).map((a) => a.replace(/^\*+/, ''));
  const defining = ctx.activeRow === (b.line ?? b.l) && !live;

  return (
    <div className={`blk blk-def ${live ? 'blk-live' : ''} ${isTop ? 'blk-top' : ''} ${defining ? 'blk-defining' : ''}`}>
      <div className="blk-title">
        <span className="kw">def</span> <span className="fn-name">{b.name}</span>
        <span className="punct">(</span>
        <span className="arg-chips">
          {params.map((p) => {
            const ref = argVars.find(([n]) => n === p)?.[1];
            return <VarBox key={p} name={p} value={ref ? describeValue(trace, argStep, ref, 24, true) : undefined} vtype={typeOf(trace, argStep, ref)} dim={!live} vkey={live ? `f${live.id}` : `c${argStep === step ? 0 : 1}`} />;
          })}
        </span>
        <span className="punct">)</span>
        <span className="spacer" />
        {frames.length > 1 && <span className="badge-mini" title="Active calls of this function (recursion)">{frames.length} calls deep</span>}
        {calls > 0 && <span className="badge-mini">called {calls}×</span>}
        <AnimatePresence mode="popLayout">
          {retStep?.ret && !(retStep.ret.t === 'NoneType') && (
            <motion.span
              key={`ret-${retIdx}`}
              className="ret-chip"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 160, damping: 18 }}
              title="Last value returned"
            >
              ↩ {describeValue(trace, retStep, retStep.ret, 28, true)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="blk-body">
        {b.items?.filter((it) => !(it.k === 'hdr' && it.l === (b.line ?? b.l))).map((it) => <BlockView key={`${it.k}-${it.l}`} b={it} ctx={ctx} />)}
      </div>
    </div>
  );
}

function ClassBlock({ b, ctx }: { b: Block; ctx: Ctx }) {
  const building = ctx.step.stack.some((f) => f.kind === 'class' && f.name.split('.').pop() === b.name);
  const active = building || inRange(b, ctx.step.line);
  return (
    <div className={`blk blk-class ${active ? 'blk-live' : ''}`}>
      <div className="blk-title">
        <span className="kw">class</span> <span className="cls-name">{b.name}</span>
        {b.bases && b.bases.length > 0 && <span className="punct">({b.bases.join(', ')})</span>}
        {building && <span className="badge-mini">being built</span>}
      </div>
      <div className="blk-body">
        {b.items?.filter((it) => !(it.k === 'hdr' && it.l === (b.line ?? b.l))).map((it) => <BlockView key={`${it.k}-${it.l}`} b={it} ctx={ctx} />)}
      </div>
    </div>
  );
}

const LOOP_KINDS = new Set(['for', 'while']);

function CompoundBlock({ b, ctx }: { b: Block; ctx: Ctx }) {
  const active = inRange(b, ctx.step.line);
  let passes = 0;
  if (LOOP_KINDS.has(b.k)) {
    const list = ctx.index.execs.get(b.line ?? b.l);
    const j = lastAtOrBefore(list, ctx.cur);
    if (j >= 0 && list) {
      const fid = topFrame(ctx.trace.steps[j])?.id;
      let pos = countAtOrBefore(list, ctx.cur) - 1;
      while (pos >= 0 && topFrame(ctx.trace.steps[list[pos]])?.id === fid) {
        passes++;
        pos--;
      }
    }
  }
  return (
    <div className={`blk blk-${b.k} ${active ? 'blk-live' : ''}`}>
      <span className="blk-tag">
        {b.k}
        {passes > 0 && <span className="loop-count" title="How many times the loop line has run"> ↻ {passes}</span>}
      </span>
      {b.items?.map((it) => <BlockView key={`${it.k}-${it.l}`} b={it} ctx={ctx} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A row = one statement (or a header like `for x in y:`), drawn as tokens with
// value boxes under every variable.
// ---------------------------------------------------------------------------

interface RowState {
  ran: boolean;
  complete: boolean;
  before?: Step;
  after?: Step;
  calls?: Step['calls'];
  printed?: string;
  ret?: { step: Step; ref: ValueRef };
  /** For a line that is running right now: values from its previous run. */
  prevAfter?: Step;
  prevKey?: string;
  exc?: { type: string; msg: string };
  key: string;
}

function rowState(ctx: Ctx, row: number): RowState {
  const { trace, index, cur } = ctx;
  const j = lastAtOrBefore(index.execs.get(row), cur);
  if (j < 0) return { ran: false, complete: false, key: 'none' };
  const k = index.next[j];
  const before = trace.steps[j];
  if (k < 0 || k > cur) {
    // Still running: keep showing what the previous run of this line stored.
    const list = index.execs.get(row)!;
    const pos = countAtOrBefore(list, j) - 2;
    let prevAfter: Step | undefined;
    if (pos >= 0) {
      const kk = index.next[list[pos]];
      if (kk >= 0 && kk <= cur) prevAfter = trace.steps[kk];
    }
    return { ran: true, complete: false, before, prevAfter, prevKey: pos >= 0 ? `c${list[pos]}` : undefined, key: `p${j}` };
  }
  const after = trace.steps[k];
  const st: RowState = { ran: true, complete: true, before, after, calls: before.calls, key: `c${j}` };
  if (after.out > before.out) st.printed = trace.stdout.slice(before.out, after.out);
  if (after.event === 'return' && after.ret && after.ret.t !== 'NoneType') st.ret = { step: after, ref: after.ret };
  if (after.event === 'exception' && after.exc) st.exc = after.exc;
  return st;
}

function typeOf(trace: Trace, step: Step, ref?: ValueRef): string {
  if (!ref) return '';
  if (ref.ref === undefined) return ref.t;
  return heapObject(trace, step, ref)?.k ?? '';
}

function RowView({ b, ctx }: { b: Block; ctx: Ctx }) {
  const row = b.l;
  const st = rowState(ctx, row);
  const isActive = ctx.activeRow === row;
  const isDone = ctx.doneRow === row;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isActive, ctx.cur]);

  const physical: number[] = [];
  for (let n = b.l; n <= b.e; n++) physical.push(n);

  return (
    <div
      ref={ref}
      className={`row ${isActive ? 'row-active' : ''} ${isDone ? 'row-done' : ''} ${st.ran ? '' : 'row-idle'} ${b.k === 'hdr' ? 'row-hdr' : ''}`}
    >
      <span className="row-no">{row}</span>
      <div className="row-lines">
        {physical.map((n) => (
          <div className="row-line" key={n}>
            {(ctx.trace.scaffold!.lines[String(n)] ?? []).map((tok, i) => (
              <TokenView key={i} tok={tok} line={n} st={st} ctx={ctx} />
            ))}
          </div>
        ))}
      </div>
      <div className="row-extras">
        {st.printed && (
          <motion.span key={`p-${st.key}`} className="out-chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} title={st.printed}>
            🖨 {clip(st.printed.replace(/\n$/, '').replace(/\n/g, ' ⏎ '), 48)}
          </motion.span>
        )}
        {st.ret && (
          <motion.span key={`r-${st.key}`} className="ret-chip" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}>
            ↩ {describeValue(ctx.trace, st.ret.step, st.ret.ref, 30, true)}
          </motion.span>
        )}
        {st.exc && (
          <span className="exc-chip" title={st.exc.msg}>
            ✖ {st.exc.type}
          </span>
        )}
      </div>
    </div>
  );
}

function TokenView({ tok, line, st, ctx }: { tok: Tok; line: number; st: RowState; ctx: Ctx }) {
  if (tok.k === 'comment') return null;
  if (tok.k !== 'name') {
    return <span className={`tk tk-${tok.k}`}>{tok.s}</span>;
  }
  if (tok.def) return <span className="tk tk-defname">{tok.s}</span>;
  const { trace } = ctx;

  // Value produced by a call (len(x), obj.method(), my_func(...)).
  if (tok.call) {
    const hit = st.complete ? st.calls?.find((c) => c[0] === line && c[1] === tok.c) : undefined;
    const show = hit && !(hit[2] === 'None' && hit[3] === 'NoneType');
    if (!show) return <span className="tk tk-callable">{tok.s}</span>;
    return <VarBox name={tok.s} value={hit![2]} vtype={hit![3]} kind="call" vkey={st.key} />;
  }

  const chain = tok.chain ?? tok.s;
  if (tok.store) {
    const src = st.complete ? st.after : st.prevAfter;
    const ref = src ? resolveChain(trace, src, chain) : undefined;
    return (
      <VarBox
        name={tok.s}
        value={ref && src ? describeValue(trace, src, ref, 26, true) : undefined}
        vtype={src ? typeOf(trace, src, ref) : ''}
        incoming
        dim={!st.complete && !!ref}
        vkey={st.complete ? st.key : st.prevKey}
        pending={st.ran && !st.complete}
      />
    );
  }
  const ref = st.before ? resolveChain(trace, st.before, chain) : undefined;
  if (!ref) {
    // builtins, modules, names not defined yet
    const known = st.before && scopeAt(st.before).has(tok.s);
    return <span className={`tk ${known ? 'tk-name' : 'tk-free'}`}>{tok.s}</span>;
  }
  const obj = ref.ref !== undefined && st.before ? heapObject(trace, st.before, ref) : undefined;
  if (obj && (obj.k === 'module' || obj.k === 'function' || obj.k === 'class')) {
    return <span className="tk tk-callable">{tok.s}</span>;
  }
  return <VarBox name={tok.s} value={describeValue(trace, st.before!, ref, 26, true)} vtype={typeOf(trace, st.before!, ref)} vkey={st.key} />;
}

function valueClass(vtype?: string) {
  if (!vtype) return 'vv-other';
  if (vtype === 'str') return 'vv-str';
  if (['int', 'float', 'complex'].includes(vtype)) return 'vv-num';
  if (['bool', 'NoneType'].includes(vtype)) return 'vv-const';
  if (['list', 'tuple', 'set', 'dict', 'namedtuple'].includes(vtype)) return 'vv-coll';
  return 'vv-other';
}

function VarBox({
  name,
  value,
  vtype,
  incoming,
  kind,
  dim,
  pending,
  vkey,
}: {
  name: string;
  value?: string;
  vtype?: string;
  incoming?: boolean;
  kind?: 'call';
  dim?: boolean;
  pending?: boolean;
  vkey?: string;
}) {
  return (
    <span className={`vbox ${kind === 'call' ? 'vbox-call' : ''} ${incoming ? 'vbox-lhs' : ''} ${dim ? 'vbox-dim' : ''}`} title={value ? `${name} = ${value}` : name}>
      <span className="vbox-name">{name}</span>
      <span className="vbox-val">
        <AnimatePresence mode="popLayout" initial={false}>
          {value !== undefined ? (
            <motion.span
              key={`${value}|${vkey ?? ''}`}
              className={`vv ${valueClass(vtype)}`}
              initial={incoming ? { opacity: 0, x: 70, y: -12, scale: 1.4 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={incoming ? { type: 'spring', stiffness: 120, damping: 15 } : { duration: 0.25 }}
            >
              {value}
            </motion.span>
          ) : (
            <span className="vv vv-empty">{pending ? '…' : ' '}</span>
          )}
        </AnimatePresence>
      </span>
    </span>
  );
}
