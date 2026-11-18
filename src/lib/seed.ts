/** The text a variant seed is made from: the class code and the nickname the way the API stores it. */
export function seedText(classCode: string, nickname: string): string {
  const nick = nickname.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return `${classCode}:${nick}`;
}

/**
 * A stable 32-bit hash (FNV-1a over the UTF-8 bytes) of "classCode:nickname". It is the seed of
 * a student's data variant; 0 is reserved for "the original data", so it never comes out as 0.
 * Nothing about it is sent to the API.
 */
export function variantSeed(classCode: string, nickname: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seedText(classCode, nickname))) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 1 : h;
}
