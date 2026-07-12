import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useUiStore } from '../state/uiStore';

export interface NativeCapturePayload {
  text: string;
  sourceApp?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  capturedAt: string;
  mode: string;
  warning?: string | null;
}

export async function captureCurrentContext(): Promise<void> {
  const payload = await invoke<NativeCapturePayload>('capture_current_context');
  openCapturePayload(payload);
}

export function openCapturePayload(payload: NativeCapturePayload): void {
  useUiStore.getState().openCapture(payload.text, {
    sourceApp: payload.sourceApp ?? undefined,
    sourceUrl: payload.sourceUrl ?? undefined,
    capturedAt: payload.capturedAt,
    sourceTitle: payload.sourceTitle ?? undefined,
    warning: payload.warning ?? undefined,
  });
}

export function installNativeCaptureListener(): () => void {
  let unlisten: (() => void) | null = null;
  void listen<NativeCapturePayload>('denote://global-capture', (event) => {
    openCapturePayload(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}
