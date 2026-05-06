import { useEffect, useRef, useState } from 'react';
import { PointerUpdates } from './PointerUpdates.js';
import type { CheckResult, Platform, PointerSdkConfig, UpdateManifest } from './types.js';

export interface UsePointerUpdatesOptions extends PointerSdkConfig {
  platform: Platform;
  runtimeVersion: string;
  autoCheck?: boolean;
  pollIntervalMs?: number;
  currentUpdateId?: string | null;
  onUpdateAvailable?: (manifest: UpdateManifest) => void;
}

export interface UsePointerUpdatesResult {
  client: PointerUpdates;
  manifest: UpdateManifest | null;
  hasUpdate: boolean;
  isChecking: boolean;
  error: Error | null;
  check: () => Promise<CheckResult>;
  download: () => Promise<ArrayBuffer | null>;
}

export function usePointerUpdates(opts: UsePointerUpdatesOptions): UsePointerUpdatesResult {
  const clientRef = useRef<PointerUpdates | null>(null);
  if (!clientRef.current) {
    clientRef.current = new PointerUpdates(opts);
  }
  const client = clientRef.current;

  if (opts.currentUpdateId !== undefined) {
    client.setCurrentUpdateId(opts.currentUpdateId ?? null);
  }

  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const check = async (): Promise<CheckResult> => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await client.checkForUpdate({
        platform: opts.platform,
        runtimeVersion: opts.runtimeVersion,
      });
      setManifest(result.manifest);
      setHasUpdate(result.hasUpdate);
      if (result.hasUpdate && result.manifest) {
        opts.onUpdateAvailable?.(result.manifest);
      }
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      return { hasUpdate: false, manifest: null };
    } finally {
      setIsChecking(false);
    }
  };

  const download = async (): Promise<ArrayBuffer | null> => {
    if (!manifest) return null;
    return client.downloadBundle(manifest);
  };

  useEffect(() => {
    if (opts.autoCheck === false) return;
    void check();
    if (!opts.pollIntervalMs) return;
    const id = setInterval(() => void check(), opts.pollIntervalMs);
    return () => clearInterval(id);
  }, [opts.platform, opts.runtimeVersion, opts.autoCheck, opts.pollIntervalMs]);

  return { client, manifest, hasUpdate, isChecking, error, check, download };
}
