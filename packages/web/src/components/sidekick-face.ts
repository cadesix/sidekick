import * as THREE from "three";

// Face sprite system: the GLB's "FaceSprite" plane (a curved disc over the
// face hole, skinned to Head) samples a 4×4 expression sheet. The EYES and
// MOUTH sample independently: the face shader splits the disc at EYES_SPLIT
// (v: 0 = chin, 1 = forehead) and reads each band from its own cell window, so
// a blink only swaps the eye band while the mouth keeps talking, and vice
// versa. The per-texture uniform bundle (faceUniformsFor) is shared by every
// material built for that sheet — the controller writes it, materials read it.
//
// Sheet: public/face-sheet-v6.png, 2048×2048, 4×4 grid of 512px cells, drawn
// in glTF orientation (row 0 = top of image = top of face).

export const FACE_SHEET_URL = "/face-sheet-v6.png?v=1";
export const GRID = 4;
// the eyes/mouth boundary, measured from the TOP of the cell (the mesh's v
// runs downward like the image): eyes live above it, mouth below
export const EYES_SPLIT = 0.46;

// name → [col, row]; keep in sync with the sheet
export const FACE_CELLS = {
	neutral: [0, 0],
	// this sheet's only closed-eye art is [2,0] (the ^_^ frame); [1,0] is an
	// open-eyed raised-brow grin, so blinking there read as "eyes stay open"
	blink: [2, 0],
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

// the shared shader uniforms for one loaded sheet: eye-band window, mouth-band
// window, window size, and the split line. Attached to the texture so every
// material built from it (body modes × routes) reads the same live values.
export type FaceUniforms = {
	uFaceEyesOff: { value: THREE.Vector2 };
	uFaceMouthOff: { value: THREE.Vector2 };
	uFaceRepeat: { value: THREE.Vector2 };
	uFaceSplit: { value: number };
};

export function faceUniformsFor(t: THREE.Texture): FaceUniforms {
	const ud = t.userData as { faceUniforms?: FaceUniforms };
	ud.faceUniforms ??= {
		uFaceEyesOff: { value: new THREE.Vector2(0, 0) },
		uFaceMouthOff: { value: new THREE.Vector2(0, 0) },
		uFaceRepeat: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
		uFaceSplit: { value: EYES_SPLIT },
	};
	return ud.faceUniforms;
}

// loads the sheet pre-configured for cell sampling; calls back exactly once
// (null if the sheet is missing — callers keep the flat-color face)
export function loadFaceTexture(onReady: (t: THREE.Texture | null) => void): void {
	new THREE.TextureLoader().load(
		FACE_SHEET_URL,
		(t) => {
			t.colorSpace = THREE.SRGBColorSpace;
			t.flipY = false; // glTF UV convention (v=0 = top of image)
			// cell windows are computed in the face shader (split sampling), so the
			// texture's own transform stays identity
			t.repeat.set(1, 1);
			t.offset.set(0, 0);
			t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
			// no mipmaps (facesprite-contract.md): the disc's curved rim otherwise
			// samples deep mip levels where neighboring cells blur together
			t.generateMipmaps = false;
			t.minFilter = THREE.LinearFilter;
			faceUniformsFor(t);
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
	// manual per-band overrides (the /action-composer drives these); null follows the base
	setEyesOverride: (e: FaceExpression | null) => void;
	setMouthOverride: (e: FaceExpression | null) => void;
	// artwork size relative to the head: >1 samples a smaller centered window
	setScale: (sc: number) => void;
	// vertical placement on the head, in cell fractions
	setOffsetY: (dy: number) => void;
	// what each band is currently showing (for inspector UIs)
	getState: () => { eyes: FaceExpression; mouth: FaceExpression };
	// drive from the render loop
	update: (t: number) => void;
};

export function createFaceController(tex: THREE.Texture, scale = 1, offsetY = 0): FaceController {
	const u = faceUniformsFor(tex);
	let base: FaceExpression = "neutral";
	let pulseExpr: FaceExpression | null = null;
	let pulseUntil = 0;
	let pulseSeconds = 0;
	let talking = false;
	let blinking = true;
	let eyesOverride: FaceExpression | null = null;
	let mouthOverride: FaceExpression | null = null;
	let nextBlink = 2 + Math.random() * 3;
	let blinkUntil = -1;
	let curEyes: FaceExpression = "neutral";
	let curMouth: FaceExpression = "neutral";
	let dirty = true;

	// below ~0.9 the sample window spills past the cell into neighboring
	// expressions, so clamp there
	const applyScale = (sc: number) => {
		scale = Math.max(0.9, sc);
		u.uFaceRepeat.value.setScalar(1 / (GRID * scale));
		dirty = true;
	};
	applyScale(scale);

	const writeOffset = (e: FaceExpression, out: THREE.Vector2) => {
		const [c, r] = FACE_CELLS[e];
		const cell = 1 / GRID;
		const win = u.uFaceRepeat.value.y; // 1/(GRID*zoom); < cell when zoomed in
		const inset = (cell - win) / 2; // center the zoomed window in the cell
		out.set(c * cell + inset, r * cell + inset + offsetY * cell);
	};
	const apply = (eyes: FaceExpression, mouth: FaceExpression) => {
		if (eyes !== curEyes || dirty) writeOffset(eyes, u.uFaceEyesOff.value);
		if (mouth !== curMouth || dirty) writeOffset(mouth, u.uFaceMouthOff.value);
		curEyes = eyes;
		curMouth = mouth;
		dirty = false;
	};
	apply("neutral", "neutral");

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
		setEyesOverride: (e) => {
			eyesOverride = e;
		},
		setMouthOverride: (e) => {
			mouthOverride = e;
		},
		setScale: (sc) => {
			applyScale(sc);
		},
		setOffsetY: (dy) => {
			offsetY = dy;
			dirty = true;
		},
		getState: () => ({ eyes: curEyes, mouth: curMouth }),
		update: (t) => {
			if (pulseExpr && pulseUntil === -1) pulseUntil = t + pulseSeconds;
			if (pulseExpr && t > pulseUntil) pulseExpr = null;
			// blink scheduling — eyes-only now, so it runs even while talking
			if (blinking && t >= nextBlink) {
				blinkUntil = t + 0.13;
				nextBlink = t + 2.5 + Math.random() * 3.5;
				// occasional double blink
				if (Math.random() < 0.25) nextBlink = t + 0.35;
			}
			const expr = pulseExpr ?? base;
			// mouth: manual override > talk flaps > expression
			const mouth = mouthOverride ?? (talking ? (Math.floor(t * 8) % 2 === 0 ? "talkOpen" : "talkClosed") : expr);
			// eyes: manual override > blink window > expression
			const eyes = eyesOverride ?? (blinking && t < blinkUntil ? "blink" : expr);
			apply(eyes, mouth);
		},
	};
}
