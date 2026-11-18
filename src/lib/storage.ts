export interface Progress {
  done: Record<string, boolean>;
  drafts: Record<string, string>;
  last?: string;
}

const KEY = "pandas-drills:v1";

function empty(): Progress {
  return { done: {}, drafts: {} };
}

/** localStorage can throw (private mode, blocked data), so every access is wrapped. */
export function createStore(getStorage: () => Storage | undefined = () => globalThis.localStorage) {
  function load(): Progress {
    try {
      const raw = getStorage()?.getItem(KEY);
      if (!raw) return empty();
      const parsed = JSON.parse(raw) as Partial<Progress>;
      return {
        done: parsed.done && typeof parsed.done === "object" ? parsed.done : {},
        drafts: parsed.drafts && typeof parsed.drafts === "object" ? parsed.drafts : {},
        last: typeof parsed.last === "string" ? parsed.last : undefined,
      };
    } catch {
      return empty();
    }
  }
  function save(p: Progress): boolean {
    try {
      getStorage()?.setItem(KEY, JSON.stringify(p));
      return true;
    } catch {
      return false;
    }
  }
  return { load, save };
}
