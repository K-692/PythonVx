// Dev-only: render a saved trace for README screenshots.
//   http://localhost:1420/?mock=30_classes&step=14&view=flow
// The mock JSON files live in public/ (git-ignored) and are produced by the
// tracer from the programs in /samples.
import { useAppStore } from './store';

export function screenshotMode(): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(location.search).get('mock');
}

export async function loadScreenshotMock(name: string) {
  const params = new URLSearchParams(location.search);
  const s = useAppStore.getState();
  const m = await fetch(`/mock-${name}.json`).then((r) => r.json());
  s.setCode(m.code);
  s.setStdin(m.stdin ?? '');
  s.finishRun(m.trace, m.code, { path: 'python3', version: m.trace.python });
  s.setView((params.get('view') as 'flow' | 'memory') ?? 'flow');
  useAppStore.setState({ isPlaying: false, userPaused: true });
  s.setStepIndex(Number(params.get('step') ?? 0));
}
