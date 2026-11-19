import { useEffect, useState } from 'react';
import { IconX, IconFolder } from '@tabler/icons-react';
import { useAppStore } from '../store';
import { clearIntrospectionCache, detectPython, filesDir, isDesktop } from '../lib/runner';
import { openPath } from '../lib/open';

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const interpreter = useAppStore((s) => s.interpreter);
  const { updateSettings, setSettingsOpen, setInterpreter, requestRun } = useAppStore.getState();
  const [path, setPath] = useState(settings.pythonPath);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState('');

  useEffect(() => {
    if (!open) return;
    setPath(settings.pythonPath);
    setCheck(null);
    filesDir().then(setDir).catch(() => setDir(''));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const test = async () => {
    setBusy(true);
    try {
      const info = await detectPython(path.trim());
      setCheck({ ok: true, text: `Python ${info.version} at ${info.path}` });
      return info;
    } catch (e) {
      setCheck({ ok: false, text: String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveInterpreter = async () => {
    const info = await test();
    if (info || !path.trim()) {
      updateSettings({ pythonPath: path.trim() });
      setInterpreter(info);
      clearIntrospectionCache();
      requestRun();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <span>Settings</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)} title="Close (Esc)">
            <IconX size={18} />
          </button>
        </div>

        <section>
          <h4>Python interpreter</h4>
          <p className="muted">
            Leave empty to find Python automatically
            {interpreter ? ` (currently Python ${interpreter.version} – ${interpreter.path})` : ''}. Otherwise enter the full path,
            e.g. <code>/opt/homebrew/bin/python3</code> or <code>C:\Python312\python.exe</code>.
          </p>
          <div className="row">
            <input className="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Auto-detect" spellCheck={false} />
            <button className="btn" onClick={test} disabled={busy || !isDesktop()}>
              Test
            </button>
            <button className="btn btn-primary" onClick={saveInterpreter} disabled={busy || !isDesktop()}>
              Use
            </button>
          </div>
          {check && <pre className={`check ${check.ok ? 'check-ok' : 'check-bad'}`}>{check.text}</pre>}
        </section>

        <section className="grid2">
          <label>
            <span>Maximum steps recorded</span>
            <input
              className="text"
              type="number"
              min={50}
              max={20000}
              step={50}
              key={`maxSteps-${settings.maxSteps}`}
              defaultValue={settings.maxSteps}
              onBlur={(e) => updateSettings({ maxSteps: Number(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <label>
            <span>Time limit (seconds)</span>
            <input
              className="text"
              type="number"
              min={1}
              max={120}
              key={`timeLimit-${settings.timeLimit}`}
              defaultValue={settings.timeLimit}
              onBlur={(e) => updateSettings({ timeLimit: Number(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <label>
            <span>Editor font size</span>
            <input
              className="text"
              type="number"
              min={10}
              max={28}
              key={`fontSize-${settings.fontSize}`}
              defaultValue={settings.fontSize}
              onBlur={(e) => updateSettings({ fontSize: Number(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={settings.showInlineValues}
              onChange={(e) => updateSettings({ showInlineValues: e.target.checked })}
            />
            <span>Show values next to the code</span>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={settings.autoRun} onChange={(e) => updateSettings({ autoRun: e.target.checked })} />
            <span>Run automatically while typing</span>
          </label>
        </section>

        {dir && (
          <section>
            <h4>Files your programs create</h4>
            <p className="muted">
              Programs run inside <code>{dir}</code>, so <code>open("notes.txt", "w")</code> saves the file there.
            </p>
            <button className="btn" onClick={() => openPath(dir)}>
              <IconFolder size={16} /> Open folder
            </button>
          </section>
        )}

        <section>
          <h4>Keyboard shortcuts</h4>
          <div className="shortcuts">
            <kbd>Ctrl/⌘ + Enter</kbd> run · <kbd>←</kbd> <kbd>→</kbd> step · <kbd>Space</kbd> play/pause · <kbd>Home</kbd>{' '}
            <kbd>End</kbd> first/last step
          </div>
        </section>
      </div>
    </div>
  );
}
