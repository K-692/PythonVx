// Shapes of the JSON produced by src-tauri/python/tracer.py

/** A primitive shown inline, or a reference to a heap object. */
export type ValueRef =
  | { t: string; v: string; len?: number; ref?: undefined }
  | { ref: number; t?: undefined; v?: undefined };

export interface FrameSnapshot {
  id: number;
  name: string;
  kind?: 'module' | 'function' | 'class' | 'comprehension';
  line: number;
  vars: [string, ValueRef][];
}

export type Change = [name: string, kind: 'new' | 'changed' | 'deleted', frameId?: number];

export interface Step {
  line: number;
  event: 'line' | 'call' | 'return' | 'exception';
  stack: FrameSnapshot[];
  /** object id -> index into Trace.objects */
  heap: Record<string, number>;
  /** number of output characters printed so far */
  out: number;
  changes: Change[];
  ret?: ValueRef;
  exc?: { type: string; msg: string };
  unwinding?: boolean;
  /** Values produced by calls made on this line: [line, col, text, type] */
  calls?: [number, number, string, string][];
}

export interface Tok {
  s: string;
  c: number;
  k: 'name' | 'kw' | 'num' | 'str' | 'op' | 'comment';
  chain?: string;
  attr?: boolean;
  store?: boolean;
  call?: boolean;
  def?: boolean;
}

export interface Block {
  k: string; // module | stmt | hdr | def | class | if | for | while | try | with | except | case | match ...
  l: number;
  e: number;
  line?: number;
  name?: string;
  qual?: string;
  args?: string[];
  bases?: string[];
  items?: Block[];
}

export interface Scaffold {
  lines: Record<string, Tok[]>;
  blocks: Block;
}

export type HeapObject =
  | { k: 'list' | 'tuple' | 'set'; type: string; items: ValueRef[]; len: number }
  | { k: 'namedtuple'; type: string; fields: string[]; items: ValueRef[]; len: number }
  | { k: 'dict'; type: string; entries: [ValueRef, ValueRef][]; len: number }
  | { k: 'instance'; type: string; attrs: [string, ValueRef][]; repr: string | null }
  | { k: 'class'; type: 'class'; name: string; bases: string[]; attrs: [string, ValueRef][]; user: boolean }
  | { k: 'function'; type: string; name: string; sig: string; user: boolean; line?: number | null; self?: ValueRef }
  | { k: 'module'; type: 'module'; name: string; doc: string }
  | { k: 'other'; type: string; repr: string; len?: number };

export interface TraceError {
  type: string;
  msg: string;
  line: number | null;
  col?: number | null;
  end_line?: number | null;
  end_col?: number | null;
  traceback: string;
  phase: 'compile' | 'run';
}

export interface Trace {
  version: number;
  python: string;
  steps: Step[];
  objects: HeapObject[];
  error: TraceError | null;
  limit: null | 'time' | 'interrupt';
  step_limit_hit?: boolean;
  exit_code: number | string | null;
  stdout: string;
  stdout_truncated?: boolean;
  sleep_capped?: boolean;
  elapsed_ms?: number;
  scaffold?: Scaffold | null;
}

export interface Interpreter {
  path: string;
  version: string;
}

export interface MemberInfo {
  name: string;
  kind: 'module' | 'class' | 'function' | 'constant';
  doc: string;
  sig?: string;
}
