/* Lightweight localStorage persistence for the site parameters form, so a
 * planner's settings survive a refresh. Only splatParams (the small config) is
 * persisted — not localSites, whose coverage rasters are large and cheap to
 * recompute. Pure + storage-guarded so it is unit-testable and never throws
 * (private-browsing / quota / disabled storage all degrade to defaults). */

import type { SplatParams } from './types';

export const PARAMS_KEY = 'mt-site-params-v1';

/**
 * Merge a persisted blob over the defaults section by section, so a saved
 * payload from an older build still picks up any newly-added fields (and a
 * malformed section falls back to its default). Unknown top-level shapes
 * return the defaults untouched.
 */
export function mergeParams(defaults: SplatParams, saved: unknown): SplatParams {
  if (!saved || typeof saved !== 'object') return defaults;
  const s = saved as Partial<Record<keyof SplatParams, unknown>>;
  const section = <T>(d: T, v: unknown): T =>
    v && typeof v === 'object' && !Array.isArray(v) ? { ...d, ...(v as object) } : d;
  return {
    transmitter: section(defaults.transmitter, s.transmitter),
    receiver: section(defaults.receiver, s.receiver),
    environment: section(defaults.environment, s.environment),
    simulation: section(defaults.simulation, s.simulation),
    display: section(defaults.display, s.display),
  };
}

/** Read persisted params merged over `defaults`; returns `defaults` on any
 * problem (no saved value, corrupt JSON, storage unavailable). */
export function loadParams(defaults: SplatParams): SplatParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) return mergeParams(defaults, JSON.parse(raw));
  } catch {
    /* ignore: corrupt value or storage disabled */
  }
  return defaults;
}

/** Persist params; silently no-ops if storage is unavailable or over quota. */
export function saveParams(params: SplatParams): void {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
  } catch {
    /* ignore: quota exceeded or storage disabled */
  }
}
