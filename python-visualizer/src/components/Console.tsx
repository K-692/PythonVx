import { useEffect, useMemo, useRef } from 'react';
import { useAppStore, shownTrace } from '../store';

/** Program output (up to the current step) and the program's input box. */
export function Console() {
  const trace = useAppStore((s) => shownTrace(s));
  const stepIndex = useAppStore((s) => s.stepIndex);
  const stdin = useAppStore((s) => s.stdin);
  const setStdin = useAppStore((s) => s.setStdin);
  const outRef = useRef<HTMLPreElement>(null);

  const { before, fresh, isEnd } = useMemo(() => {
    if (!trace) return { before: '', fresh: '', isEnd: false };
    const n = trace.steps.length;
    const atEnd = n === 0 || stepIndex >= n - 1;
    // At the last step show everything (includes output printed after the step limit).
    const upto = atEnd ? trace.stdout.length : trace.steps[stepIndex].out;
    const prevUpto = stepIndex > 0 && n ? trace.steps[stepIndex - 1].out : 0;
    const from = Math.min(prevUpto, upto);
    return { before: trace.stdout.slice(0, from), fresh: trace.stdout.slice(from, upto), isEnd: atEnd };
  }, [trace, stepIndex]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [before, fresh]);

  const usesInput = useAppStore((s) => /\binput\s*\(/.test(s.code));

  return (
    <div className="console">
      <div className="console-out">
        <div className="panel-header small">
          <span>Output</span>
          {trace && <span className="header-hint">{isEnd ? 'complete' : 'up to this step'}</span>}
        </div>
        <pre ref={outRef} className="console-text">
          {before}
          {fresh && <span className="console-fresh">{fresh}</span>}
          {!before && !fresh && <span className="console-placeholder">Nothing printed yet.</span>}
        </pre>
      </div>
      <div className={`console-in ${usesInput ? 'console-in-needed' : ''}`}>
        <div className="panel-header small">
          <span>Program input</span>
          <span className="header-hint">one line per input()</span>
        </div>
        <textarea
          className="console-input"
          value={stdin}
          spellCheck={false}
          placeholder={usesInput ? 'Your program calls input().\nType each answer on its own line…' : 'Values for input(), one per line'}
          onChange={(e) => setStdin(e.target.value)}
        />
      </div>
    </div>
  );
}
