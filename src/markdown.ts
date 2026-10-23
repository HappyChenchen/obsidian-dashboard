/** Keep source line numbers while excluding frontmatter, fences, and comment blocks. */
export function getMarkdownLines(content: string): string[] {
  let frontmatter = content.startsWith("---\n") || content.startsWith("---\r\n");
  let fence: { marker: string; length: number; } | undefined;
  let comment = false;
  return content.split("\n").map((line, index) => {
    if (frontmatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
      return "";
    }
    if (fence) {
      const close = /^ {0,3}(`+|~+)\s*$/.exec(line);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = undefined;
      return "";
    }
    if (comment) {
      if (line.includes("-->")) comment = false;
      return "";
    }
    if (/^\s*<!--/.test(line)) {
      comment = !line.includes("-->");
      return "";
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      fence = { marker: open[1][0], length: open[1].length };
      return "";
    }
    return line;
  });
}
