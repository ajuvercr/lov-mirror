import path from "node:path";
import { CONCURRENCY, OUT_FILENAME, OUT_ROOT } from "./config.ts";
import { encPrefixSegment, encUriSegment } from "./encode.ts";
import {
  ensureDir,
  fileExists,
  readJsonIfExists,
  writeJson,
  writeText,
} from "./fsutil.ts";
import { fetchText } from "./http.ts";
import { extractLatestVersion, fetchLovList, type VocabItem } from "./lov.ts";
import { parseAndSerializeToTurtle } from "./rdf.ts";
import {
  findClassesAndProperties,
  writeTinyTermFile,
  extractTermSummary,
  type TermInfo,
} from "./terms.ts";
import {
  writeGlobalIndexHtml,
  writeNamespacesIndexHtml,
  writePerOntologyIndexHtml,
  writeTermsIndexHtml,
} from "./html.ts";

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

type ResultItem = {
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
  classCount?: number;
  propertyCount?: number;
  classLinks?: TermInfo[];
  propLinks?: TermInfo[];
};

async function processOne(v: VocabItem): Promise<ResultItem> {
  const prefixDir = path.join(
    OUT_ROOT,
    "by-prefix",
    encPrefixSegment(v.prefix),
  );
  const uriDir = path.join(OUT_ROOT, "by-uri", encUriSegment(v.uri));

  await ensureDir(prefixDir);
  await ensureDir(uriDir);

  const prefixMetaPath = path.join(prefixDir, "meta.json");
  const prefixOntPath = path.join(prefixDir, OUT_FILENAME);

  // 1) Determine latest LOV file
  let latest: { fileURL: string; issued: string } | null = null;
  try {
    latest = await extractLatestVersion(v.prefix);
  } catch {
    latest = null;
  }

  if (!latest) {
    return {
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
    };
  }

  // 2) Cache check: meta + ontology.ttl and convert ok
  const existingMeta = await readJsonIfExists<Meta>(prefixMetaPath);
  const hasFile = await fileExists(prefixOntPath);

  const isUpToDate =
    hasFile &&
    existingMeta?.lovLatestFileURL === latest.fileURL &&
    existingMeta?.lovLatestIssued === latest.issued &&
    existingMeta?.convert?.ok === true;

  if (isUpToDate) {
    return {
      prefix: v.prefix,
      uri: v.uri,
      namespace: v.namespace,
      lovLatestFileURL: latest.fileURL,
      lovLatestIssued: latest.issued,
      ok: true,
      status: 304,
      finalUrl: existingMeta?.finalUrl ?? null,
      fileByPrefix: `by-prefix/${encodeURIComponent(v.prefix)}/${OUT_FILENAME}`,
      fileByUri: `by-uri/${encUriSegment(v.uri)}/${OUT_FILENAME}`,
      skipped: true,
      classCount: existingMeta ? undefined : undefined,
      propertyCount: existingMeta ? undefined : undefined,
    };
  }

  // 3) Download
  const fr = await fetchText(latest.fileURL);

  let fileByPrefix: string | null = null;
  let fileByUri: string | null = null;

  let convertOk = false;
  let convertReason: string | undefined;

  let classLinks: TermInfo[] = [];
  let propLinks: TermInfo[] = [];

  if (fr.ok && fr.text != null) {
    const conv = await parseAndSerializeToTurtle({
      inputText: fr.text,
      inputContentType: fr.contentType,
      baseIRI: v.uri,
      sourceUrl: latest.fileURL,
    });

    if (conv.ok) {
      convertOk = true;

      // Write ontology.ttl into both places
      await writeText(path.join(prefixDir, OUT_FILENAME), conv.ttl);
      await writeText(path.join(uriDir, OUT_FILENAME), conv.ttl);

      fileByPrefix = `by-prefix/${encodeURIComponent(v.prefix)}/${OUT_FILENAME}`;
      fileByUri = `by-uri/${encUriSegment(v.uri)}/${OUT_FILENAME}`;

      // Extract classes/properties + write tiny files
      const { classes, properties } = findClassesAndProperties(conv.store);

      for (const iri of classes) {
        const href = await writeTinyTermFile({
          outRoot: OUT_ROOT,
          kind: "classes",
          termIri: iri,
          store: conv.store,
        });
        if (!href) continue;
        const { label, description } = extractTermSummary(conv.store, iri);
        classLinks.push({ iri, href, label, description });
      }
      for (const iri of properties) {
        const href = await writeTinyTermFile({
          outRoot: OUT_ROOT,
          kind: "properties",
          termIri: iri,
          store: conv.store,
        });
        if (!href) continue;
        const { label, description } = extractTermSummary(conv.store, iri);
        propLinks.push({ iri, href, label, description });
      }

      // Per-ontology index.html (by-prefix/<prefix>/index.html)
      await writePerOntologyIndexHtml({
        prefixDir,
        prefix: v.prefix,
        outFilename: OUT_FILENAME,
        classLinks,
        propLinks,
      });
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

  return {
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
    note: convertReason ?? fr.error,
    classCount: classLinks.length,
    propertyCount: propLinks.length,
    classLinks,
    propLinks,
  };
}

export async function run() {
  await ensureDir(OUT_ROOT);
  await ensureDir(path.join(OUT_ROOT, "by-prefix"));
  await ensureDir(path.join(OUT_ROOT, "by-uri"));
  await ensureDir(path.join(OUT_ROOT, "namespaces"));
  await ensureDir(path.join(OUT_ROOT, "classes"));
  await ensureDir(path.join(OUT_ROOT, "properties"));

  const allClasses = new Map<string, TermInfo>(); // iri -> href
  const allProperties = new Map<string, TermInfo>(); // iri -> href

  const vocabs = await fetchLovList();
  console.log(
    `Processing ${vocabs.length} vocabs with concurrency=${CONCURRENCY}...`,
  );

  let next = 0;
  const results: ResultItem[] = [];

  async function worker(workerId: number) {
    while (true) {
      const i = next++;
      if (i >= vocabs.length) return;

      const v = vocabs[i];
      const r = await processOne(v);
      results.push(r);

      if (r.classLinks) {
        for (const t of r.classLinks) {
          // Keep first seen label/description; you can prefer “has label” if you want.
          if (!allClasses.has(t.iri)) allClasses.set(t.iri, t);
        }
      }
      if (r.propLinks) {
        for (const t of r.propLinks) {
          if (!allProperties.has(t.iri)) allProperties.set(t.iri, t);
        }
      }

      if (i % 50 === 0)
        console.log(`[worker ${workerId}] ${i + 1}/${vocabs.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));

  results.sort((a, b) => a.prefix.localeCompare(b.prefix));

  // Global index.json
  await writeJson(path.join(OUT_ROOT, "index.json"), {
    generatedAt: new Date().toISOString(),
    count: results.length,
    okCount: results.filter((r) => r.ok).length,
    skippedCount: results.filter((r) => r.skipped).length,
    items: results,
  });

  // Namespace grouping
  const nsMap = new Map<string, ResultItem[]>();
  for (const r of results) {
    if (!r.namespace) continue;
    const arr = nsMap.get(r.namespace) ?? [];
    arr.push(r);
    nsMap.set(r.namespace, arr);
  }

  for (const [ns, arr] of nsMap.entries()) {
    const nsDir = path.join(OUT_ROOT, "namespaces", encUriSegment(ns));
    await ensureDir(nsDir);
    await writeJson(path.join(nsDir, "index.json"), {
      namespace: ns,
      count: arr.length,
      items: arr,
    });
  }

  // Namespaces index.html
  const nsList = Array.from(nsMap.entries())
    .map(([ns, arr]) => ({ ns, count: arr.length }))
    .sort((a, b) => a.ns.localeCompare(b.ns));
  await writeNamespacesIndexHtml({ outRoot: OUT_ROOT, namespaces: nsList });

  // Global index.html
  await writeGlobalIndexHtml({ outRoot: OUT_ROOT, outFilename: OUT_FILENAME });

  // const classItems: Array<TermInfo> = Array.from(allClasses.entries())
  //   .map(([iri, href]) => ({ iri, href }))
  //   .sort((a, b) => a.iri.localeCompare(b.iri))
  //   .map((x) => x.href);
  //
  // const propItems = Array.from(allProperties.entries())
  //   .map(([iri, href]) => ({ iri, href }))
  //   .sort((a, b) => a.iri.localeCompare(b.iri))
  //   .map((x) => x.href);
  //
  // await writeTermsIndexHtml({
  //   outRoot: OUT_ROOT,
  //   kind: "classes",
  //   title: `Classes (${classItems.length})`,
  //   description: "",
  //   items: classItems,
  // });
  //
  // await writeTermsIndexHtml({
  //   outRoot: OUT_ROOT,
  //   kind: "properties",
  //   title: `Properties (${propItems.length})`,
  //   description: "",
  //   items: propItems,
  // });

  console.log(`Done. Output: ${OUT_ROOT}`);
}
