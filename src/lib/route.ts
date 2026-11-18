export type Route =
  | { view: "new-class" }
  | { view: "join"; code: string }
  | { view: "teach"; code: string; key: string }
  | { view: "demo" }
  | { view: "exercise" };

/** Class codes are upper-case letters and digits; teacher keys are base64url. */
export function parseRoute(hash: string): Route {
  if (hash === "#/new-class") return { view: "new-class" };
  if (hash === "#/demo-class") return { view: "demo" };
  let m = /^#\/join\/([A-Za-z0-9]{1,12})$/.exec(hash);
  if (m?.[1]) return { view: "join", code: m[1].toUpperCase() };
  m = /^#\/teach\/([A-Za-z0-9]{1,12})\/([A-Za-z0-9_-]{10,100})$/.exec(hash);
  if (m?.[1] && m[2]) return { view: "teach", code: m[1].toUpperCase(), key: m[2] };
  return { view: "exercise" };
}

export function joinLink(origin: string, base: string, code: string): string {
  return `${origin}${base}#/join/${code}`;
}
export function teachLink(origin: string, base: string, code: string, key: string): string {
  return `${origin}${base}#/teach/${code}/${key}`;
}
