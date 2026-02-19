export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "lov-mirror/1.0 (Bun; static mirror for GitHub Pages)",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string): Promise<{
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

export function contentTypeBase(ct: string | null): string | null {
  if (!ct) return null;
  return ct.split(";")[0]?.trim().toLowerCase() ?? null;
}

export function urlExt(url: string): string {
  const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return (m?.[1] ?? "").toLowerCase();
}
