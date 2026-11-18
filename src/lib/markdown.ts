/** A very small Markdown to HTML converter for the exercise prompts. Escapes everything first. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if (/^\s*[-*] /.test(line) || /^\s*\d+\. /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\. /.test(lines[i]!) : /^\s*[-*] /.test(lines[i]!))) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^\s*(?:[-*]|\d+\.) /, ""))}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !lines[i]!.startsWith("```") && !/^\s*[-*] |^\s*\d+\. /.test(lines[i]!)) {
        para.push(lines[i++]!);
      }
      out.push(`<p>${renderInline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
