import { fetchJson } from "./http.ts";
import { LOV_INFO_URL, LOV_LIST_URL } from "./config.ts";

export type LovListEntry = {
  prefix?: string;
  vocab?: string;
  uri?: string;
  nsp?: string;
  namespace?: string;
  title?: string;
  [k: string]: unknown;
};

export type LovInfoVersion = {
  fileURL?: string | null;
  issued: string; // ISO datetime
};

export type LovInfo = {
  versions: LovInfoVersion[];
};

export type VocabItem = {
  prefix: string;
  uri: string;
  namespace: string | null;
  title?: string;
};

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

export async function fetchLovList(): Promise<VocabItem[]> {
  const list = await fetchJson<LovListEntry[]>(LOV_LIST_URL);
  return list
    .map((v) => {
      const prefix = pickPrefix(v);
      const uri = pickUri(v);
      if (!prefix || !uri) return null;
      return {
        prefix,
        uri,
        namespace: pickNamespace(v),
        title: (v.title as string | undefined) ?? undefined,
      };
    })
    .filter(Boolean) as VocabItem[];
}

export async function extractLatestVersion(
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
