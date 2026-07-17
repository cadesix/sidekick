/**
 * Pending-attachment model + pure formatting helpers for the composer and
 * bubbles (09). No React, no RN imports.
 */

import type { AttachmentKind } from "@sidekick/shared";

/** A locally-picked attachment being uploaded/ingested before send. */
export type PendingAttachment = {
	id: string;
	kind: AttachmentKind;
	/** Local device URI (thumbnail / playback before upload completes). */
	localUri: string;
	mime: string;
	bytes: number;
	filename: string;
	width?: number;
	height?: number;
	/** Server attachment id, set once `createUploadUrl` returns. */
	attachmentId?: string;
	status: "uploading" | "processing" | "ready" | "failed";
};

const KB = 1024;
const MB = KB * 1024;

/** "512 B" / "2.3 MB" — the file-bubble size label (09 §file bubble). */
export function formatBytes(bytes: number): string {
	if (bytes < KB) {
		return `${bytes} B`;
	}
	if (bytes < MB) {
		return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
	}
	return `${(bytes / MB).toFixed(1)} MB`;
}

/** Middle-truncate a long filename for the pending pill / file bubble (09 §UI). */
export function truncateFilename(name: string, max = 22): string {
	if (name.length <= max) {
		return name;
	}
	const dot = name.lastIndexOf(".");
	const ext = dot > 0 ? name.slice(dot) : "";
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const keep = max - ext.length - 1;
	if (keep <= 1) {
		return `${name.slice(0, max - 1)}…`;
	}
	const head = Math.ceil(keep / 2);
	const tail = Math.floor(keep / 2);
	return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}

/**
 * The original filename rides URL-encoded in the storage key's last segment
 * (createUpload), so a history row's file bubble recovers it from the URL.
 */
export function filenameFromUrl(url: string): string {
	const segment = url.split("?")[0]?.split("/").pop() ?? "file";
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** "PDF" / "DOCX" / "CSV" from mime or extension for the size caption (09). */
export function fileTypeLabel(mime: string, filename: string): string {
	const ext = filename.includes(".") ? (filename.split(".").pop() ?? "") : "";
	if (mime === "application/pdf" || ext === "pdf") {
		return "PDF";
	}
	if (ext.length > 0 && ext.length <= 5) {
		return ext.toUpperCase();
	}
	return "FILE";
}
