import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

export async function loadJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(path.join(DATA_DIR, fileName), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJsonFile(fileName: string, data: unknown): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      path.join(DATA_DIR, fileName),
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn(`[PersistentMemory] Failed to save ${fileName}:`, e);
  }
}