import init, { Store, namedNode } from "./vendor/web.js";
import { GRAPH_BASE, formatOf } from "./config.js";
import { attachHighlighter } from "./highlight.js";

const $ = (id) => document.getElementById(id);
let store;

// Let the browser repaint before a long synchronous step (parsing blocks the main thread).
// requestAnimationFrame never fires in background tabs, so skip it when hidden and
// fall back to a timeout in case the tab is hidden while waiting.
const nextPaint = () => document.hidden ? Promise.resolve() : new Promise((r) => {
  requestAnimationFrame(() => setTimeout(r));
  setTimeout(r, 100);
});

function progress(fraction, label) {
  const pct = Math.floor(fraction * 100);
  $("bar").style.width = `${fraction * 100}%`;
  $("splash").setAttribute("aria-valuenow", pct);
  $("splash-pct").textContent = `${pct}%`;
  if (label) $("splash-file").textContent = label;
}

async function fetchBytes(url, onChunk, compressedUrl) {
  const useGzip = compressedUrl && typeof DecompressionStream === "function";
  const res = await fetch(useGzip ? compressedUrl : url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Count compressed bytes before decompression, while keeping decoding streamed.
  const body = useGzip ? res.body
    .pipeThrough(new TransformStream({
      transform(chunk, controller) {
        onChunk(chunk.length);
        controller.enqueue(chunk);
      },
    }))
    .pipeThrough(new DecompressionStream("gzip"))
    : res.body;
  const chunks = [];
  let length = 0;
  for (const reader = body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!useGzip) onChunk(value.length);
    chunks.push(value);
    length += value.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}

async function loadData() {
  await init();
  store = new Store();
  const manifest = await (await fetch("data/index.json")).json();
  const files = manifest.map((entry) => {
    const useGzip = entry.gzip && Number.isFinite(entry.gzipSize) && typeof DecompressionStream === "function";
    return { ...entry, gzip: useGzip ? entry.gzip : undefined, downloadSize: useGzip ? entry.gzipSize : entry.size };
  });
  const total = files.reduce((sum, f) => sum + f.downloadSize, 0);
  const log = [];
  let done = 0; // bytes of fully processed files; downloading counts for half, parsing for the other half
  for (const [i, { file, downloadSize, gzip }] of files.entries()) {
    const step = `(${i + 1}/${files.length})`;
    let received = 0;
    try {
      progress(done / total, `Downloading ${file} ${step}`);
      const bytes = await fetchBytes(`data/${file}`, (n) => {
        received += n;
        progress((done + Math.min(received, downloadSize) / 2) / total);
      }, gzip ? `data/${gzip}` : undefined);
      progress((done + downloadSize / 2) / total, `Reading ${file} ${step}`);
      await nextPaint();
      const before = store.size;
      store.load(bytes, {
        format: formatOf(file),
        base_iri: new URL(`data/${file}`, location.href).href,
        to_graph_name: namedNode(GRAPH_BASE + file),
        lenient: true,
      });
      log.push(`✓ ${file} — ${(store.size - before).toLocaleString()} triples (graph <${GRAPH_BASE}${file}>)`);
    } catch (e) {
      log.push(`✗ ${file}: ${e}`);
      const li = document.createElement("li");
      li.textContent = `${file}: ${e}`;
      $("splash-errors").append(li);
    }
    done += downloadSize;
  }
  progress(1, "Ready");
  const failed = log.filter((l) => l.startsWith("✗")).length;
  $("status").querySelector("summary").textContent =
    `Knowledge graph loaded: ${store.size.toLocaleString("en")} statements from ${files.length - failed} of ${files.length} data files` +
    (failed ? " (some files could not be loaded, see details)" : "");
  $("log").textContent = log.join("\n");
  $("status").open = failed > 0;
  $("run").disabled = false;
  // Leave the splash up for a moment if some files failed, so the errors can be read
  setTimeout(() => {
    const splash = $("splash");
    splash.classList.add("done");
    // A timer rather than transitionend: transitions don't run in background tabs
    setTimeout(() => splash.remove(), 500);
    $("query").focus({ preventScroll: true });
  }, failed ? 3000 : 300);
}

function termHtml(t) {
  if (!t) return "";
  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  if (t.termType === "NamedNode") return `<a href="${esc(t.value)}" target="_blank">${esc(t.value)}</a>`;
  if (t.termType === "BlankNode") return `_:${esc(t.value)}`;
  if (t.termType === "Literal") {
    let s = esc(t.value);
    if (t.language) s += `<small>@${esc(t.language)}</small>`;
    return s;
  }
  return esc(t.toString());
}

const plural = (n, word) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

function run() {
  const out = $("results");
  out.innerHTML = "";
  const t0 = performance.now();
  try {
    const res = store.query($("query").value, { use_default_graph_as_union: true });
    const ms = (performance.now() - t0).toFixed(0);
    if (typeof res === "boolean") {
      out.innerHTML = `<pre>${res}</pre>`;
      $("info").textContent = `Answer: ${res ? "yes" : "no"} · ${ms} ms`;
    } else if (Array.isArray(res) && (res.length === 0 || res[0] instanceof Map)) {
      const vars = [...new Set(res.flatMap((r) => [...r.keys()]))];
      const rows = res.map((r) => `<tr>${vars.map((v) => `<td>${termHtml(r.get(v))}</td>`).join("")}</tr>`);
      out.innerHTML = `<table><tr>${vars.map((v) => `<th>?${v}</th>`).join("")}</tr>${rows.join("")}</table>`;
      $("info").textContent = `${plural(res.length, "result")} · ${ms} ms`;
    } else {
      const pre = document.createElement("pre");
      pre.textContent = res.map((q) => q.toString()).join("\n");
      out.append(pre);
      $("info").textContent = `${plural(res.length, "statement")} · ${ms} ms`;
    }
  } catch (e) {
    out.innerHTML = `<pre class="err"></pre>`;
    out.firstChild.textContent = String(e);
    $("info").textContent = "";
  }
}

// Example queries: listed in queries/index.json, one .rq file each.
// Any query can be opened with ?query=<URL-encoded SPARQL>; the address bar follows the editor.
let examples = [];
const renderHighlight = attachHighlighter($("query"), $("highlight"));

async function loadExamples() {
  const list = await (await fetch("queries/index.json")).json();
  examples = await Promise.all(list.map(async (e) => ({ ...e, text: await (await fetch(`queries/${e.file}`)).text() })));
  const groups = new Map();
  for (const e of examples) {
    if (!groups.has(e.group)) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = e.group;
      $("examples").append(optgroup);
      groups.set(e.group, optgroup);
    }
    groups.get(e.group).append(new Option(e.title, e.id));
  }
}

const exampleWithText = (text) => examples.find((e) => e.text === text);

function showQuery(text) {
  const example = exampleWithText(text);
  $("query").value = text;
  // Show the start of the query (a focused textarea would otherwise scroll to the end)
  $("query").setSelectionRange(0, 0);
  $("query").scrollTop = 0;
  renderHighlight();
  $("examples").value = example?.id ?? "";
  $("example-desc").textContent = example?.description ?? "";
}

function urlForQuery(text) {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.set("query", text);
  return url.href;
}

// Keep the address bar on the current query, so it can be bookmarked or shared as is
let urlUpdate;
function updateUrl(delay = 0) {
  clearTimeout(urlUpdate);
  urlUpdate = setTimeout(() => history.replaceState(null, "", urlForQuery($("query").value)), delay);
}

const dataReady = () => !$("run").disabled;

$("examples").onchange = () => {
  const example = examples.find((e) => e.id === $("examples").value);
  if (!example) return; // "Custom query": keep the editor as it is
  showQuery(example.text);
  updateUrl();
  if (dataReady()) run();
};

$("query").oninput = () => {
  const example = exampleWithText($("query").value);
  $("examples").value = example?.id ?? "";
  $("example-desc").textContent = example?.description ?? "";
  updateUrl(300);
};

$("copy-link").onclick = async () => {
  const url = urlForQuery($("query").value);
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    const label = $("copy-link").textContent;
    $("copy-link").textContent = "Link copied ✓";
    setTimeout(() => ($("copy-link").textContent = label), 1500);
  } catch {
    prompt("Copy this link:", url);
  }
};

$("run").onclick = run;
$("query").onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dataReady()) run(); };

// Start with the query given in the URL (?query=…), or else the first example
const examplesLoaded = loadExamples()
  .catch((e) => console.warn("Example queries unavailable:", e))
  .then(() => {
    const fromUrl = new URLSearchParams(location.search).get("query");
    if (fromUrl !== null) showQuery(fromUrl);
    else if (examples.length) showQuery(examples[0].text);
  });

loadData()
  .then(async () => { await examplesLoaded; run(); })
  .catch((e) => {
    $("splash").querySelector("h2").textContent = "The knowledge graph could not be loaded";
    $("splash-file").textContent = "";
    $("splash-errors").textContent = String(e);
  });
