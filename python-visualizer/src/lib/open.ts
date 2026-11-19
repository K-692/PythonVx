import { isDesktop } from './runner';

/** Open a link in the system browser (desktop) or a new tab (web). */
export async function openUrl(url: string) {
  if (isDesktop()) {
    try {
      const { openUrl: open } = await import('@tauri-apps/plugin-opener');
      await open(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(path: string) {
  if (!isDesktop() || !path) return;
  try {
    const { openPath: open } = await import('@tauri-apps/plugin-opener');
    await open(path);
  } catch {
    /* ignore */
  }
}
