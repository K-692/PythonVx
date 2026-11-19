// Bundle Monaco locally so the editor works offline (no CDN).
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import { loader } from '@monaco-editor/react';
import { registerPythonIntelligence } from './completions';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme('pythonvx', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7a90', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c792ea' },
    { token: 'string', foreground: 'c3e88d' },
    { token: 'number', foreground: 'f78c6c' },
  ],
  colors: {
    'editor.background': '#0f111a',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorLineNumber.foreground': '#3b4252',
    'editorLineNumber.activeForeground': '#94a3b8',
    'editorGutter.background': '#0f111a',
  },
});

registerPythonIntelligence(monaco as unknown as typeof import('monaco-editor'));
loader.config({ monaco });

export { monaco };
