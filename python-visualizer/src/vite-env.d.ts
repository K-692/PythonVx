/// <reference types="vite/client" />

declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
declare module 'monaco-editor/esm/vs/editor/editor.worker.js?worker' {
  const WorkerFactory: { new (): Worker };
  export default WorkerFactory;
}
