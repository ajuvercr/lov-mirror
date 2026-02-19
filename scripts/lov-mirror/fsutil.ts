import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const txt = await readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export async function writeJson(p: string, obj: unknown) {
  await ensureDir(path.dirname(p));
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export async function writeText(p: string, text: string) {
  await ensureDir(path.dirname(p));
  await writeFile(p, text, "utf8");
}
