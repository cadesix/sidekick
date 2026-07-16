import mammoth from "mammoth";
import officeparser from "officeparser";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
import { EXTRACTED_TEXT_CAP } from "@sidekick/shared";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type ParsedFile = {
  /** Extracted text, capped at `EXTRACTED_TEXT_CAP`. */
  text: string;
  truncated: boolean;
  /** PDF page count (gates the native-document-block view rule); null otherwise. */
  pageCount: number | null;
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

async function extractPdf(data: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: result.text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(data: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return result.value;
}

/** Each sheet rendered as CSV, headed by its name (09 §file ingest). */
function extractXlsx(data: Uint8Array): string {
  const workbook = XLSX.read(data, { type: "array" });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    return `# ${name}\n${csv}`;
  }).join("\n\n");
}

async function extractPptx(data: Uint8Array): Promise<string> {
  const result = await officeparser.parseOffice(Buffer.from(data));
  return typeof result === "string" ? result : String(result);
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

async function extractRaw(input: {
  mime: string;
  filename: string;
  data: Uint8Array;
}): Promise<{ text: string; pageCount: number | null }> {
  const ext = extensionOf(input.filename);
  if (input.mime === "application/pdf" || ext === "pdf") {
    return extractPdf(input.data);
  }
  if (input.mime === DOCX_MIME || ext === "docx") {
    return { text: await extractDocx(input.data), pageCount: null };
  }
  if (input.mime === XLSX_MIME || ext === "xlsx") {
    return { text: extractXlsx(input.data), pageCount: null };
  }
  if (input.mime === PPTX_MIME || ext === "pptx") {
    return { text: await extractPptx(input.data), pageCount: null };
  }
  return { text: decodeText(input.data), pageCount: null };
}

/**
 * Extract a file's text (09 §file ingest): pdf → pdf-parse, docx → mammoth,
 * xlsx → sheetjs (each sheet as CSV), pptx → officeparser, everything else
 * (csv/json/txt/code) raw. Capped at 50k chars with a truncation marker.
 */
export async function parseFile(input: {
  mime: string;
  filename: string;
  data: Uint8Array;
}): Promise<ParsedFile> {
  const { text, pageCount } = await extractRaw(input);
  if (text.length <= EXTRACTED_TEXT_CAP) {
    return { text, truncated: false, pageCount };
  }
  const marker = "\n\n[truncated — content beyond 50k characters omitted]";
  return {
    text: text.slice(0, EXTRACTED_TEXT_CAP) + marker,
    truncated: true,
    pageCount,
  };
}
