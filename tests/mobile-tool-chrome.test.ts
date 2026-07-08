import { expect, test } from "vitest";
import { readToolChrome } from "../apps/mobile/features/chat/tool-chrome";

test("create_document yields a DocumentCard descriptor from input + result", () => {
  const chrome = readToolChrome([
    {
      toolName: "create_document",
      input: { title: "Trip plan", content_markdown: "flights + hotel" },
      result: { ok: true, document_id: "doc-1", title: "Trip plan" },
    },
  ]);
  expect(chrome.document).toEqual({
    documentId: "doc-1",
    title: "Trip plan",
    preview: "flights + hotel",
  });
  expect(chrome.remindersLink).toBe(false);
});

test("reminder tools flip the reminders link on", () => {
  expect(readToolChrome([{ toolName: "create_reminder", input: {}, result: {} }]).remindersLink).toBe(true);
  expect(readToolChrome([{ toolName: "list_reminders", input: {}, result: {} }]).remindersLink).toBe(true);
});

test("non-chrome tool calls and malformed input yield an empty chrome", () => {
  expect(readToolChrome([{ toolName: "log_checkin", input: {}, result: { ok: true } }])).toEqual({
    document: null,
    remindersLink: false,
  });
  expect(readToolChrome(null)).toEqual({ document: null, remindersLink: false });
  expect(readToolChrome([{ toolName: "create_document", input: {}, result: {} }]).document).toBeNull();
});
