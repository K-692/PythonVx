import { create } from 'zustand';
import type { Interpreter, Trace } from './types';
import { DEFAULT_EXAMPLE } from './examples';

export interface Settings {
  pythonPath: string;
  maxSteps: number;
  timeLimit: number;
  autoRun: boolean;
  fontSize: number;
  showInlineValues: boolean;
  autoPlay: boolean;
  loop: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  pythonPath: '',
  maxSteps: 2000,
  timeLimit: 10,
  autoRun: true,
  fontSize: 14,
  showInlineValues: true,
  autoPlay: true,
  loop: true,
};

// localStorage can be unavailable (private mode, blocked storage): never let it break the app.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export type RunStatus = 'idle' | 'running' | 'done' | 'failed';

interface AppState {
  code: string;
  setCode: (code: string) => void;
  stdin: string;
  setStdin: (stdin: string) => void;

  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

  status: RunStatus;
  /** Problem that prevented tracing (no Python, timeout, crash). */
  runError: string | null;
  trace: Trace | null;
  /** The code the current trace belongs to. */
  tracedCode: string;
  /** Last trace that had steps (shown dimmed while the code has a syntax error). */
  lastGood: { trace: Trace; code: string } | null;
  view: 'flow' | 'memory';
  setView: (v: 'flow' | 'memory') => void;
  zoom: number;
  setZoom: (z: number) => void;
  interpreter: Interpreter | null;
  setInterpreter: (i: Interpreter | null) => void;
  startRun: () => void;
  finishRun: (trace: Trace, code: string, interpreter: Interpreter | null) => void;
  failRun: (message: string) => void;

  lastStdin: string;
  /** The user pressed pause; don't auto-start playback on the next run. */
  userPaused: boolean;
  stepIndex: number;
  setStepIndex: (i: number) => void;
  stepBy: (delta: number) => void;
  /** Advance one step of playback (loops at the end if enabled). */
  tick: () => void;
  isPlaying: boolean;
  setPlaying: (p: boolean) => void;
  /** Multiplier: 0.25 .. 4 */
  speed: number;
  setSpeed: (s: number) => void;

  /** Dirty: code edited since the last run. */
  dirty: boolean;
  runRequest: number;
  requestRun: () => void;

  settingsOpen: boolean;
  setSettingsOpen: (o: boolean) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The trace the UI is showing: the latest one, or the last good one while the code has a syntax error. */
export function shownTrace(s: { trace: Trace | null; lastGood: { trace: Trace } | null }): Trace | null {
  if (s.trace && s.trace.steps.length) return s.trace;
  return s.lastGood?.trace ?? s.trace;
}
export const stepCount = (s: { trace: Trace | null; lastGood: { trace: Trace } | null }) => shownTrace(s)?.steps.length ?? 0;

export const useAppStore = create<AppState>((set, get) => ({
  code: load('pvx.code', DEFAULT_EXAMPLE.code),
  setCode: (code) => {
    save('pvx.code', code);
    set({ code, dirty: code !== get().tracedCode });
  },
  stdin: load('pvx.stdin', ''),
  setStdin: (stdin) => {
    save('pvx.stdin', stdin);
    set({ stdin, dirty: true });
  },

  settings: load('pvx.settings', DEFAULT_SETTINGS),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    settings.maxSteps = clamp(Math.round(settings.maxSteps) || DEFAULT_SETTINGS.maxSteps, 50, 20000);
    settings.timeLimit = clamp(settings.timeLimit || DEFAULT_SETTINGS.timeLimit, 1, 120);
    settings.fontSize = clamp(settings.fontSize || 14, 10, 28);
    save('pvx.settings', settings);
    set({ settings });
  },

  status: 'idle',
  runError: null,
  trace: null,
  tracedCode: '',
  lastGood: null,
  view: load<'flow' | 'memory'>('pvx.view', 'flow'),
  setView: (view) => {
    save('pvx.view', view);
    set({ view });
  },
  zoom: load('pvx.zoom', 1),
  setZoom: (z) => {
    const zoom = clamp(Math.round(z * 10) / 10, 0.5, 2);
    save('pvx.zoom', zoom);
    set({ zoom });
  },
  interpreter: null,
  setInterpreter: (interpreter) => set({ interpreter }),
  startRun: () => set({ status: 'running' }),
  finishRun: (trace, code, interpreter) => {
    const steps = trace.steps.length;
    // A fresh run starts at the first step; re-running unchanged code keeps your place.
    if (!steps && get().lastGood) {
      // Syntax error while typing: keep the last diagram (and its playback) going.
      set({ trace, tracedCode: code, lastStdin: get().stdin, status: 'done', runError: null, dirty: get().code !== code });
      return;
    }
    const same = code === get().tracedCode && get().stdin === get().lastStdin;
    const keep = same ? clamp(get().stepIndex, 0, Math.max(0, steps - 1)) : 0;
    const settings = get().settings;
    set({
      trace,
      tracedCode: code,
      lastStdin: get().stdin,
      lastGood: steps > 0 ? { trace, code } : get().lastGood,
      status: 'done',
      runError: null,
      stepIndex: keep,
      // Keep the diagram flowing while you type; stay paused if you paused it.
      isPlaying: steps > 1 && (same ? get().isPlaying : settings.autoPlay && !get().userPaused),
      dirty: get().code !== code,
      interpreter: interpreter ?? get().interpreter,
    });
  },
  failRun: (message) => set({ status: 'failed', runError: message, isPlaying: false }),

  lastStdin: '',
  userPaused: false,
  stepIndex: 0,
  setStepIndex: (i) => {
    const n = stepCount(get());
    set({ stepIndex: clamp(i, 0, Math.max(0, n - 1)) });
  },
  stepBy: (delta) => {
    const n = stepCount(get());
    if (!n) return;
    const next = clamp(get().stepIndex + delta, 0, n - 1);
    // Stepping by hand pauses the animation.
    set({ stepIndex: next, isPlaying: false, userPaused: get().isPlaying || get().userPaused });
  },
  tick: () => {
    const n = stepCount(get());
    if (n < 2) return set({ isPlaying: false });
    const i = get().stepIndex;
    if (i < n - 1) set({ stepIndex: i + 1 });
    else if (get().settings.loop) set({ stepIndex: 0 });
    else set({ isPlaying: false });
  },
  isPlaying: false,
  setPlaying: (p) => {
    const n = stepCount(get());
    if (p && n && get().stepIndex >= n - 1) set({ stepIndex: 0 });
    set({ isPlaying: p && n > 1, userPaused: !p });
  },
  speed: load('pvx.speed', 1),
  setSpeed: (s) => {
    save('pvx.speed', s);
    set({ speed: s });
  },

  dirty: true,
  runRequest: 0,
  requestRun: () => set({ runRequest: get().runRequest + 1 }),

  settingsOpen: false,
  setSettingsOpen: (o) => set({ settingsOpen: o }),
}));

// Dev-only handle for debugging the UI in a plain browser.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __pvx: typeof useAppStore }).__pvx = useAppStore;
}
