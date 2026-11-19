import { useEffect } from 'react';
import Split from 'react-split';
import { Toolbar } from './components/Toolbar';
import { CodeEditor } from './components/CodeEditor';
import { Visualizer } from './components/Visualizer';
import { Console } from './components/Console';
import { SettingsDialog } from './components/SettingsDialog';
import { StatusBar } from './components/StatusBar';
import { useAppStore } from './store';
import { detectPython, isDesktop } from './lib/runner';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.monaco-editor');
}

function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        s.requestRun();
        return;
      }
      if (isTyping(e.target) || s.settingsOpen) return;
      const n = s.trace?.steps.length ?? 0;
      if (e.key === 'ArrowRight') s.stepBy(1);
      else if (e.key === 'ArrowLeft') s.stepBy(-1);
      else if (e.key === 'Home') s.setStepIndex(0);
      else if (e.key === 'End') s.setStepIndex(n - 1);
      else if (e.key === ' ') s.setPlaying(!s.isPlaying);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    const s = useAppStore.getState();
    detectPython(s.settings.pythonPath)
      .then((info) => s.setInterpreter(info))
      .catch(() => s.setInterpreter(null));
  }, []);

  return (
    <div className="app-container">
      <Toolbar />
      <Split className="main-content" sizes={[46, 54]} minSize={320} gutterSize={6} direction="horizontal" cursor="col-resize">
        <Split className="left-col" direction="vertical" sizes={[68, 32]} minSize={[160, 110]} gutterSize={6} cursor="row-resize">
          <CodeEditor />
          <Console />
        </Split>
        <Visualizer />
      </Split>
      <StatusBar />
      <SettingsDialog />
    </div>
  );
}

export default App;
