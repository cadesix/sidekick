/**
 * Interpret an assistant message's persisted `toolCalls` (each entry carries its
 * server-tool `result`) into the chrome the chat thread renders beneath the bubble
 * (09 handoffs): a DocumentCard for create/update_document, and a "see all →"
 * reminders link for the reminder tools. Pure + unit-tested.
 */

const DOCUMENT_TOOLS = new Set(["create_document", "update_document"]);
const REMINDER_TOOLS = new Set(["list_reminders", "create_reminder", "update_reminder"]);

export type DocumentChrome = { documentId: string; title: string; preview: string };
export type ToolChrome = { document: DocumentChrome | null; remindersLink: boolean };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const WEB_SEARCH_TOOL = "web_search";

/** One cited source under a search-using bubble (11 §citations UI). */
export type SearchSource = { url: string; domain: string; title: string | null };

/** The registrable domain for a pill label — protocol/path stripped, `www.` dropped. */
export function domainOf(url: string): string {
  const withoutProtocol = url.replace(/^[a-z]+:\/\//i, "");
  const host = withoutProtocol.split("/")[0] ?? withoutProtocol;
  return host.replace(/^www\./i, "");
}

/**
 * The cited sources a message's search produced, de-duplicated by domain (11).
 * Reads the compact `{ url, title }` list persisted on each `web_search` tool
 * call — never `encrypted_content`, which stays server-side.
 */
export function readSearchSources(toolCalls: unknown): SearchSource[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const seen = new Set<string>();
  const sources: SearchSource[] = [];
  for (const entry of toolCalls) {
    const record = asRecord(entry);
    if (asString(record.toolName) !== WEB_SEARCH_TOOL || !Array.isArray(record.result)) {
      continue;
    }
    for (const item of record.result) {
      const result = asRecord(item);
      const url = asString(result.url);
      if (url === null) {
        continue;
      }
      const domain = domainOf(url);
      if (seen.has(domain)) {
        continue;
      }
      seen.add(domain);
      sources.push({ url, domain, title: asString(result.title) });
    }
  }
  return sources;
}

export type PillRow = { pills: SearchSource[]; moreCount: number };

/**
 * The pill-row layout (11): up to 4 pills. Past 4, the fourth slot becomes a
 * `+N more` chip (so 3 real pills show) until the row is expanded in place, then
 * all pills show. Pure so the grouping is unit-tested on its own.
 */
export function groupSourcePills(sources: SearchSource[], expanded: boolean): PillRow {
  const MAX_PILLS = 4;
  if (expanded || sources.length <= MAX_PILLS) {
    return { pills: sources, moreCount: 0 };
  }
  return { pills: sources.slice(0, MAX_PILLS - 1), moreCount: sources.length - (MAX_PILLS - 1) };
}

export function readToolChrome(toolCalls: unknown): ToolChrome {
  const chrome: ToolChrome = { document: null, remindersLink: false };
  if (!Array.isArray(toolCalls)) {
    return chrome;
  }
  for (const entry of toolCalls) {
    const record = asRecord(entry);
    const toolName = asString(record.toolName);
    if (toolName === null) {
      continue;
    }
    if (REMINDER_TOOLS.has(toolName)) {
      chrome.remindersLink = true;
    }
    if (DOCUMENT_TOOLS.has(toolName)) {
      const input = asRecord(record.input);
      const result = asRecord(record.result);
      const documentId = asString(result.document_id);
      const title = asString(result.title) ?? asString(input.title);
      if (documentId !== null && title !== null) {
        chrome.document = {
          documentId,
          title,
          preview: asString(input.content_markdown) ?? "",
        };
      }
    }
  }
  return chrome;
}
