import { readFileSync } from "node:fs";
import { join } from "node:path";

interface LineEntry {
  name: string;
  parent: string | null;
}

let cachedLines: { line: string; name: string; parent: string | null }[] | null = null;

export function getLines(): { line: string; name: string; parent: string | null }[] {
  if (cachedLines) return cachedLines;
  const filePath = join(process.cwd(), "src/huawei_line.json");
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, LineEntry>;
  cachedLines = Object.entries(raw).map(([id, entry]) => ({
    line: id,
    name: entry.name,
    parent: entry.parent,
  }));
  return cachedLines;
}
