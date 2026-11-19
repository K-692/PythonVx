import { useEffect } from 'react';
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconChevronLeft,
  IconChevronRight,
  IconBolt,
  IconSettings,
  IconBrandGithub,
  IconLoader2,
  IconAlertTriangle,
  IconRepeat,
  IconRepeatOff,
} from '@tabler/icons-react';
import { useAppStore, stepCount, shownTrace } from '../store';
import { EXAMPLES } from '../examples';
import { errorStepIndex } from '../lib/explain';
import { openUrl } from '../lib/open';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const BASE_MS = 1100;

export function Toolbar() {
  const trace = useAppStore((s) => shownTrace(s));
  const stepIndex = useAppStore((s) => s.stepIndex);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const speed = useAppStore((s) => s.speed);
  const status = useAppStore((s) => s.status);
  const autoRun = useAppStore((s) => s.settings.autoRun);
  const loop = useAppStore((s) => s.settings.loop);
  const { setPlaying, stepBy, setStepIndex, setSpeed, requestRun, setSettingsOpen, setCode, setStdin, updateSettings } =
    useAppStore.getState();

  const total = trace?.steps.length ?? 0;
  const hasSteps = total > 0;

  // Playback: keeps flowing through the program (and loops) until paused.
  useEffect(() => {
    if (!isPlaying) return;
    let hold = 0;
    const t = setInterval(() => {
      const s = useAppStore.getState();
      const n = stepCount(s);
      if (s.stepIndex >= n - 1 && hold < 2) {
        hold++; // linger on the final state before starting over
        return;
      }
      hold = 0;
      s.tick();
    }, BASE_MS / speed);
    return () => clearInterval(t);
  }, [isPlaying, speed]);

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    const s = useAppStore.getState();
    if (s.code.trim() && !EXAMPLES.some((e) => e.code === s.code)) {
      if (!window.confirm('Replace the code in the editor with this example?')) return;
    }
    setCode(ex.code);
    setStdin(ex.stdin ?? '');
    if (!autoRun) requestRun();
  };

  const errIdx = trace ? errorStepIndex(trace) : -1;
  const groups = [...new Set(EXAMPLES.map((e) => e.group))];

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="brand">PythonVx</span>
        <select className="select" value="" onChange={(e) => loadExample(e.target.value)} title="Load an example program">
          <option value="" disabled>
            Examples…
          </option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {EXAMPLES.filter((e) => e.group === g).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="btn btn-primary" onClick={requestRun} title="Run and visualize (Ctrl/⌘ + Enter)">
          {status === 'running' ? <IconLoader2 size={16} className="spin" /> : <IconBolt size={16} />}
          Run
        </button>
        <label className="toggle" title="Re-run automatically while you type">
          <input type="checkbox" checked={autoRun} onChange={(e) => updateSettings({ autoRun: e.target.checked })} />
          Auto-run
        </label>
      </div>

      <div className="toolbar-center">
        <button className="icon-btn" onClick={() => { setPlaying(false); setStepIndex(0); }} disabled={!hasSteps || stepIndex === 0} title="First step (Home)">
          <IconPlayerSkipBack size={17} />
        </button>
        <button className="icon-btn" onClick={() => stepBy(-1)} disabled={!hasSteps || stepIndex === 0} title="Previous step (←)">
          <IconChevronLeft size={19} />
        </button>
        <button className="icon-btn play" onClick={() => setPlaying(!isPlaying)} disabled={total < 2} title="Play / pause (Space)">
          {isPlaying ? <IconPlayerPauseFilled size={17} /> : <IconPlayerPlayFilled size={17} />}
        </button>
        <button className="icon-btn" onClick={() => stepBy(1)} disabled={!hasSteps || stepIndex >= total - 1} title="Next step (→)">
          <IconChevronRight size={19} />
        </button>
        <button className="icon-btn" onClick={() => { setPlaying(false); setStepIndex(total - 1); }} disabled={!hasSteps || stepIndex >= total - 1} title="Last step (End)">
          <IconPlayerSkipForward size={17} />
        </button>
        <div className="scrubber">
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={hasSteps ? stepIndex : 0}
            disabled={!hasSteps}
            onChange={(e) => {
              setPlaying(false);
              setStepIndex(Number(e.target.value));
            }}
            style={{ ['--pct' as string]: total > 1 ? `${(stepIndex / (total - 1)) * 100}%` : '0%' }}
          />
          {errIdx >= 0 && total > 1 && (
            <button
              className="scrub-error"
              style={{ left: `${(errIdx / (total - 1)) * 100}%` }}
              title="Jump to the error"
              onClick={() => { setPlaying(false); setStepIndex(errIdx); }}
            >
              <IconAlertTriangle size={12} />
            </button>
          )}
        </div>
        <span className="step-count">{hasSteps ? `Step ${stepIndex + 1} of ${total}` : 'No steps'}</span>
        <button
          className={`icon-btn ${loop ? 'icon-on' : ''}`}
          onClick={() => updateSettings({ loop: !loop })}
          title={loop ? 'Looping: playback restarts at the end (click to stop at the end)' : 'Not looping (click to loop)'}
        >
          {loop ? <IconRepeat size={17} /> : <IconRepeatOff size={17} />}
        </button>
        <select className="select select-small" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-right">
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          <IconSettings size={18} />
        </button>
        <button className="icon-btn" onClick={() => openUrl('https://github.com/K-692/PythonVx')} title="PythonVx on GitHub">
          <IconBrandGithub size={18} />
        </button>
      </div>
    </header>
  );
}
