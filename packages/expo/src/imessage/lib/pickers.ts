import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { ATTACHMENT_LIMITS, checkUploadLimit } from "@sidekick/shared";
import type { PendingAttachment } from "./attachments";

const RESIZE_EDGE = 1568;

let counter = 0;
function localId(): string {
	counter += 1;
	return `pending-${Date.now()}-${counter}`;
}

/**
 * Resize an image to a 1568px longest edge at JPEG q0.8 before upload (09 §image:
 * matches Claude's optimal input and slashes upload time). Returns the resized
 * uri + dimensions + byte size.
 */
async function resizeImage(asset: ImagePicker.ImagePickerAsset): Promise<PendingAttachment> {
	const longest = Math.max(asset.width, asset.height);
	const resize = asset.width >= asset.height ? { width: RESIZE_EDGE } : { height: RESIZE_EDGE };
	const actions = longest > RESIZE_EDGE ? [{ resize }] : [];
	const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
		compress: 0.8,
		format: ImageManipulator.SaveFormat.JPEG,
	});
	const response = await fetch(result.uri);
	const blob = await response.blob();
	return {
		id: localId(),
		kind: "image",
		localUri: result.uri,
		mime: "image/jpeg",
		bytes: blob.size,
		filename: asset.fileName ?? "photo.jpg",
		width: result.width,
		height: result.height,
		status: "uploading",
	};
}

/** Pick up to 4 images from the library, resized for upload (09). */
export async function pickImages(): Promise<PendingAttachment[]> {
	const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
	if (!permission.granted) {
		return [];
	}
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ["images"],
		allowsMultipleSelection: true,
		selectionLimit: ATTACHMENT_LIMITS.image.maxPerMessage,
		quality: 1,
	});
	if (result.canceled) {
		return [];
	}
	return Promise.all(result.assets.map(resizeImage));
}

/** Take one photo with the camera, resized for upload (09). */
export async function takePhoto(): Promise<PendingAttachment[]> {
	const permission = await ImagePicker.requestCameraPermissionsAsync();
	if (!permission.granted) {
		return [];
	}
	const result = await ImagePicker.launchCameraAsync({ quality: 1 });
	if (result.canceled) {
		return [];
	}
	return Promise.all(result.assets.map(resizeImage));
}

/**
 * Pick one document (09 §files). Returns an over-limit sentinel via `error` so the
 * composer can show the in-voice size line rather than uploading a doomed file.
 */
export async function pickFile(): Promise<
	{ attachment: PendingAttachment } | { error: string } | null
> {
	const result = await DocumentPicker.getDocumentAsync({
		multiple: false,
		copyToCacheDirectory: true,
	});
	if (result.canceled) {
		return null;
	}
	const asset = result.assets[0];
	if (!asset) {
		return null;
	}
	const bytes = asset.size ?? 0;
	const check = checkUploadLimit({ kind: "file", bytes });
	if (!check.ok) {
		return { error: check.message };
	}
	return {
		attachment: {
			id: localId(),
			kind: "file",
			localUri: asset.uri,
			mime: asset.mimeType ?? "application/octet-stream",
			bytes,
			filename: asset.name,
			status: "uploading",
		},
	};
}
