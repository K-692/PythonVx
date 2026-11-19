import { invoke } from '@tauri-apps/api/core';
import type { Interpreter, MemberInfo, Trace } from '../types';
import { useAppStore } from '../store';

export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const NOT_DESKTOP =
  'PythonVx needs its desktop app to run Python.\n' +
  'Download the installer from https://github.com/K-692/PythonVx/releases/latest, ' +
  'or start the dev build with "npm run tauri dev".';

let latestRun = 0;

/** Trace the current code. Results of outdated runs are discarded. */
export async function runCode(): Promise<void> {
  const state = useAppStore.getState();
  const code = state.code;
  const id = ++latestRun;
  if (!isDesktop()) {
    state.failRun(NOT_DESKTOP);
    return;
  }
  state.startRun();
  try {
    const raw: string = await invoke('run_python', {
      options: {
        code,
        stdin: state.stdin,
        maxSteps: state.settings.maxSteps,
        timeLimit: state.settings.timeLimit,
        pythonPath: state.settings.pythonPath || null,
      },
    });
    if (id !== latestRun) return; // a newer run started meanwhile
    const parsed = JSON.parse(raw) as { interpreter: Interpreter; trace: Trace };
    useAppStore.getState().finishRun(parsed.trace, code, parsed.interpreter);
  } catch (e) {
    if (id !== latestRun) return;
    useAppStore.getState().failRun(String(e));
  }
}

export async function detectPython(pythonPath: string): Promise<Interpreter> {
  if (!isDesktop()) throw new Error(NOT_DESKTOP);
  return invoke<Interpreter>('detect_python', { pythonPath: pythonPath || null });
}

export async function filesDir(): Promise<string> {
  if (!isDesktop()) return '';
  return invoke<string>('files_dir');
}

// ---------- introspection (autocomplete), cached per session ----------

const memberCache = new Map<string, Promise<MemberInfo[]>>();
let moduleList: Promise<string[]> | null = null;

function pythonPath() {
  return useAppStore.getState().settings.pythonPath || null;
}

export function getModules(): Promise<string[]> {
  if (!isDesktop()) return Promise.resolve([]);
  if (!moduleList) {
    moduleList = invoke<string>('introspect', { request: { modules: true }, pythonPath: pythonPath() })
      .then((raw) => (JSON.parse(raw).modules as string[]) || [])
      .catch(() => {
        moduleList = null;
        return [];
      });
  }
  return moduleList;
}

export function getMembers(target: string): Promise<MemberInfo[]> {
  if (!isDesktop()) return Promise.resolve([]);
  let p = memberCache.get(target);
  if (!p) {
    p = invoke<string>('introspect', { request: { target }, pythonPath: pythonPath() })
      .then((raw) => (JSON.parse(raw).members as MemberInfo[]) || [])
      .catch(() => {
        memberCache.delete(target);
        return [];
      });
    memberCache.set(target, p);
  }
  return p;
}

/** Synchronous cache peek (used by hover). */
export const cachedMembers = new Map<string, MemberInfo[]>();
export async function getMembersCached(target: string) {
  const m = await getMembers(target);
  cachedMembers.set(target, m);
  return m;
}

export function clearIntrospectionCache() {
  memberCache.clear();
  cachedMembers.clear();
  moduleList = null;
}
