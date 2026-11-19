// Indexes that let the block diagram answer "what were the values on this
// line, the last time it ran?" quickly for any step of the trace.
import type { Block, FrameSnapshot, Step, Trace, ValueRef } from '../types';
import { heapObject } from './explain';

export interface FlowIndex {
  /** physical line -> row id (first line of its statement / header line) */
  rowOf: Map<number, number>;
  /** row -> indices of "line" steps that executed it (ascending) */
  execs: Map<number, number[]>;
  /** next step index whose active frame is the same (-1 if none) */
  next: Int32Array;
  /** def block start line -> indices of its "call" steps */
  callSteps: Map<number, number[]>;
  /** def block start line -> indices of its "return" steps that have a value */
  retSteps: Map<number, number[]>;
  /** frame id -> def block start line */
  frameDef: Map<number, number>;
  defs: Block[];
}

const topOf = (s: Step): FrameSnapshot | undefined => s.stack[s.stack.length - 1];

export function buildIndex(trace: Trace): FlowIndex | null {
  const sc = trace.scaffold;
  if (!sc) return null;
  const rowOf = new Map<number, number>();
  const defs: Block[] = [];
  const defByLine = new Map<number, Block>();
  const walk = (b: Block) => {
    if (b.k === 'stmt') for (let n = b.l; n <= b.e; n++) rowOf.set(n, b.l);
    else if (b.k === 'hdr') rowOf.set(b.l, b.l);
    if (b.k === 'def') {
      defs.push(b);
      defByLine.set(b.l, b);
      if (b.line) defByLine.set(b.line, b);
    }
    b.items?.forEach(walk);
  };
  walk(sc.blocks);

  const n = trace.steps.length;
  const execs = new Map<number, number[]>();
  const next = new Int32Array(n).fill(-1);
  const lastOfFrame = new Map<number, number>();
  const callSteps = new Map<number, number[]>();
  const retSteps = new Map<number, number[]>();
  const frameDef = new Map<number, number>();

  for (let i = 0; i < n; i++) {
    const s = trace.steps[i];
    const top = topOf(s);
    if (!top) continue;
    const p = lastOfFrame.get(top.id);
    if (p !== undefined) next[p] = i;
    lastOfFrame.set(top.id, i);

    if (s.event === 'line') {
      const row = rowOf.get(s.line) ?? s.line;
      let list = execs.get(row);
      if (!list) execs.set(row, (list = []));
      list.push(i);
    } else if (s.event === 'call' && top.kind === 'function') {
      const def = defByLine.get(s.line);
      if (def) {
        frameDef.set(top.id, def.l);
        let list = callSteps.get(def.l);
        if (!list) callSteps.set(def.l, (list = []));
        list.push(i);
      }
    } else if (s.event === 'return' && s.ret && frameDef.has(top.id)) {
      const key = frameDef.get(top.id)!;
      let list = retSteps.get(key);
      if (!list) retSteps.set(key, (list = []));
      list.push(i);
    }
  }
  return { rowOf, execs, next, callSteps, retSteps, frameDef, defs };
}

/** Largest element of the ascending `list` that is <= x, or -1. */
export function lastAtOrBefore(list: number[] | undefined, x: number): number {
  if (!list || !list.length || list[0] > x) return -1;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

export function countAtOrBefore(list: number[] | undefined, x: number): number {
  if (!list) return 0;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type Scope = Map<string, ValueRef>;

const scopeCache = new WeakMap<Step, Scope>();
/** Variables visible at a step: globals overlaid with the active frame. */
export function scopeAt(step: Step): Scope {
  let s = scopeCache.get(step);
  if (s) return s;
  s = new Map();
  const g = step.stack[0];
  if (g) for (const [k, v] of g.vars) s.set(k, v);
  const top = topOf(step);
  if (top && top !== g) for (const [k, v] of top.vars) s.set(k, v);
  scopeCache.set(step, s);
  return s;
}

/** Follow a dotted name like `self.balance` through the heap snapshot. */
export function resolveChain(trace: Trace, step: Step, chain: string): ValueRef | undefined {
  const parts = chain.split('.');
  let ref = scopeAt(step).get(parts[0]);
  for (let i = 1; i < parts.length && ref; i++) {
    const obj = heapObject(trace, step, ref);
    if (!obj) return undefined;
    const name = parts[i];
    if (obj.k === 'instance' || obj.k === 'class') {
      ref = obj.attrs.find(([n]) => n === name)?.[1];
      if (!ref && obj.k === 'instance') {
        // method or class attribute: look on the class
        const cls = [...scopeAt(step).values()]
          .map((r) => heapObject(trace, step, r))
          .find((o) => o && o.k === 'class' && o.name === obj.type);
        ref = cls && cls.k === 'class' ? cls.attrs.find(([n]) => n === name)?.[1] : undefined;
      }
    } else if (obj.k === 'namedtuple') {
      const idx = obj.fields.indexOf(name);
      ref = idx >= 0 ? obj.items[idx] : undefined;
    } else {
      return undefined;
    }
  }
  return ref;
}

export function topFrame(step: Step) {
  return topOf(step);
}
