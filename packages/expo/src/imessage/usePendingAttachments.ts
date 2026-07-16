import { useState } from "react";
import { ATTACHMENT_LIMITS, checkAttachmentBatch } from "@sidekick/shared";
import { attachmentStatus, retryAttachment, uploadAttachment } from "~/lib/api";
import type { PendingAttachment } from "./lib/attachments";
import { pickFile, pickImages, takePhoto } from "./lib/pickers";

const POLL_INTERVAL_MS = 1200;
const POLL_MAX = 40;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type AttachmentSource = "camera" | "photos" | "file";

export interface PendingAttachments {
	pending: PendingAttachment[];
	/** In-voice error line under the composer (over-limit pick, too many, …). */
	error: string | null;
	/** Every pending attachment has finished ingest — the message may send. */
	allReady: boolean;
	pickFrom: (source: AttachmentSource) => Promise<void>;
	remove: (id: string) => void;
	retry: (id: string) => void;
	/** Hand the ready set to a send and reset the composer row. */
	take: () => PendingAttachment[];
}

/**
 * The composer's picked-attachment lifecycle (09 §composer): pick → eager
 * upload via `uploadAttachment` → poll ingest to `ready`/`failed`. The send
 * button stays disabled until every chip is ready; a failed chip shows a retry
 * line and blocks the send until retried or removed.
 */
export function usePendingAttachments(): PendingAttachments {
	const [pending, setPending] = useState<PendingAttachment[]>([]);
	const [error, setError] = useState<string | null>(null);

	function patch(id: string, fields: Partial<PendingAttachment>): void {
		setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
	}

	async function pollReady(localId: string, attachmentId: string): Promise<void> {
		for (let i = 0; i < POLL_MAX; i++) {
			const [status] = await attachmentStatus([attachmentId]);
			if (status?.status === "ready") {
				patch(localId, { status: "ready" });
				return;
			}
			if (status?.status === "failed") {
				patch(localId, { status: "failed" });
				return;
			}
			await sleep(POLL_INTERVAL_MS);
		}
		patch(localId, { status: "failed" });
	}

	async function upload(attachment: PendingAttachment): Promise<void> {
		try {
			const { attachmentId } = await uploadAttachment({
				kind: attachment.kind,
				mime: attachment.mime,
				bytes: attachment.bytes,
				uri: attachment.localUri,
				filename: attachment.filename,
				width: attachment.width,
				height: attachment.height,
			});
			// An image is sendable the moment its bytes land: the turn inlines the
			// image bytes for the model, so it never needs the caption ingest to
			// finish. That vision pass keeps running server-side (for when the image
			// later scrolls out of the recent-image window) — the composer just
			// doesn't wait on it. Files/voice notes still gate on ingest, since the
			// model reads their extracted text / transcript.
			if (attachment.kind === "image") {
				patch(attachment.id, { attachmentId, status: "ready" });
				return;
			}
			patch(attachment.id, { attachmentId, status: "processing" });
			await pollReady(attachment.id, attachmentId);
		} catch {
			patch(attachment.id, { status: "failed" });
		}
	}

	function addAndUpload(current: PendingAttachment[], added: PendingAttachment[]): void {
		if (added.length === 0) {
			return;
		}
		const batch = checkAttachmentBatch([...current, ...added].map((p) => p.kind));
		if (!batch.ok) {
			setError(batch.message);
			return;
		}
		setError(null);
		setPending((prev) => [...prev, ...added]);
		for (const attachment of added) {
			void upload(attachment);
		}
	}

	async function pickFrom(source: AttachmentSource): Promise<void> {
		try {
			if (source === "file") {
				const result = await pickFile();
				if (result && "error" in result) {
					setError(result.error);
					return;
				}
				addAndUpload(pending, result ? [result.attachment] : []);
				return;
			}
			const remaining =
				ATTACHMENT_LIMITS.image.maxPerMessage -
				pending.filter((p) => p.kind === "image").length;
			if (remaining <= 0) {
				setError(
					`that's too many photos (max ${ATTACHMENT_LIMITS.image.maxPerMessage} per message)`,
				);
				return;
			}
			const picked = source === "camera" ? await takePhoto() : await pickImages();
			addAndUpload(pending, picked.slice(0, remaining));
		} catch {
			setError("couldn't add that");
		}
	}

	function remove(id: string): void {
		setPending((prev) => prev.filter((p) => p.id !== id));
		setError(null);
	}

	function retry(id: string): void {
		const attachment = pending.find((p) => p.id === id);
		if (!attachment) {
			return;
		}
		if (attachment.attachmentId !== undefined) {
			const serverId = attachment.attachmentId;
			patch(id, { status: "processing" });
			void retryAttachment(serverId)
				.then(() => pollReady(id, serverId))
				.catch(() => patch(id, { status: "failed" }));
			return;
		}
		patch(id, { status: "uploading" });
		void upload(attachment);
	}

	function take(): PendingAttachment[] {
		const taken = pending;
		setPending([]);
		setError(null);
		return taken;
	}

	return {
		pending,
		error,
		allReady: pending.every((p) => p.status === "ready"),
		pickFrom,
		remove,
		retry,
		take,
	};
}
