import path from "node:path";
import { nanoid } from "nanoid";
import { sha256 } from "./skills.js";

const DIRECT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".html",
  ".htm",
  ".log",
]);

export interface ExtractedDocument {
  text: string;
  method: "direct" | "tika";
  chunks: Array<{ id: string; position: number; locator: string; content: string; sha256: string }>;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\0").join("").trim();
}

export function chunkDocument(text: string, maxChars = 12_000) {
  const lines = text.split("\n");
  const chunks: ExtractedDocument["chunks"] = [];
  let content = "";
  let heading = "Dokumentanfang";
  let startLine = 1;

  const push = (endLine: number) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      id: nanoid(),
      position: chunks.length,
      locator: `${heading} · Zeilen ${startLine}–${endLine}`,
      content: trimmed,
      sha256: sha256(trimmed),
    });
    content = "";
    startLine = endLine + 1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,4}\s+/.test(line)) heading = line.replace(/^#+\s+/, "").trim();
    if (content.length + line.length + 1 > maxChars && content.length > 0) push(index);
    content += `${line}\n`;
  }
  push(lines.length);
  return chunks;
}

export async function extractDocument(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ExtractedDocument> {
  const extension = path.extname(filename).toLowerCase();
  let text: string;
  let method: ExtractedDocument["method"];

  if (DIRECT_EXTENSIONS.has(extension) || mimeType.startsWith("text/")) {
    text = normalizeText(buffer.toString("utf8"));
    method = "direct";
  } else {
    const tikaUrl = process.env.TIKA_URL ?? "http://127.0.0.1:9998";
    const response = await fetch(`${tikaUrl}/tika`, {
      method: "PUT",
      headers: { Accept: "text/plain", "Content-Type": mimeType || "application/octet-stream" },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Tika konnte das Dokument nicht lesen (${response.status}).`);
    text = normalizeText(await response.text());
    method = "tika";
  }

  if (!text) throw new Error("Aus dem Dokument konnte kein Text extrahiert werden.");
  return { text, method, chunks: chunkDocument(text) };
}
