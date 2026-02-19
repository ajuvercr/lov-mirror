import path from "node:path";

export const LOV_LIST_URL =
  "https://lov.linkeddata.es/dataset/lov/api/v2/vocabulary/list";
export const LOV_INFO_URL = (prefix: string) =>
  `https://lov.linkeddata.es/dataset/lov/api/v2/vocabulary/info?vocab=${encodeURIComponent(prefix)}`;

export const OUT_ROOT = path.resolve(process.env.OUT_DIR ?? "public/lov");
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

export const OUT_FILENAME = "ontology.ttl";
