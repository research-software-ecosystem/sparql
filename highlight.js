// Minimal SPARQL syntax highlighting for the query editor: a coloured copy of the text is shown
// in a <pre> behind the textarea (whose own text is transparent) and kept in sync with it.

const KEYWORDS = [
  "SELECT", "CONSTRUCT", "DESCRIBE", "ASK", "WHERE", "FROM", "NAMED", "PREFIX", "BASE", "DISTINCT", "REDUCED",
  "OPTIONAL", "UNION", "MINUS", "GRAPH", "SERVICE", "SILENT", "FILTER", "BIND", "VALUES", "AS", "GROUP", "BY",
  "ORDER", "ASC", "DESC", "HAVING", "LIMIT", "OFFSET", "NOT", "EXISTS", "IN", "UNDEF", "TRUE", "FALSE", "a",
  "COUNT", "SUM", "MIN", "MAX", "AVG", "SAMPLE", "GROUP_CONCAT", "SEPARATOR", "STR", "LANG", "LANGMATCHES",
  "DATATYPE", "BOUND", "IRI", "URI", "BNODE", "RAND", "ABS", "CEIL", "FLOOR", "ROUND", "CONCAT", "STRLEN",
  "UCASE", "LCASE", "ENCODE_FOR_URI", "CONTAINS", "STRSTARTS", "STRENDS", "STRBEFORE", "STRAFTER", "YEAR",
  "MONTH", "DAY", "HOURS", "MINUTES", "SECONDS", "TIMEZONE", "TZ", "NOW", "UUID", "STRUUID", "MD5", "SHA1",
  "SHA256", "SHA384", "SHA512", "COALESCE", "IF", "STRLANG", "STRDT", "SAMETERM", "ISIRI", "ISURI", "ISBLANK",
  "ISLITERAL", "ISNUMERIC", "REGEX", "SUBSTR", "REPLACE",
].join("|");

// Earlier alternatives win at a given position, e.g. "#" inside <…#> is part of the IRI, not a comment
const TOKEN = new RegExp([
  String.raw`(?<comment>#[^\n]*)`,
  String.raw`(?<iri><[^<>"{}|^\x60\\\s]*>)`,
  String.raw`(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`,
  String.raw`(?<variable>[?$][\p{L}\p{N}_]+)`,
  String.raw`(?<pname>(?:\p{L}[\p{L}\p{N}_.-]*)?:(?:[\p{L}\p{N}_%-]|\.(?=[\p{L}\p{N}_%-]))*)`,
  String.raw`(?<keyword>\b(?:${KEYWORDS})\b)`,
  String.raw`(?<number>\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)`,
].join("|"), "giu");

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export function highlightSparql(text) {
  let html = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const type = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    html += escapeHtml(text.slice(last, m.index)) + `<span class="tok-${type}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

// Keep `pre` showing the highlighted text of `textarea`; returns a function to call after
// changing the textarea's value from code (which fires no input event)
export function attachHighlighter(textarea, pre) {
  const sync = () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  };
  const render = () => {
    // Extra newlines let the copy scroll as far as the textarea, e.g. when the text ends with a newline
    pre.innerHTML = highlightSparql(textarea.value) + "\n\n";
    sync();
  };
  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", sync);
  render();
  return render;
}
