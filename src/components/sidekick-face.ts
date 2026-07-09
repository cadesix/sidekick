import * as THREE from "three";

// Face sprite system: the GLB's "FaceSprite" plane (a curved shell over the
// face hole, skinned to Head) samples one cell of a 4×4 expression sheet.
// Cells are FILLED with the flat body-albedo yellow (the plane covers a real
// hole in the head, so transparency would show the head interior) and the
// plane is lit with the same material family as the body, so the face reads
// as printed-on-vinyl.
//
// Sheet: public/face-sheet.png, 2048×2048, 4×4 grid of 512px cells, drawn in
// glTF orientation (row 0 = top of image = top of face). Currently a
// generated placeholder — replace with real artwork, same grid, no code
// changes needed.

export const FACE_SHEET_URL = "/face-sheet.png?v=6";
const GRID = 4;

// name → [col, row]; keep in sync with the sheet
export const FACE_CELLS = {
	neutral: [0, 0],
	blink: [1, 0],
	happy: [2, 0],
	excited: [3, 0],
	cheer: [0, 1],
	sad: [1, 1],
	sleepy: [2, 1],
	thinking: [3, 1],
	surprised: [0, 2],
	wink: [1, 2],
	talkOpen: [2, 2],
	talkClosed: [3, 2],
} as const;
export type FaceExpression = keyof typeof FACE_CELLS;
export const FACE_EXPRESSIONS = Object.keys(FACE_CELLS) as FaceExpression[];

// loads the sheet pre-configured for cell sampling; calls back exactly once
// (null if the sheet is missing — callers keep the flat-color face)
export function loadFaceTexture(onReady: (t: THREE.Texture | null) => void): void {
	new THREE.TextureLoader().load(
		FACE_SHEET_URL,
		(t) => {
			t.colorSpace = THREE.SRGBColorSpace;
			t.flipY = false; // glTF UV convention (v=0 = top of image)
			t.repeat.set(1 / GRID, 1 / GRID);
			t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
			onReady(t);
		},
		undefined,
		() => onReady(null),
	);
}

export type FaceController = {
	// base expression shown when nothing else is active
	set: (e: FaceExpression) => void;
	// temporary expression (e.g. during an animation clip)
	pulse: (e: FaceExpression, seconds: number) => void;
	setTalking: (on: boolean) => void;
	setBlinking: (on: boolean) => void;
	// artwork size relative to the head: >1 samples a smaller centered window
	// of the cell, so the features render bigger on the face plane
	setScale: (sc: number) => void;
	// vertical placement on the head, in cell fractions: positive samples a
	// lower window of the cell, which renders the features HIGHER on the head
	setOffsetY: (dy: number) => void;
	// drive from the render loop
	update: (t: number) => void;
};

export function createFaceController(tex: THREE.Texture, scale = 1, offsetY = 0): FaceController {
	let base: FaceExpression = "neutral";
	let pulseExpr: FaceExpression | null = null;
	let pulseUntil = 0;
	let pulseSeconds = 0;
	let talking = false;
	let blinking = true;
	let nextBlink = 2 + Math.random() * 3;
	let blinkUntil = -1;
	let current: FaceExpression | null = null;

	// below ~0.9 the sample window spills past the cell's feathered edge into
	// neighboring expressions, so clamp there
	const applyScale = (sc: number) => {
		scale = Math.max(0.9, sc);
		tex.repeat.setScalar(1 / (GRID * scale));
	};
	applyScale(scale);

	const show = (e: FaceExpression) => {
		if (e === current) return;
		current = e;
		const [c, r] = FACE_CELLS[e];
		const cell = 1 / GRID;
		const win = tex.repeat.y;
		const inset = (cell - win) / 2; // centers the zoomed window
		// clamp the window so it never reaches a NEIGHBOR cell's features —
		// past the ~10% feathered margin you'd sample the next expression's
		// artwork (reads as a stripe cutting across the face)
		const bleed = 0.12 * cell + Math.max(0, win - cell) / 2;
		const top = THREE.MathUtils.clamp(
			r * cell + inset + offsetY * cell,
			r * cell - bleed,
			r * cell + cell - win + bleed,
		);
		tex.offset.set(c * cell + inset, top);
	};
	const reshow = () => {
		const e = current;
		current = null; // force show() to re-apply the offset
		if (e) show(e);
	};

	return {
		set: (e) => {
			base = e;
		},
		pulse: (e, seconds) => {
			pulseExpr = e;
			pulseUntil = -1; // armed; resolved against clock time in update()
			pulseSeconds = seconds;
		},
		setTalking: (on) => {
			talking = on;
		},
		setBlinking: (on) => {
			blinking = on;
		},
		setScale: (sc) => {
			applyScale(sc);
			reshow();
		},
		setOffsetY: (dy) => {
			offsetY = dy;
			reshow();
		},
		update: (t) => {
			if (pulseExpr && pulseUntil === -1) pulseUntil = t + pulseSeconds;
			if (pulseExpr && t > pulseUntil) pulseExpr = null;
			// blink scheduling (skipped while talking so the mouth flap reads)
			if (blinking && !talking && t >= nextBlink) {
				blinkUntil = t + 0.13;
				nextBlink = t + 2.5 + Math.random() * 3.5;
				// occasional double blink
				if (Math.random() < 0.25) nextBlink = t + 0.35;
			}
			if (talking) {
				show(Math.floor(t * 8) % 2 === 0 ? "talkOpen" : "talkClosed");
			} else if (t < blinkUntil) {
				show("blink");
			} else {
				show(pulseExpr ?? base);
			}
		},
	};
}
