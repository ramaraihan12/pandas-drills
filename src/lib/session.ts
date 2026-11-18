// What this browser remembers about the class it joined: the student token, per class code.
export interface ClassSession {
  name: string;
  nickname: string;
  token: string;
}
interface Stored {
  active?: string;
  classes: Record<string, ClassSession>;
}

const KEY = "pandas-drills:classes:v1";

export function createSessions(getStorage: () => Storage | undefined = () => globalThis.localStorage) {
  function load(): Stored {
    try {
      const raw = getStorage()?.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Stored>;
        if (p && typeof p === "object" && p.classes && typeof p.classes === "object") {
          return { active: typeof p.active === "string" ? p.active : undefined, classes: p.classes };
        }
      }
    } catch {
      // ignore
    }
    return { classes: {} };
  }
  function save(s: Stored) {
    try {
      getStorage()?.setItem(KEY, JSON.stringify(s));
    } catch {
      // blocked storage: the session lasts until the page closes
    }
  }
  return {
    /** The class this browser is currently checking answers into. */
    active(): { code: string; session: ClassSession } | null {
      const s = load();
      const session = s.active ? s.classes[s.active] : undefined;
      return s.active && session ? { code: s.active, session } : null;
    },
    get(code: string): ClassSession | null {
      return load().classes[code] ?? null;
    },
    join(code: string, session: ClassSession) {
      // one class per device at a time: tokens of other classes would only be stale
      save({ active: code, classes: { [code]: session } });
    },
    /** Forgets the token on this device. The student can join again with another nickname. */
    leave(code: string) {
      const s = load();
      delete s.classes[code];
      if (s.active === code) s.active = undefined;
      save(s);
    },
  };
}
