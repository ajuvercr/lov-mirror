import path from "node:path";
import { writeText, ensureDir } from "./fsutil.ts";
import type { TermInfo } from "./terms.ts";

export async function writeGlobalIndexHtml(opts: {
  outRoot: string;
  outFilename: string; // ontology.ttl
}) {
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
    .links a { margin-right: .6rem; }
  </style>
</head>
<body>
  <h1>LOV Ontology Mirror</h1>
  <p class="muted">
    Successful vocabularies are published as <code>${opts.outFilename}</code>.
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

  function encPrefix(x){ return encodeURIComponent(x); }
  function encUri(x){ return encodeURIComponent(x).replaceAll("%","%25"); }

  function render(filter){
    rows.innerHTML = "";
    const f = (filter || "").toLowerCase();

    for (const it of items){
      const hay = (it.prefix + " " + it.uri + " " + (it.namespace || "")).toLowerCase();
      if (f && !hay.includes(f)) continue;

      const prefixFolder = "./by-prefix/" + encPrefix(it.prefix) + "/";
      const uriFolder = "./by-uri/" + encUri(it.uri) + "/";

      const browseLinks =
        "<span class='links'>"
        + "<a href='" + prefixFolder + "index.html'>terms</a>"
        + "<a href='" + prefixFolder + "meta.json'>meta</a>"
        + (it.ok ? "<a href='" + prefixFolder + "${opts.outFilename}'>by-prefix.ttl</a>" : "")
        + (it.ok ? "<a href='" + uriFolder + "${opts.outFilename}'>by-url.ttl</a>" : "")
        + "</span>";

      const statusTxt = it.skipped ? "cached" : (it.ok ? "ok" : ("failed"));
      const statusClass = it.ok ? "" : "bad";

      const tr = document.createElement("tr");
      tr.innerHTML = [
        "<td><code>" + it.prefix + "</code></td>",
        "<td><a href='" + it.uri + "'>" + it.uri + "</a></td>",
        "<td>" + (it.namespace ? "<code>" + it.namespace + "</code>" : "") + "</td>",
        "<td>" + browseLinks + "</td>",
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

  await writeText(path.join(opts.outRoot, "index.html"), html);
}

export async function writeNamespacesIndexHtml(opts: {
  outRoot: string; // OUT_ROOT
  namespaces: Array<{ ns: string; count: number }>;
}) {
  const html = `<!doctype html>
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
  const items = ${JSON.stringify(opts.namespaces)};
  const list = document.getElementById("list");
  const q = document.getElementById("q");
  function encUri(x){ return encodeURIComponent(x).replaceAll("%","%25"); }

  function render(filter){
    list.innerHTML = "";
    const f = (filter || "").toLowerCase();
    for (const it of items){
      const hay = it.ns.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const li = document.createElement("li");
      const href = "./" + encUri(it.ns) + "/";
      li.innerHTML =
        "<a href='" + href + "'><code>" + it.ns + "</code></a> <span class='muted'>(" + it.count + ")</span>"
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

  const folder = path.join(opts.outRoot, "namespaces");
  await ensureDir(folder);
  await writeText(path.join(folder, "index.html"), html);
}

export async function writePerOntologyIndexHtml(opts: {
  prefixDir: string; // OUT_ROOT/by-prefix/<prefix>
  prefix: string;
  outFilename: string; // ontology.ttl
  classLinks: TermInfo[];
  propLinks: TermInfo[];
}) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${opts.prefix} – LOV mirror</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; }
    code { background: #f6f6f6; padding: .1rem .25rem; border-radius: .25rem; }
    input { width: 100%; padding: .75rem; font-size: 1rem; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #ddd; padding: .5rem; vertical-align: top; }
    .muted { color: #666; }
    .small { font-size: .92rem; }
    .nowrap { white-space: nowrap; }
  </style>
</head>
<body>
  <p class="muted"><a href="../../index.html">← back</a></p>
  <h1><code>${opts.prefix}</code></h1>
  <p>
    <a href="./${opts.outFilename}">${opts.outFilename}</a> ·
    <a href="./meta.json">meta.json</a>
  </p>

  <h2>Classes (${opts.classLinks.length})</h2>
  <input id="qc" placeholder="Filter classes by IRI / name / description..." />
  <table>
    <thead>
      <tr>
        <th>Class</th>
        <th>Name</th>
        <th>Description</th>
        <th class="nowrap">Tiny file</th>
      </tr>
    </thead>
    <tbody id="classes"></tbody>
  </table>

  <h2>Properties (${opts.propLinks.length})</h2>
  <input id="qp" placeholder="Filter properties by IRI / name / description..." />
  <table>
    <thead>
      <tr>
        <th>Property</th>
        <th>Name</th>
        <th>Description</th>
        <th class="nowrap">Tiny file</th>
      </tr>
    </thead>
    <tbody id="props"></tbody>
  </table>

<script>
(function(){
  const classes = ${JSON.stringify(opts.classLinks)};
  const props = ${JSON.stringify(opts.propLinks)};

  const tbodyC = document.getElementById("classes");
  const tbodyP = document.getElementById("props");
  const qc = document.getElementById("qc");
  const qp = document.getElementById("qp");

  function esc(s){
    return (s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  }

  function render(list, tbody, filter){
    tbody.innerHTML = "";
    const f = (filter || "").toLowerCase();

    for (const it of list){
      const hay = (it.iri + " " + (it.label||"") + " " + (it.description||"")).toLowerCase();
      if (f && !hay.includes(f)) continue;

      const tr = document.createElement("tr");

      const termCell = "<a href='" + it.iri + "'><code>" + esc(it.iri) + "</code></a>";
      const nameCell = it.label ? esc(it.label) : "<span class='muted small'>(no label)</span>";
      const descCell = it.description ? esc(it.description) : "<span class='muted small'>(no description)</span>";

      // from by-prefix/<prefix>/ to OUT_ROOT/<kind>/<file> is ../../<kind>/<file>
      const tinyHref = it.href ? ("../../" + encodeURIComponent(it.href) ) : "";
      const tinyCell = it.href ? ("<a href='" + tinyHref + "'>ttl</a>") : "<span class='muted small'>(none)</span>";

      tr.innerHTML = [
        "<td>" + termCell + "</td>",
        "<td>" + nameCell + "</td>",
        "<td class='small'>" + descCell + "</td>",
        "<td class='nowrap'>" + tinyCell + "</td>"
      ].join("");

      tbody.appendChild(tr);
    }
  }

  qc.addEventListener("input", () => render(classes, tbodyC, qc.value));
  qp.addEventListener("input", () => render(props, tbodyP, qp.value));

  render(classes, tbodyC, "");
  render(props, tbodyP, "");
})();
</script>
</body>
</html>`;

  await writeText(path.join(opts.prefixDir, "index.html"), html);
}

export async function writeTermsIndexHtml(opts: {
  outRoot: string; // OUT_ROOT
  kind: "classes" | "properties";
  title: string;
  description: string;
  items: Array<TermInfo>;
}) {
  const folder = path.join(opts.outRoot, opts.kind);
  await ensureDir(folder);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${opts.title} - LOV Ontology Mirror</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; }
    input { width: 100%; padding: .75rem; font-size: 1rem; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #ddd; padding: .5rem; vertical-align: top; }
    code { background: #f6f6f6; padding: .1rem .25rem; border-radius: .25rem; }
    .muted { color: #666; }
    .small { font-size: .92rem; }
    .nowrap { white-space: nowrap; }
  </style>
</head>
<body>
  <h1>${opts.title}</h1>
  <p class="muted">
    ${opts.description}
    <br/>
    <a href="../">← back to vocabs</a>
  </p>

  <input id="q" placeholder="Filter by IRI / label / description..." />

  <table>
    <thead>
      <tr>
        <th>Term</th>
        <th>Name</th>
        <th>Description</th>
        <th class="nowrap">Files</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

<script>
(function(){
  const items = ${JSON.stringify(opts.items)};
  const rows = document.getElementById("rows");
  const q = document.getElementById("q");

  function esc(s){
    return (s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  }

  function render(filter){
    rows.innerHTML = "";
    const f = (filter || "").toLowerCase();

    for (const it of items){
      const hay = (it.iri + " " + (it.label||"") + " " + (it.description||"")).toLowerCase();
      if (f && !hay.includes(f)) continue;

      const tr = document.createElement("tr");

      const termCell = "<a href='" + it.iri + "'><code>" + esc(it.iri) + "</code></a>";
      const nameCell = it.label ? esc(it.label) : "<span class='muted small'>(no label)</span>";
      const descCell = it.description ? esc(it.description) : "<span class='muted small'>(no description)</span>";

      // link to tiny TTL plus convenience link to folder listing
      const ttlLink = "<a href='../" + encodeURIComponent(it.href) + "'>ttl</a>";
      const folderLink = "<a href='./'>folder</a>";

      tr.innerHTML = [
        "<td>" + termCell + "</td>",
        "<td>" + nameCell + "</td>",
        "<td class='small'>" + descCell + "</td>",
        "<td class='nowrap'>" + ttlLink + " · " + folderLink + "</td>"
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

  await writeText(path.join(folder, "index.html"), html);
}
