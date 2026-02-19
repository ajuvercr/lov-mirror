import path from "node:path";
import { DataFactory, Store, Writer } from "n3";
import { ensureDir, fileExists, writeText } from "./fsutil.ts";
import { encUriSegment } from "./encode.ts";

const { namedNode } = DataFactory;

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const DCT = "http://purl.org/dc/terms/";

const rdfType = namedNode(RDF + "type");

const CLASS_TYPES = new Set([OWL + "Class", RDFS + "Class"]);

const PROPERTY_TYPES = new Set([
  RDF + "Property",
  OWL + "ObjectProperty",
  OWL + "DatatypeProperty",
  OWL + "AnnotationProperty",
  OWL + "FunctionalProperty",
  OWL + "InverseFunctionalProperty",
  OWL + "TransitiveProperty",
  OWL + "SymmetricProperty",
  OWL + "AsymmetricProperty",
  OWL + "ReflexiveProperty",
  OWL + "IrreflexiveProperty",
]);

// Keep tiny files small
const DEF_PREDICATES = new Set([
  RDF + "type",

  RDFS + "label",
  RDFS + "comment",
  RDFS + "isDefinedBy",
  RDFS + "seeAlso",

  RDFS + "subClassOf",
  RDFS + "subPropertyOf",
  RDFS + "domain",
  RDFS + "range",

  OWL + "equivalentClass",
  OWL + "equivalentProperty",
  OWL + "inverseOf",
  OWL + "deprecated",

  SKOS + "prefLabel",
  SKOS + "altLabel",
  SKOS + "definition",
  SKOS + "scopeNote",
  SKOS + "example",

  DCT + "title",
  DCT + "description",
]);

function isNamedNodeIri(x: any): x is { termType: "NamedNode"; value: string } {
  return x && x.termType === "NamedNode" && typeof x.value === "string";
}

function litValue(x: any): string | null {
  if (!x) return null;
  if (x.termType === "Literal" && typeof x.value === "string") return x.value;
  return null;
}

function pickFirstLiteral(
  store: Store,
  subjIri: string,
  predicateIri: string,
): string | null {
  const s = namedNode(subjIri);
  const p = namedNode(predicateIri);
  const qs = store.getQuads(s, p, null, null);
  for (const q of qs) {
    const v = litValue(q.object);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

// Prefer label-ish then definition-ish
export function extractTermSummary(
  store: Store,
  termIri: string,
): { label?: string; description?: string } {
  const label =
    pickFirstLiteral(store, termIri, SKOS + "prefLabel") ??
    pickFirstLiteral(store, termIri, RDFS + "label") ??
    pickFirstLiteral(store, termIri, DCT + "title") ??
    undefined;

  const description =
    pickFirstLiteral(store, termIri, SKOS + "definition") ??
    pickFirstLiteral(store, termIri, RDFS + "comment") ??
    pickFirstLiteral(store, termIri, DCT + "description") ??
    pickFirstLiteral(store, termIri, SKOS + "scopeNote") ??
    undefined;

  return { label, description };
}

export function findClassesAndProperties(store: Store): {
  classes: string[];
  properties: string[];
} {
  const classes = new Set<string>();
  const properties = new Set<string>();

  for (const q of store.getQuads(null, rdfType, null, null)) {
    if (!isNamedNodeIri(q.subject) || !isNamedNodeIri(q.object)) continue;

    if (CLASS_TYPES.has(q.object.value)) classes.add(q.subject.value);
    if (PROPERTY_TYPES.has(q.object.value)) properties.add(q.subject.value);
  }

  return {
    classes: Array.from(classes).sort(),
    properties: Array.from(properties).sort(),
  };
}

export type TermInfo = {
  iri: string;
  href: string; // relative to OUT_ROOT: "classes/<file>.ttl"
  label?: string;
  description?: string;
};

export async function writeTinyTermFile(opts: {
  outRoot: string; // OUT_ROOT
  kind: "classes" | "properties";
  termIri: string;
  store: Store;
}): Promise<string | null> {
  const folder = path.join(opts.outRoot, opts.kind);
  await ensureDir(folder);

  const filename = `${encUriSegment(opts.termIri)}.ttl`;
  const filePath = path.join(folder, filename);

  // fast-path: if it exists, don't rewrite
  if (await fileExists(filePath)) {
    return `${opts.kind}/${filename}`;
  }

  const term = namedNode(opts.termIri);
  const quads = opts.store
    .getQuads(term, null, null, null)
    .filter(
      (q) =>
        isNamedNodeIri(q.predicate) && DEF_PREDICATES.has(q.predicate.value),
    );

  if (quads.length === 0) return null;

  const writer = new Writer({ format: "Turtle", prefixes: {} });
  writer.addQuads(quads);

  const ttl = await new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });

  await writeText(filePath, ttl);
  return `${opts.kind}/${filename}`;
}
