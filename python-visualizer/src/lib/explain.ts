import type { HeapObject, Step, Trace, ValueRef } from '../types';

export function heapObject(trace: Trace, step: Step, ref: ValueRef): HeapObject | undefined {
  if (ref.ref === undefined) return undefined;
  const idx = step.heap[String(ref.ref)];
  return idx === undefined ? undefined : trace.objects[idx];
}

/** Objects drawn as boxes in the Objects area (everything else is shown inline). */
export function isBoxed(obj: HeapObject | undefined): boolean {
  return !!obj && ['list', 'tuple', 'set', 'dict', 'namedtuple', 'instance'].includes(obj.k);
}

const KIND_WORD: Record<string, string> = {
  list: 'list',
  tuple: 'tuple',
  set: 'set',
  dict: 'dictionary',
  namedtuple: 'named tuple',
};

/** Short human description of any value, e.g. `5`, `'hi'`, `a list of 3 items`. */
export function describeValue(trace: Trace, step: Step, ref: ValueRef | undefined, max = 40): string {
  if (!ref) return '?';
  if (ref.ref === undefined) return clip(ref.v, max);
  const obj = heapObject(trace, step, ref);
  if (!obj) return 'an object';
  switch (obj.k) {
    case 'list':
    case 'tuple':
    case 'set':
    case 'namedtuple': {
      const shown = obj.items.map((i) => (i.ref === undefined ? i.v : '…')).join(', ');
      const [open, close] = obj.k === 'list' ? ['[', ']'] : obj.k === 'set' ? ['{', '}'] : ['(', ')'];
      const literal = obj.len > obj.items.length ? null : `${open}${shown}${close}`;
      if (literal && literal.length <= max) return literal;
      return `a ${KIND_WORD[obj.k]} of ${obj.len} item${obj.len === 1 ? '' : 's'}`;
    }
    case 'dict':
      return `a ${obj.type === 'dict' ? 'dictionary' : obj.type} with ${obj.len} key${obj.len === 1 ? '' : 's'}`;
    case 'instance':
      return `a ${obj.type} object`;
    case 'function':
      return `function ${obj.name}${obj.sig}`;
    case 'class':
      return `class ${obj.name}`;
    case 'module':
      return `module ${obj.name}`;
    default:
      return clip(obj.repr, max);
  }
}

export function clip(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export type Tone = 'info' | 'call' | 'return' | 'error' | 'done' | 'output';

export interface Explanation {
  tone: Tone;
  title: string;
  details: string[];
}

function varLookup(step: Step, frameId: number, name: string): ValueRef | undefined {
  const frame = step.stack.find((f) => f.id === frameId);
  return frame?.vars.find(([n]) => n === name)?.[1];
}

/** Find the previous step that belongs to the same frame (for "changed from" text). */
function previousOfFrame(trace: Trace, index: number, frameId: number): Step | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const s = trace.steps[i];
    if (s.stack.some((f) => f.id === frameId)) return s;
  }
  return undefined;
}

/** Plain-English description of what happened to reach step `index`. */
export function explainStep(trace: Trace, index: number, lines: string[]): Explanation {
  const step = trace.steps[index];
  const prev = index > 0 ? trace.steps[index - 1] : undefined;
  const top = step.stack[step.stack.length - 1];
  const details: string[] = [];
  const codeAt = (n: number) => (lines[n - 1] ?? '').trim();

  // What did the previous line do?
  if (top) {
    for (const [name, kind, frameId] of step.changes) {
      const fid = frameId ?? top.id;
      const value = varLookup(step, fid, name);
      const where = frameId !== undefined ? ` (in ${step.stack.find((f) => f.id === fid)?.name ?? 'caller'})` : '';
      if (kind === 'new') {
        details.push(`Created \`${name}\`${where} = ${describeValue(trace, step, value)}`);
      } else if (kind === 'deleted') {
        details.push(`Removed \`${name}\`${where}`);
      } else {
        const before = previousOfFrame(trace, index, fid);
        const old = before ? varLookup(before, fid, name) : undefined;
        if (value && old && value.ref !== undefined && old.ref === value.ref) {
          details.push(`\`${name}\`${where} was modified → ${describeValue(trace, step, value)}`);
        } else {
          const oldText = before && old ? describeValue(trace, before, old) : '?';
          details.push(`\`${name}\`${where} changed: ${oldText} → ${describeValue(trace, step, value)}`);
        }
      }
    }
  }
  if (prev && step.out > prev.out) {
    const printed = trace.stdout.slice(prev.out, step.out).replace(/\n$/, '');
    details.push(`Printed: ${clip(printed, 120)}`);
  }

  const fname = top?.name ?? 'program';
  if (top?.kind === 'class' && (step.event === 'call' || step.event === 'return')) {
    return step.event === 'call'
      ? { tone: 'call', title: `Building class ${fname}`, details: [...details, 'Python runs the class body to collect its methods and attributes.'] }
      : { tone: 'return', title: `Class ${fname} is ready`, details: [...details, `The name ${fname} now refers to this class; call ${fname}(...) to make objects.`] };
  }
  if (step.event === 'call') {
    const args = top?.vars.map(([n, v]) => `${n} = ${describeValue(trace, step, v, 24)}`).join(', ');
    return {
      tone: 'call',
      title: `Calling ${fname}(${args ?? ''})`,
      details: [
        ...details,
        top && top.vars.length
          ? 'A new frame is created; the arguments become its local variables.'
          : 'A new frame is created for this call.',
      ],
    };
  }
  if (step.event === 'return') {
    if (step.stack.length <= 1 && top?.name === 'Global') {
      return { tone: trace.error ? 'error' : 'done', title: trace.error ? 'Program stopped with an error' : 'Program finished', details };
    }
    if (step.unwinding) {
      return {
        tone: 'error',
        title: `${fname} stops early because of the error`,
        details: [...details, 'The error is passed back to whoever called this function.'],
      };
    }
    return {
      tone: 'return',
      title: `${fname} returns ${describeValue(trace, step, step.ret, 60)}`,
      details: [...details, 'Its frame disappears and the value goes back to the caller.'],
    };
  }
  if (step.event === 'exception' && step.exc) {
    return {
      tone: 'error',
      title: `${step.exc.type} on line ${step.line}`,
      details: [...details, step.exc.msg, errorHint(step.exc.type, step.exc.msg), 'Python now looks for a matching except block; if there is none, the program stops.'].filter(Boolean),
    };
  }

  // A normal "line" step: the arrow is on the line that runs next.
  const code = codeAt(step.line);
  const loop = /^(for|while)\b/.test(code) && prev && prev.line > step.line;
  const title = index === 0 ? `Starting at line ${step.line}` : loop ? `Back to the loop on line ${step.line}` : `Next: line ${step.line}`;
  if (!details.length && prev && prev.event === 'line') {
    const prevCode = codeAt(prev.line);
    if (/^(if|elif|while)\b/.test(prevCode)) {
      const jumped = step.line !== prev.line + 1;
      details.push(jumped ? `The condition on line ${prev.line} was False, so its block was skipped.` : `The condition on line ${prev.line} was True.`);
    } else if (/^(else)\b/.test(prevCode)) {
      details.push('None of the earlier conditions were True, so the else block runs.');
    } else if (/^import |^from .* import /.test(prevCode)) {
      details.push(`Line ${prev.line} loaded a module.`);
    } else if (/^for\b/.test(prevCode) && step.line !== prev.line + 1) {
      details.push('The loop has no more items, so it ends.');
    }
  }
  return { tone: 'info', title, details };
}

const HINTS: Record<string, string> = {
  NameError: 'Python does not know this name. Check the spelling, and make sure the variable is created before it is used.',
  UnboundLocalError: 'A variable is used inside a function before it gets a value there. Use "global" if you meant the outer variable.',
  TypeError: 'An operation got a value of the wrong type — for example adding a number to text. Use int(), str() or float() to convert.',
  ValueError: 'The type was right but the value was not, e.g. int("abc").',
  ZeroDivisionError: 'You divided by zero. Check the divisor before dividing.',
  IndexError: 'You asked for a position that does not exist. Positions start at 0 and stop at len(list) - 1.',
  KeyError: 'The dictionary has no such key. Use dict.get(key) or check with "key in dict" first.',
  AttributeError: 'This object has no attribute / method with that name. Check the spelling and the type of the object.',
  SyntaxError: 'Python could not understand this line. Look for missing brackets, quotes, colons or commas.',
  IndentationError: 'The spaces at the start of the line are wrong. Blocks after ":" must be indented consistently (4 spaces).',
  TabError: 'Tabs and spaces are mixed. Use only spaces for indentation.',
  RecursionError: 'A function called itself too many times. Make sure the recursion has a base case that stops it.',
  ModuleNotFoundError: 'This module is not part of the standard library or is not installed. Third-party packages can be installed with "pip install <name>".',
  ImportError: 'The module exists but does not contain that name. Check the spelling.',
  FileNotFoundError: 'The file does not exist. Relative paths are resolved inside the PythonVx files folder (see Settings).',
  EOFError: 'The program asked for input() but none was left. Type the values into the "Program input" box, one per line.',
  AssertionError: 'An assert statement found a condition that was False.',
  StopIteration: 'next() was called on an iterator that has no more items.',
  OverflowError: 'A number got too large to handle.',
  MemoryError: 'The program used too much memory.',
};

export function errorHint(type: string, _msg?: string): string {
  return HINTS[type] ?? '';
}

/** Step index for "the step where the error happened" (first uncaught exception in the module). */
export function errorStepIndex(trace: Trace): number {
  if (!trace.error) return -1;
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    if (trace.steps[i].event === 'exception') {
      // walk back to the first exception event of this chain
      let j = i;
      while (j > 0 && (trace.steps[j - 1].event === 'exception' || trace.steps[j - 1].unwinding)) j--;
      return j;
    }
  }
  return trace.steps.length - 1;
}
