/**
 * LOV mirror → always publish ontology.ttl (Bun-friendly, using N3 only)
 *
 * - Finds latest fileURL via /api/v2/vocabulary/info?vocab=<prefix>
 * - Downloads only if latest not already cached
 * - Parses Turtle/N3/N-Triples with N3.Parser and writes Turtle via N3.Writer
 * - Skips RDF/XML + JSON-LD (unsupported by N3) and records reason in meta/index
 *
 * Run:
 *   bun scripts/fetch-lov.ts
 */

import path from "node:path";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { Parser, Writer, Store, DataFactory } from "n3";

type LovListEntry = {
  prefix?: string;
  vocab?: string;
  uri?: string;
  nsp?: string;
  namespace?: string;
  title?: string;
  [k: string]: unknown;
};

type LovInfoVersion = {
  fileURL?: string | null;
  issued: string; // ISO datetime
};

type LovInfo = {
  versions: LovInfoVersion[];
};

const LOV_LIST_URL =
  "https://lov.linkeddata.es/dataset/lov/api/v2/vocabulary/list";
const LOV_INFO_URL = (prefix: string) =>
  `https://lov.linkeddata.es/dataset/lov/api/v2/vocabulary/info?vocab=${encodeURIComponent(prefix)}`;

const OUT_ROOT = path.resolve(process.env.OUT_DIR ?? "public/lov");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

const OUT_FILENAME = "ontology.ttl";

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

async function writeJson(p: string, obj: unknown) {
  await ensureDir(path.dirname(p));
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function safeEncodeSegment(s: string): string {
  return encodeURIComponent(s);
}

function pickPrefix(v: LovListEntry): string | null {
  return (v.prefix as string) || (v.vocab as string) || null;
}
function pickUri(v: LovListEntry): string | null {
  return (v.uri as string) || null;
}
function pickNamespace(v: LovListEntry): string | null {
  return (v.nsp as string) || (v.namespace as string) || null;
}

function parseIssuedMs(issued: string): number {
  return Date.parse(issued);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "lov-mirror/1.0 (Bun; static mirror for GitHub Pages)",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<{
  ok: boolean;
  status: number;
  contentType: string | null;
  text: string | null;
  finalUrl: string;
  error?: string;
}> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept:
          "text/turtle, text/n3, application/n-triples, application/trig, */*;q=0.1",
        "User-Agent": "lov-mirror/1.0 (Bun; static mirror for GitHub Pages)",
      },
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type");
    const finalUrl = res.url;

    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        contentType,
        text: null,
        finalUrl,
      };

    const txt = await res.text();
    return { ok: true, status: res.status, contentType, text: txt, finalUrl };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      contentType: null,
      text: null,
      finalUrl: url,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function contentTypeBase(ct: string | null): string | null {
  if (!ct) return null;
  return ct.split(";")[0]?.trim().toLowerCase() ?? null;
}

function urlExt(url: string): string {
  const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return (m?.[1] ?? "").toLowerCase();
}

function n3FormatFor(
  contentType: string | null,
  sourceUrl: string,
): "turtle" | "n3" | "ntriples" | "trig" | null {
  const ct = contentTypeBase(contentType);
  if (ct === "text/turtle" || ct === "application/x-turtle") return "turtle";
  if (ct === "text/n3" || ct === "text/rdf+n3") return "n3";
  if (ct === "application/n-triples") return "ntriples";
  if (ct === "application/trig" || ct === "text/trig") return "trig";

  // fallback by extension
  const ext = urlExt(sourceUrl);
  if (ext === "ttl") return "turtle";
  if (ext === "n3") return "n3";
  if (ext === "nt") return "ntriples";
  if (ext === "trig") return "trig";

  // RDF/XML / JSON-LD not supported here
  if (
    ct === "application/rdf+xml" ||
    ext === "rdf" ||
    ext === "owl" ||
    ext === "xml"
  )
    return null;
  if (ct === "application/ld+json" || ext === "jsonld") return null;

  // unknown: try turtle parser anyway (sometimes servers mislabel)
  return "turtle";
}

/**
 * Parse input into a Store using N3, then serialize as Turtle.
 */
async function convertToTurtleN3(opts: {
  inputText: string;
  inputContentType: string | null;
  baseIRI: string;
  sourceUrl: string;
}): Promise<{ ok: true; ttl: string } | { ok: false; reason: string }> {
  const format = n3FormatFor(opts.inputContentType, opts.sourceUrl);
  if (!format) {
    return {
      ok: false,
      reason: `Unsupported format (content-type/ext): ${opts.inputContentType ?? "unknown"} (${opts.sourceUrl})`,
    };
  }

  const parser = new Parser({
    format, // "turtle" | "n3" | "ntriples" | "trig"
    baseIRI: opts.baseIRI,
  });

  const store = new Store();

  try {
    const quads = parser.parse(opts.inputText);
    store.addQuads(quads);
  } catch (e) {
    return {
      ok: false,
      reason: `Parse failed (${format}): ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Serialize as Turtle
  const writer = new Writer({
    format: "Turtle",
    prefixes: undefined,
  });

  writer.addQuads(store.getQuads(null, null, null, null));

  const ttl = await new Promise<string>((resolve, reject) => {
    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  }).catch((e) => {
    throw e;
  });

  return { ok: true, ttl };
}

// LOV logic
async function extractLatestVersion(
  prefix: string,
): Promise<{ fileURL: string; issued: string } | null> {
  const info = await fetchJson<LovInfo>(LOV_INFO_URL(prefix));
  const candidates = (info.versions ?? [])
    .filter((v) => v.fileURL && typeof v.issued === "string" && v.issued)
    .map((v) => ({
      fileURL: String(v.fileURL),
      issued: v.issued,
      issuedMs: parseIssuedMs(v.issued),
    }))
    .filter((x) => Number.isFinite(x.issuedMs));

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.issuedMs - a.issuedMs);
  return { fileURL: candidates[0].fileURL, issued: candidates[0].issued };
}

type Meta = {
  prefix: string;
  uri: string;
  namespace: string | null;
  lovLatestFileURL: string;
  lovLatestIssued: string;
  fetchedAt: string;
  fetchedFrom: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  finalUrl: string;
  skipped?: boolean;
  convert?: { ok: boolean; reason?: string };
  error?: string;
};

async function main() {
  await ensureDir(OUT_ROOT);

  const list = await fetchJson<LovListEntry[]>(LOV_LIST_URL);

  const vocabs = list
    .map((v) => {
      const prefix = pickPrefix(v);
      const uri = pickUri(v);
      if (!prefix || !uri) return null;
      return {
        prefix,
        uri,
        namespace: pickNamespace(v),
        title: v.title as string | undefined,
      };
    })
    .filter(Boolean) as Array<{
    prefix: string;
    uri: string;
    namespace: string | null;
    title?: string;
  }>;

  console.log(
    `Processing ${vocabs.length} vocabs with concurrency=${CONCURRENCY}...`,
  );

  let next = 0;
  const results: Array<{
    prefix: string;
    uri: string;
    namespace: string | null;
    lovLatestFileURL: string | null;
    lovLatestIssued: string | null;
    ok: boolean;
    status: number;
    finalUrl: string | null;
    fileByPrefix: string | null;
    fileByUri: string | null;
    skipped: boolean;
    note?: string;
  }> = [];

  async function worker(workerId: number) {
    while (true) {
      const i = next++;
      if (i >= vocabs.length) return;

      const v = vocabs[i];

      const prefixDir = path.join(
        OUT_ROOT,
        "by-prefix",
        safeEncodeSegment(v.prefix),
      );
      const uriDir = path.join(OUT_ROOT, "by-uri", safeEncodeSegment(v.uri));

      const prefixMetaPath = path.join(prefixDir, "meta.json");
      const prefixOntPath = path.join(prefixDir, OUT_FILENAME);

      await ensureDir(prefixDir);
      await ensureDir(uriDir);

      let latest: { fileURL: string; issued: string } | null = null;
      try {
        latest = await extractLatestVersion(v.prefix);
      } catch {
        // leave null
      }

      if (!latest) {
        results.push({
          prefix: v.prefix,
          uri: v.uri,
          namespace: v.namespace,
          lovLatestFileURL: null,
          lovLatestIssued: null,
          ok: false,
          status: 0,
          finalUrl: null,
          fileByPrefix: null,
          fileByUri: null,
          skipped: false,
          note: "Could not fetch LOV info or no versions/fileURL",
        });
        continue;
      }

      // Cache check
      const existingMeta = await readJsonIfExists<Meta>(prefixMetaPath);
      const hasFile = await fileExists(prefixOntPath);
      const isUpToDate =
        hasFile &&
        existingMeta?.lovLatestFileURL === latest.fileURL &&
        existingMeta?.lovLatestIssued === latest.issued &&
        existingMeta?.convert?.ok === true;

      if (isUpToDate) {
        results.push({
          prefix: v.prefix,
          uri: v.uri,
          namespace: v.namespace,
          lovLatestFileURL: latest.fileURL,
          lovLatestIssued: latest.issued,
          ok: true,
          status: 304,
          finalUrl: existingMeta?.finalUrl ?? null,
          fileByPrefix: `by-prefix/${encodeURIComponent(v.prefix)}/${OUT_FILENAME}`,
          fileByUri: `by-uri/${encodeURIComponent(v.uri)}/${OUT_FILENAME}`,
          skipped: true,
        });
        continue;
      }

      // Download
      const fr = await fetchText(latest.fileURL);

      let fileByPrefix: string | null = null;
      let fileByUri: string | null = null;

      let convertOk = false;
      let convertReason: string | undefined;

      if (fr.ok && fr.text != null) {
        const conv = await convertToTurtleN3({
          inputText: fr.text,
          inputContentType: fr.contentType,
          baseIRI: v.uri,
          sourceUrl: latest.fileURL,
        });

        if (conv.ok) {
          convertOk = true;
          await writeFile(path.join(prefixDir, OUT_FILENAME), conv.ttl, "utf8");
          await writeFile(path.join(uriDir, OUT_FILENAME), conv.ttl, "utf8");
          fileByPrefix = `by-prefix/${encodeURIComponent(v.prefix)}/${OUT_FILENAME}`;
          fileByUri = `by-uri/${encodeURIComponent(v.uri)}/${OUT_FILENAME}`;
        } else {
          convertOk = false;
          convertReason = conv.reason;
        }
      }

      const meta: Meta = {
        prefix: v.prefix,
        uri: v.uri,
        namespace: v.namespace,
        lovLatestFileURL: latest.fileURL,
        lovLatestIssued: latest.issued,
        fetchedAt: new Date().toISOString(),
        fetchedFrom: latest.fileURL,
        ok: fr.ok,
        status: fr.status,
        contentType: fr.contentType,
        finalUrl: fr.finalUrl,
        convert: { ok: convertOk, reason: convertReason },
        error: fr.error,
      };

      await writeJson(path.join(prefixDir, "meta.json"), meta);
      await writeJson(path.join(uriDir, "meta.json"), meta);

      results.push({
        prefix: v.prefix,
        uri: v.uri,
        namespace: v.namespace,
        lovLatestFileURL: latest.fileURL,
        lovLatestIssued: latest.issued,
        ok: fr.ok && convertOk,
        status: fr.ok ? (convertOk ? fr.status : 422) : fr.status,
        finalUrl: fr.finalUrl,
        fileByPrefix,
        fileByUri,
        skipped: false,
        note: convertReason,
      });

      if (i % 50 === 0)
        console.log(`[worker ${workerId}] ${i + 1}/${vocabs.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));

  results.sort((a, b) => a.prefix.localeCompare(b.prefix));

  await writeJson(path.join(OUT_ROOT, "index.json"), {
    generatedAt: new Date().toISOString(),
    count: results.length,
    okCount: results.filter((r) => r.ok).length,
    skippedCount: results.filter((r) => r.skipped).length,
    items: results,
  });

  // namespace grouping
  const nsMap = new Map<string, typeof results>();
  for (const r of results) {
    if (!r.namespace) continue;
    const arr = nsMap.get(r.namespace) ?? [];
    arr.push(r);
    nsMap.set(r.namespace, arr);
  }
  for (const [ns, arr] of nsMap.entries()) {
    const nsDir = path.join(OUT_ROOT, "namespaces", safeEncodeSegment(ns));
    await ensureDir(nsDir);
    await writeJson(path.join(nsDir, "index.json"), {
      namespace: ns,
      count: arr.length,
      items: arr,
    });
  }

  // index.html (links to prefix folder + namespace page)
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>LOV Ontology Mirror</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; }
    input { width: 100%; padding: .75rem; font-size: 1rem; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #ddd; padding: .5rem; vertical-align: top; }
    code { background: #f6f6f6; padding: .1rem .25rem; border-radius: .25rem; }
    .muted { color: #666; }
    .bad { color: #b00020; }
    .links a { margin-right: .5rem; }
  </style>
</head>
<body>
  <h1>LOV Ontology Mirror</h1>
  <p class="muted">
    Successful vocabularies are published as <code>${OUT_FILENAME}</code> (Turtle).
    Browse <a href="./namespaces/">namespaces</a>.
  </p>

  <input id="q" placeholder="Filter by prefix / URI / namespace..." />

  <table>
    <thead>
      <tr>
        <th>Prefix</th>
        <th>URI</th>
        <th>Namespace</th>
        <th>Browse</th>
        <th>Ontology</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

<script>
(async function(){
  const res = await fetch("./index.json");
  const data = await res.json();
  const items = data.items || [];
  const rows = document.getElementById("rows");
  const q = document.getElementById("q");

  function enc(x){ return encodeURIComponent(x); }

  function render(filter){
    rows.innerHTML = "";
    const f = (filter || "").toLowerCase();

    for (const it of items){
      const hay = (it.prefix + " " + it.uri + " " + (it.namespace || "")).toLowerCase();
      if (f && !hay.includes(f)) continue;

      const prefixFolder = "./by-prefix/" + enc(it.prefix) + "/";
      const uriFolder = "./by-uri/" + enc(it.uri) + "/";
      const nsIndex = it.namespace ? ("./namespaces/" + it.namespace + "/") : null;

      const ontLink = it.fileByPrefix
        ? "<a href='./" + it.fileByPrefix + "'>${OUT_FILENAME}</a>"
        : "";

      const browseLinks =
        "<span class='links'>"
        + "<a href='" + prefixFolder + "'>by-prefix/</a>"
        + "<a href='" + prefixFolder + "meta.json'>meta</a>"
        + (it.fileByPrefix ? ("<a href='./" + it.fileByPrefix + "'>ttl</a>") : "")
        + " · "
        + "<a href='" + uriFolder + "'>by-uri/</a>"
        + "<a href='" + uriFolder + "meta.json'>meta</a>"
        + (it.fileByUri ? ("<a href='./" + it.fileByUri + "'>ttl</a>") : "")
        + (nsIndex ? (" · <a href='" + nsIndex + "'>namespace/</a>") : "")
        + (nsIndex ? ("<a href='" + nsIndex + "index.json'>ns json</a>") : "")
        + "</span>";

      const statusTxt = it.skipped ? "cached" : (it.ok ? "ok" : "failed");
      const statusClass = it.ok ? "" : "bad";

      const tr = document.createElement("tr");
      tr.innerHTML = [
        "<td><code>" + it.prefix + "</code></td>",
        "<td><a href='" + it.uri + "'>" + it.uri + "</a></td>",
        "<td>" + (it.namespace ? "<code>" + it.namespace + "</code>" : "") + "</td>",
        "<td>" + browseLinks + "</td>",
        "<td>" + ontLink + "</td>",
        "<td class='" + statusClass + "' title='" + (it.note || "") + "'>" + statusTxt + "</td>"
      ].join("");
      rows.appendChild(tr);
    }
  }

  q.addEventListener("input", () => render(q.value));
  render("");
})();
</script>
</body>
</html>`;

  await writeFile(path.join(OUT_ROOT, "index.html"), html, "utf8");

  // namespaces/index.html
  const nsList = Array.from(nsMap.entries())
    .map(([ns, arr]) => ({ ns, count: arr.length }))
    .sort((a, b) => a.ns.localeCompare(b.ns));

  const nsHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Namespaces - LOV Ontology Mirror</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; }
    input { width: 100%; padding: .75rem; font-size: 1rem; margin: 1rem 0; }
    ul { padding-left: 1.25rem; }
    code { background: #f6f6f6; padding: .1rem .25rem; border-radius: .25rem; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Namespaces</h1>
  <p class="muted"><a href="../">← back to vocabs</a></p>

  <input id="q" placeholder="Filter namespaces..." />
  <ul id="list"></ul>

<script>
(function(){
  const items = ${JSON.stringify(nsList)};
  const list = document.getElementById("list");
  const q = document.getElementById("q");
  function enc(x){ return encodeURIComponent(x); }

  function render(filter){
    list.innerHTML = "";
    const f = (filter || "").toLowerCase();
    for (const it of items){
      const hay = it.ns.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const li = document.createElement("li");
      const href = "./" + enc(it.ns) + "/";
      li.innerHTML = "<a href='" + href + "'><code>" + it.ns + "</code></a> <span class='muted'>(" + it.count + ")</span>"
        + " — <a href='" + href + "index.json'>json</a>";
      list.appendChild(li);
    }
  }

  q.addEventListener("input", () => render(q.value));
  render("");
})();
</script>
</body>
</html>`;

  await ensureDir(path.join(OUT_ROOT, "namespaces"));
  await writeFile(
    path.join(OUT_ROOT, "namespaces", "index.html"),
    nsHtml,
    "utf8",
  );
  console.log(`Done. Output: ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
