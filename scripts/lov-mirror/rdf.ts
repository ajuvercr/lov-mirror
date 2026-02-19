import { Parser, Writer, Store } from "n3";
import { contentTypeBase, urlExt } from "./http.ts";

export type ParseResult =
  | { ok: true; store: Store; ttl: string }
  | { ok: false; reason: string };

type N3Format = "turtle" | "n3" | "ntriples" | "trig";

function n3FormatFor(
  contentType: string | null,
  sourceUrl: string,
): N3Format | null {
  const ct = contentTypeBase(contentType);

  if (ct === "text/turtle" || ct === "application/x-turtle") return "turtle";
  if (ct === "text/n3" || ct === "text/rdf+n3") return "n3";
  if (ct === "application/n-triples") return "ntriples";
  if (ct === "application/trig" || ct === "text/trig") return "trig";

  const ext = urlExt(sourceUrl);
  if (ext === "ttl") return "turtle";
  if (ext === "n3") return "n3";
  if (ext === "nt") return "ntriples";
  if (ext === "trig") return "trig";

  // Explicitly unsupported with N3-only approach
  if (
    ct === "application/rdf+xml" ||
    ext === "rdf" ||
    ext === "owl" ||
    ext === "xml"
  )
    return null;
  if (ct === "application/ld+json" || ext === "jsonld" || ext === "json")
    return null;

  // Unknown: try turtle (some servers mislabel)
  return "turtle";
}

export async function parseAndSerializeToTurtle(opts: {
  inputText: string;
  inputContentType: string | null;
  baseIRI: string;
  sourceUrl: string;
}): Promise<ParseResult> {
  const format = n3FormatFor(opts.inputContentType, opts.sourceUrl);
  if (!format) {
    return {
      ok: false,
      reason: `Unsupported format: ${opts.inputContentType ?? "unknown"} (${opts.sourceUrl})`,
    };
  }

  const parser = new Parser({ format, baseIRI: opts.baseIRI });
  const store = new Store();

  try {
    store.addQuads(parser.parse(opts.inputText));
  } catch (e) {
    return {
      ok: false,
      reason: `Parse failed (${format}): ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const writer = new Writer({ format: "Turtle", prefixes: {} });
  writer.addQuads(store.getQuads(null, null, null, null));

  const ttl = await new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });

  return { ok: true, store, ttl };
}
