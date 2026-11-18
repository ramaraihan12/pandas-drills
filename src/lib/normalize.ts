/**
 * Makes two pieces of Python code comparable: drops comments, blank lines and trailing
 * spaces, and collapses runs of spaces or tabs that are not at the start of a line and not
 * inside a string. Everything else (names, quotes, indentation, order) is kept, so this is
 * a hint that two answers look the same, not a proof that one was copied.
 */
export function normalizeCode(source: string): string {
  const text = source.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  let line = "";
  let quote = ""; // "'", '"', "'''" or '"""' while inside a string
  let i = 0;

  const endLine = () => {
    // blank or trailing space only matters outside strings, and this is only called there
    // a loop, not a regex: a trailing-space pattern backtracks quadratically on long runs of spaces
    let end = line.length;
    while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
    const trimmed = line.slice(0, end);
    if (trimmed.trim() !== "") lines.push(trimmed);
    line = "";
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\" && i + 1 < text.length) {
        line += ch + text[i + 1]!;
        i += 2;
        continue;
      }
      if (text.startsWith(quote, i)) {
        line += quote;
        i += quote.length;
        quote = "";
        continue;
      }
      if (ch === "\n") {
        if (quote.length === 3) {
          line += ch; // a triple-quoted string keeps its own line breaks
          i++;
          continue;
        }
        quote = ""; // unterminated single-line string: stop treating the rest as a string
        endLine();
        i++;
        continue;
      }
      line += ch;
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "\n") {
      endLine();
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = text.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
      line += quote;
      i += quote.length;
      continue;
    }
    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
      line += line === "" ? text.slice(i, j) : " "; // keep indentation as written
      i = j;
      continue;
    }
    line += ch;
    i++;
  }
  endLine();
  return lines.join("\n");
}
