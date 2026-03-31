import Editor, { loader, useMonaco } from '@monaco-editor/react';
import { useAppStore } from '../store';
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Setup global editor font defaults
loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' } });

const PYTHON_BUILTINS = [
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr',
  'classmethod', 'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate',
  'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr',
  'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len',
  'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open',
  'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
  'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip'
];

const OFFLINE_COMPLETIONS = {
  os: [
    { label: 'listdir', args: 'path="."' }, { label: 'mkdir', args: 'path, mode=0o777' }, { label: 'makedirs', args: 'name, mode=0o777, exist_ok=False' }, 
    { label: 'remove', args: 'path' }, { label: 'removedirs', args: 'name' }, { label: 'rename', args: 'src, dst' }, { label: 'replace', args: 'src, dst' }, 
    { label: 'rmdir', args: 'path' }, { label: 'system', args: 'command' }, { label: 'environ', args: '' }, { label: 'getcwd', args: '' }, { label: 'chdir', args: 'path' }
  ],
  sys: [
    { label: 'argv', args: '' }, { label: 'exit', args: 'status=None' }, { label: 'path', args: '' }, { label: 'modules', args: '' }, 
    { label: 'stdin', args: '' }, { label: 'stdout', args: '' }, { label: 'stderr', args: '' }, { label: 'version', args: '' }
  ],
  math: [
    { label: 'acos', args: 'x' }, { label: 'asin', args: 'x' }, { label: 'atan', args: 'x' }, { label: 'ceil', args: 'x' }, 
    { label: 'cos', args: 'x' }, { label: 'degrees', args: 'x' }, { label: 'exp', args: 'x' }, { label: 'floor', args: 'x' }, 
    { label: 'isinf', args: 'x' }, { label: 'isnan', args: 'x' }, { label: 'log', args: 'x, base=e' }, { label: 'log10', args: 'x' }, 
    { label: 'pow', args: 'x, y' }, { label: 'radians', args: 'x' }, { label: 'sin', args: 'x' }, { label: 'sqrt', args: 'x' }, { label: 'tan', args: 'x' }, { label: 'trunc', args: 'x' }
  ],
  json: [
    { label: 'dump', args: 'obj, fp' }, { label: 'dumps', args: 'obj' }, { label: 'load', args: 'fp' }, { label: 'loads', args: 's' }
  ],
  re: [
    { label: 'compile', args: 'pattern, flags=0' }, { label: 'search', args: 'pattern, string, flags=0' }, { label: 'match', args: 'pattern, string, flags=0' }, 
    { label: 'fullmatch', args: 'pattern, string, flags=0' }, { label: 'split', args: 'pattern, string, maxsplit=0, flags=0' }, { label: 'findall', args: 'pattern, string, flags=0' }, 
    { label: 'finditer', args: 'pattern, string, flags=0' }, { label: 'sub', args: 'pattern, repl, string, count=0, flags=0' }, { label: 'escape', args: 'pattern' }, { label: 'purge', args: '' }
  ],
  random: [
    { label: 'seed', args: 'a=None' }, { label: 'randrange', args: 'start, stop=None, step=1' }, { label: 'randint', args: 'a, b' }, 
    { label: 'choice', args: 'seq' }, { label: 'choices', args: 'population, weights=None' }, { label: 'shuffle', args: 'x' }, 
    { label: 'sample', args: 'population, k' }, { label: 'random', args: '' }, { label: 'uniform', args: 'a, b' }, { label: 'gauss', args: 'mu, sigma' }
  ],
  string: [
    { label: 'ascii_letters', args: undefined }, { label: 'ascii_lowercase', args: undefined }, { label: 'ascii_uppercase', args: undefined }, 
    { label: 'digits', args: undefined }, { label: 'hexdigits', args: undefined }, { label: 'octdigits', args: undefined }, 
    { label: 'punctuation', args: undefined }, { label: 'printable', args: undefined }, { label: 'whitespace', args: undefined }, 
    { label: 'capwords', args: 's, sep=None' }
  ],
  str: [
    { label: 'capitalize', args: '' }, { label: 'count', args: 'sub, start=None, end=None' }, { label: 'endswith', args: 'suffix, start=None, end=None' }, 
    { label: 'find', args: 'sub, start=None, end=None' }, { label: 'format', args: '*args, **kwargs' }, { label: 'index', args: 'sub, start=None, end=None' }, 
    { label: 'isalnum', args: '' }, { label: 'isalpha', args: '' }, { label: 'isdigit', args: '' }, { label: 'islower', args: '' }, { label: 'isspace', args: '' }, 
    { label: 'isupper', args: '' }, { label: 'join', args: 'iterable' }, { label: 'lower', args: '' }, { label: 'lstrip', args: 'chars=None' }, 
    { label: 'partition', args: 'sep' }, { label: 'replace', args: 'old, new, count=-1' }, { label: 'split', args: 'sep=None, maxsplit=-1' }, 
    { label: 'startswith', args: 'prefix, start=None, end=None' }, { label: 'strip', args: 'chars=None' }, { label: 'title', args: '' }, { label: 'upper', args: '' }
  ],
  list: [
    { label: 'append', args: 'object' }, { label: 'clear', args: '' }, { label: 'copy', args: '' }, { label: 'count', args: 'value' }, 
    { label: 'extend', args: 'iterable' }, { label: 'index', args: 'value, start=0, stop=9223372036854775807' }, { label: 'insert', args: 'index, object' }, 
    { label: 'pop', args: 'index=-1' }, { label: 'remove', args: 'value' }, { label: 'reverse', args: '' }, { label: 'sort', args: '*, key=None, reverse=False' }
  ],
  dict: [
    { label: 'clear', args: '' }, { label: 'copy', args: '' }, { label: 'fromkeys', args: 'iterable, value=None' }, { label: 'get', args: 'key, default=None' }, 
    { label: 'items', args: '' }, { label: 'keys', args: '' }, { label: 'pop', args: 'key, default=...' }, { label: 'popitem', args: '' }, 
    { label: 'setdefault', args: 'key, default=None' }, { label: 'update', args: 'E=None, **F' }, { label: 'values', args: '' }
  ]
};

export function CodeEditor() {
  const { code, setCode, setTimeline } = useAppStore();
  const editorRef = useRef<any>(null);
  const monaco = useMonaco();

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    if (monaco) {
      const provider = monaco.languages.registerCompletionItemProvider('python', {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          };
          
          const lineContent = model.getLineContent(position.lineNumber);
          const untilPos = lineContent.substring(0, position.column - 1);
          
          const dotMatch = untilPos.match(/([a-zA-Z0-9_]+)\.$/);
          
          let suggestions: any[] = [];
          
          // Provide dynamic local functions and classes from current model
          const text = model.getValue();
          const localFuncs = [...text.matchAll(/def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g)].map(m => ({ label: m[1], args: m[2].trim() }));
          const localClasses = [...text.matchAll(/class\s+([a-zA-Z0-9_]+)/g)].map(m => ({ label: m[1], args: '' }));
          const localVars = [...text.matchAll(/([a-zA-Z0-9_]+)\s*=[^=]/g)].map(m => m[1]);
          const uniqueVars = Array.from(new Set(localVars));

          const createSnippet = (m: any) => {
              if (typeof m === 'string') return m;
              if (m.args === '') return `${m.label}()`;
              if (m.args === undefined) return m.label;
              return `${m.label}(\${1:${m.args}})`;
          };

          if (dotMatch) {
             const objName = dotMatch[1];
             if (objName in OFFLINE_COMPLETIONS) {
                suggestions = OFFLINE_COMPLETIONS[objName as keyof typeof OFFLINE_COMPLETIONS].map((m: any) => ({
                   label: typeof m === 'string' ? m : m.label, 
                   detail: typeof m === 'string' ? '' : `(method) ${m.label}(${m.args || ''})`,
                   kind: monaco.languages.CompletionItemKind.Method, 
                   insertText: createSnippet(m),
                   insertTextRules: typeof m === 'object' && m.args !== undefined ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                   range
                }));
             } else {
                // Fallback: it could be a self object or generic list/dict
                const generics = [...OFFLINE_COMPLETIONS.list, ...OFFLINE_COMPLETIONS.dict];
                
                // Extra properties fallback for attributes defined dynamically
                const propRegex = new RegExp(`${objName}\\.([a-zA-Z0-9_]+)`, 'g');
                const propsFound = [...text.matchAll(propRegex)].map(m => ({ label: m[1], args: undefined }));
                
                const allAttr = Array.from(new Set([...generics, ...propsFound].map(m => JSON.stringify(m)))).map(s => JSON.parse(s));

                suggestions = allAttr.map((m: any) => ({
                   label: m.label, 
                   detail: m.args !== undefined ? `(method) ${m.label}(${m.args || ''})` : `(attribute) ${m.label}`,
                   kind: m.args !== undefined ? monaco.languages.CompletionItemKind.Method : monaco.languages.CompletionItemKind.Property, 
                   insertText: createSnippet(m),
                   insertTextRules: m.args !== undefined ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                   range
                }));
             }
          } else {
             // Root suggestions
             const rootItems = [
                 ...PYTHON_BUILTINS.map(b => ({ label: b, kind: monaco.languages.CompletionItemKind.Function, insertText: b, arg: undefined })),
                 ...Object.keys(OFFLINE_COMPLETIONS).map(b => ({ label: b, kind: monaco.languages.CompletionItemKind.Module, insertText: b, arg: undefined })),
                 ...localFuncs.map(f => ({ label: f.label, detail: `(function) ${f.label}(${f.args})`, kind: monaco.languages.CompletionItemKind.Function, insertText: createSnippet(f), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, arg: f.args })),
                 ...localClasses.map(c => ({ label: c.label, kind: monaco.languages.CompletionItemKind.Class, insertText: c.label, arg: undefined })),
                 ...uniqueVars.map(v => ({ label: v, kind: monaco.languages.CompletionItemKind.Variable, insertText: v, arg: undefined }))
             ];

             suggestions = rootItems.map(item => ({
                label: item.label, 
                detail: (item as any).detail || '',
                kind: item.kind, 
                insertText: item.insertText, 
                insertTextRules: (item as any).insertTextRules,
                range
             }));
          }
          
          return { suggestions };
        }
      });
      return () => provider.dispose();
    }
  }, [monaco]);

  useEffect(() => {
    const runAutomatically = async () => {
      try {
        const result: string = await invoke('run_python', { code });
        const data = JSON.parse(result);
        if (data && data.timeline) {
          const cleanedTimeline = data.timeline.filter((step: any, i: number, arr: any[]) => {
              if (i === 0) return true;
              
              // Prevent blank animations on def/class creation which don't dynamically visualize changing state uniquely
              const stepCode = step.code ? step.code.trim() : "";
              if ((stepCode.startsWith('def ') || stepCode.startsWith('class ') || stepCode.startsWith('@')) && step.event === 'line') {
                  return false;
              }

              // Eliminate blank steps for multi-line assignments (internal lines are hidden by LineRenderer)
              const isMultiLineSubsequent = data.scaffold.assignments?.some((a: any) => step.line > a.startLine && step.line <= a.endLine);
              if (isMultiLineSubsequent) {
                   return false; 
              }

              const prev = arr[i - 1];
              if (step.line === prev.line && step.stdout === prev.stdout && !step.return_data && !step.error && step.event !== 'return') {
                   if (JSON.stringify(step.stack) === JSON.stringify(prev.stack)) {
                        return false; 
                   }
              }
              return true;
          });

          useAppStore.getState().setScaffold(data.scaffold);
          setTimeline(cleanedTimeline);
          
          let markers: any[] = [];
          const lastStep = data.timeline[data.timeline.length - 1];
          // Handle dynamic errors inside the timeline
          if (lastStep && lastStep.event === 'error' && lastStep.error) {
             const match = lastStep.error.match(/line (\d+)/i);
             if (match && monaco) {
               const line = parseInt(match[1], 10);
               markers.push({
                 startLineNumber: line,
                 startColumn: 1,
                 endLineNumber: line,
                 endColumn: 1000,
                 message: lastStep.error,
                 severity: monaco.MarkerSeverity.Error
               });
             }
          }
          if (monaco && editorRef.current) {
            monaco.editor.setModelMarkers(editorRef.current.getModel(), 'python', markers);
          }
        }
      } catch (e: any) {
        // Handle compilation syntax errors
        const errStr = String(e);
        console.warn('Auto-run syntax incomplete or error:', errStr);
        if (monaco && editorRef.current) {
          const match = errStr.match(/line (\d+)/i);
          let markers = [];
          if (match) {
            const line = parseInt(match[1], 10);
            markers.push({
              startLineNumber: line,
              startColumn: 1,
              endLineNumber: line,
              endColumn: 1000,
              message: errStr,
              severity: monaco.MarkerSeverity.Error,
            });
          }
          monaco.editor.setModelMarkers(editorRef.current.getModel(), 'python', markers);
        }
      }
    };

    const timer = setTimeout(() => {
      runAutomatically();
    }, 800);

    return () => clearTimeout(timer);
  }, [code, setTimeline]);

  return (
    <div className="pane pane-editor">
      <div className="panel-header">
        Python Workspace
      </div>
      <div className="monaco-editor-container">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="vs-dark"
          value={code}
          onChange={(v) => setCode(v || '')}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 24,
            padding: { top: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            glyphMargin: true,
            fixedOverflowWidgets: true,
          }}
        />
      </div>
      <style>{`
        .monaco-line-highlight {
          background-color: rgba(99, 102, 241, 0.15) !important;
          border-left: 3px solid var(--accent-primary);
        }
        .monaco-glyph-highlight {
          background: var(--accent-primary);
          border-radius: 50%;
          width: 8px !important;
          height: 8px !important;
          margin-left: 8px;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
