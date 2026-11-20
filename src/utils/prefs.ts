import { PREFS_STORAGE_KEY } from "@/src/constants";

/** Per-user view state: the environment, site and language picked last time. */
export interface Prefs {
  /** Only used when the host offers several environments (Standalone). */
  environmentId: string;
  siteName: string;
  language: string;
}

const EMPTY: Prefs = { environmentId: "", siteName: "", language: "" };

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      environmentId: text(parsed.environmentId),
      siteName: text(parsed.siteName),
      language: text(parsed.language),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Merges the given values into what is stored. */
export function savePrefs(change: Partial<Prefs>): void {
  try {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ ...loadPrefs(), ...change }),
    );
  } catch {
    // Storage unavailable — the selection just isn't remembered.
  }
}
