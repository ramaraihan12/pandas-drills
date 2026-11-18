// The teacher key arrives in the address fragment of the saved teacher link. Right away it
// moves into sessionStorage (per class code, this tab only) and leaves the address bar, so it
// is not in the history entry, a screenshot of the URL or a bookmark made later.
const name = (code: string) => `pandas-drills:teacher:${code}`;
const memory = new Map<string, string>(); // used when sessionStorage is blocked

type GetStorage = () => Storage | undefined;
const defaultStorage: GetStorage = () => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

export function keepTeacherKey(code: string, key: string, getStorage: GetStorage = defaultStorage): void {
  memory.set(code, key);
  try {
    getStorage()?.setItem(name(code), key);
  } catch {
    // memory only
  }
}

export function readTeacherKey(code: string, getStorage: GetStorage = defaultStorage): string | null {
  try {
    const v = getStorage()?.getItem(name(code));
    if (v) return v;
  } catch {
    // fall through
  }
  return memory.get(code) ?? null;
}

export function forgetTeacherKey(code: string, getStorage: GetStorage = defaultStorage): void {
  memory.delete(code);
  try {
    getStorage()?.removeItem(name(code));
  } catch {
    // nothing to do
  }
}
