import { useAppStore } from '../store';
import { isDesktop } from '../lib/runner';

export function StatusBar() {
  const status = useAppStore((s) => s.status);
  const trace = useAppStore((s) => s.trace);
  const interpreter = useAppStore((s) => s.interpreter);
  const runError = useAppStore((s) => s.runError);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const notice = useAppStore((s) => s.notice);
  const savedCode = useAppStore((s) => s.savedCode);
  const restore = useAppStore((s) => s.restoreSavedCode);

  let message = 'Ready';
  if (status === 'running') message = 'Running…';
  else if (runError) message = 'Could not run the program';
  else if (trace?.error) message = `Stopped with ${trace.error.type}`;
  else if (trace) message = `Finished in ${trace.elapsed_ms ?? 0} ms · ${trace.steps.length} steps`;

  return (
    <footer className="statusbar">
      <span className={`status-dot status-${runError || trace?.error ? 'bad' : status}`} />
      <span>{message}</span>
      {notice && <span className="status-notice">· {notice}</span>}
      {savedCode != null && (
        <button className="link-btn" onClick={restore} title="Put back the code you had before loading an example">
          ↩ Restore my code
        </button>
      )}
      <span className="spacer" />
      {isDesktop() || interpreter ? (
        <button className="link-btn" onClick={() => setSettingsOpen(true)} title="Change interpreter in Settings">
          {interpreter ? `Python ${interpreter.version}` : 'Python not found – open Settings'}
        </button>
      ) : (
        <span>Browser preview (Python runs only in the desktop app)</span>
      )}
    </footer>
  );
}
