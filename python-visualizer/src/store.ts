import { create } from 'zustand';
import type { Interpreter, Trace } from './types';
import { EXAMPLES } from './examples';

export interface Settings {
  pythonPath: string;
  maxSteps: number;
  timeLimit: number;
  autoRun: boolean;
  fontSize: number;
  showInlineValues: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  pythonPath: '',
  maxSteps: 2000,
  timeLimit: 10,
  autoRun: true,
  fontSize: 14,
  showInlineValues: true,
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
  interpreter: Interpreter | null;
  setInterpreter: (i: Interpreter | null) => void;
  startRun: () => void;
  finishRun: (trace: Trace, code: string, interpreter: Interpreter | null) => void;
  failRun: (message: string) => void;

  stepIndex: number;
  setStepIndex: (i: number) => void;
  stepBy: (delta: number) => void;
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

export const useAppStore = create<AppState>((set, get) => ({
  code: load('pvx.code', EXAMPLES[0].code),
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
  interpreter: null,
  setInterpreter: (interpreter) => set({ interpreter }),
  startRun: () => set({ status: 'running' }),
  finishRun: (trace, code, interpreter) => {
    const steps = trace.steps.length;
    // A fresh run starts at the first step; re-running unchanged code keeps your place.
    const keep = code === get().tracedCode ? clamp(get().stepIndex, 0, Math.max(0, steps - 1)) : 0;
    set({
      trace,
      tracedCode: code,
      status: 'done',
      runError: null,
      stepIndex: keep,
      isPlaying: false,
      dirty: get().code !== code,
      interpreter: interpreter ?? get().interpreter,
    });
  },
  failRun: (message) => set({ status: 'failed', runError: message, isPlaying: false }),

  stepIndex: 0,
  setStepIndex: (i) => {
    const n = get().trace?.steps.length ?? 0;
    set({ stepIndex: clamp(i, 0, Math.max(0, n - 1)) });
  },
  stepBy: (delta) => {
    const n = get().trace?.steps.length ?? 0;
    if (!n) return;
    const next = clamp(get().stepIndex + delta, 0, n - 1);
    set({ stepIndex: next, isPlaying: get().isPlaying && next < n - 1 });
  },
  isPlaying: false,
  setPlaying: (p) => {
    const n = get().trace?.steps.length ?? 0;
    if (p && n && get().stepIndex >= n - 1) set({ stepIndex: 0 });
    set({ isPlaying: p && n > 1 });
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
