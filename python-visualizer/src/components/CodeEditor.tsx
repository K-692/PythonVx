import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { useAppStore } from '../store';
import { runCode } from '../lib/runner';
import { describeValue, errorStepIndex } from '../lib/explain';
import '../lib/monacoSetup';

// Inline values are drawn with generated ::after rules (reliable across Monaco builds).
function setInlineStyles(rules: Record<string, string>) {
  let el = document.getElementById('pvx-inline-styles') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'pvx-inline-styles';
    document.head.appendChild(el);
  }
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
  el.textContent = Object.entries(rules)
    .map(([cls, text]) => `.${cls}::after { content: "${esc(text)}"; }`)
    .join('\n');
}

export function CodeEditor() {
  const code = useAppStore((s) => s.code);
  const setCode = useAppStore((s) => s.setCode);
  const trace = useAppStore((s) => s.trace);
  const stepIndex = useAppStore((s) => s.stepIndex);
  const dirty = useAppStore((s) => s.dirty);
  const settings = useAppStore((s) => s.settings);
  const stdin = useAppStore((s) => s.stdin);
  const runRequest = useAppStore((s) => s.runRequest);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor as unknown as Monaco.editor.IStandaloneCodeEditor;
    monacoRef.current = monaco as unknown as typeof Monaco;
    decorations.current = editorRef.current.createDecorationsCollection();
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      useAppStore.getState().requestRun();
    });
    editor.focus();
  };

  // Auto-run (debounced) when code or input changes; explicit runs go immediately.
  useEffect(() => {
    if (!settings.autoRun) return;
    const t = setTimeout(() => void runCode(), 700);
    return () => clearTimeout(t);
  }, [code, stdin, settings.autoRun]);

  useEffect(() => {
    if (runRequest > 0) void runCode();
  }, [runRequest]);

  // Error markers (red squiggles) for the traced program.
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    const markers: Monaco.editor.IMarkerData[] = [];
    const err = trace?.error;
    if (err && err.line && !dirty) {
      const line = Math.min(Math.max(1, err.line), model.getLineCount());
      const startCol = err.phase === 'compile' && err.col ? Math.max(1, err.col) : model.getLineFirstNonWhitespaceColumn(line) || 1;
      markers.push({
        startLineNumber: line,
        startColumn: startCol,
        endLineNumber: err.end_line && err.end_line >= line ? Math.min(err.end_line, model.getLineCount()) : line,
        endColumn: err.end_col && err.end_line === line && err.end_col > startCol ? err.end_col : model.getLineMaxColumn(line),
        message: `${err.type}: ${err.msg}`,
        severity: monaco.MarkerSeverity.Error,
      });
    }
    monaco.editor.setModelMarkers(model, 'pythonvx', markers);
  }, [trace, dirty]);

  // Highlight "just ran" and "runs next" lines, plus inline values.
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !decorations.current) return;
    if (!trace || !trace.steps.length || dirty) {
      decorations.current.clear();
      setInlineStyles({});
      return;
    }
    const inline: Record<string, string> = {};
    const step = trace.steps[stepIndex];
    if (!step) return;
    const prev = stepIndex > 0 ? trace.steps[stepIndex - 1] : undefined;
    const valid = (n: number) => n >= 1 && n <= lineCount;
    const list: Monaco.editor.IModelDeltaDecoration[] = [];
    const isErr = step.event === 'exception' || step.unwinding || (trace.error && stepIndex === errorStepIndex(trace));

    if (prev && valid(prev.line) && prev.line !== step.line) {
      list.push({
        range: new monaco.Range(prev.line, 1, prev.line, 1),
        options: { isWholeLine: true, className: 'line-prev', glyphMarginClassName: 'glyph-prev', glyphMarginHoverMessage: { value: 'Line that just ran' } },
      });
    }
    if (valid(step.line)) {
      list.push({
        range: new monaco.Range(step.line, 1, step.line, 1),
        options: {
          isWholeLine: true,
          className: isErr ? 'line-error' : step.event === 'return' ? 'line-return' : 'line-current',
          glyphMarginClassName: isErr ? 'glyph-error' : 'glyph-current',
          glyphMarginHoverMessage: { value: 'Line that runs next' },
        },
      });
    }
    // Inline values for whatever changed on the line that just ran.
    if (settings.showInlineValues && step.changes.length) {
      const top = step.stack[step.stack.length - 1];
      // The changes were made by the last line that ran in this same frame.
      let target = step.line;
      for (let i = stepIndex - 1; i >= 0; i--) {
        const s = trace.steps[i];
        const t = s.stack[s.stack.length - 1];
        if (t && top && t.id === top.id) {
          target = s.line;
          break;
        }
      }
      const parts = step.changes
        .filter(([, kind, fid]) => kind !== 'deleted' && fid === undefined)
        .map(([name]) => {
          const ref = top?.vars.find(([n]) => n === name)?.[1];
          return `${name} = ${describeValue(trace, step, ref, 30)}`;
        });
      if (parts.length && valid(target)) {
        const col = editor.getModel()?.getLineMaxColumn(target) ?? 1;
        list.push({
          range: new monaco.Range(target, col, target, col),
          options: { afterContentClassName: 'inline-value pvx-inl-a' },
        });
        inline['pvx-inl-a'] = `   ◂ ${parts.join(',  ')}`;
      }
    }
    if (step.event === 'return' && step.ret && valid(step.line) && settings.showInlineValues) {
      const col = editor.getModel()?.getLineMaxColumn(step.line) ?? 1;
      list.push({
        range: new monaco.Range(step.line, col, step.line, col),
        options: { afterContentClassName: 'inline-return pvx-inl-r' },
      });
      inline['pvx-inl-r'] = `   ⏎ returns ${describeValue(trace, step, step.ret, 40)}`;
    }
    setInlineStyles(inline);
    decorations.current.set(list);
    if (valid(step.line)) editor.revealLineInCenterIfOutsideViewport(step.line, monaco.editor.ScrollType.Smooth);
  }, [trace, stepIndex, dirty, lineCount, settings.showInlineValues]);

  return (
    <div className="pane pane-editor">
      <div className="panel-header">
        <span>Your code</span>
        <span className="header-hint">{dirty && trace ? 'edited – run again to update' : 'Ctrl/⌘ + Enter to run'}</span>
      </div>
      <div className="monaco-editor-container">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="pythonvx"
          value={code}
          onChange={(v) => setCode(v ?? '')}
          onMount={onMount}
          loading={<div className="empty-hint">Loading editor…</div>}
          options={{
            minimap: { enabled: false },
            fontSize: settings.fontSize,
            fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
            fontLigatures: false,
            lineHeight: Math.round(settings.fontSize * 1.7),
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            glyphMargin: true,
            fixedOverflowWidgets: true,
            tabSize: 4,
            insertSpaces: true,
            detectIndentation: false,
            renderWhitespace: 'none',
            automaticLayout: true,
            wordWrap: 'off',
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
          }}
        />
      </div>
    </div>
  );
}
