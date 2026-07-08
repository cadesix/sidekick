import * as THREE from "three";

// Poke/drag interaction layer for the Sidekick character. Owns the pointer
// events on the canvas and runs damped springs so every reaction is soft and
// wobbly rather than snapped:
//  - drag a hand   → the arm follows the pointer and stretches (vinyl-toy
//                    style), then springs back to the idle pose on release
//  - drag his body → he leans/shifts with the pointer (anchored at the feet)
//                    and wobbles back upright when let go
//  - drag the sky/grass → springy camera orbit that snaps back to the saved
//                    framing (only where the route has no OrbitControls)
//  - tap anything  → he looks at the tapped point; tapping HIM also triggers
//                    a part-specific reaction (face pulse + a physical kick)
// The module only computes numbers; each route applies them in its own
// animate() on top of idle/clip animation, so clips and pokes compose.

export type PokePart = "head" | "handL" | "handR" | "body" | "ground";

export type ArmPull = { swing: number; fwd: number; stretch: number };
export type LegPull = { lift: number; curl: number };

// everything a route needs to apply per frame (object reused — don't retain)
export type InteractionFrame = {
	headPitch: number;
	headYaw: number;
	armL: ArmPull;
	armR: ArmPull;
	legL: LegPull;
	legR: LegPull;
	// spine-chain bend (world X/Z) — routes split it across Waist + Spine01 so
	// the body ARCS toward the grab point instead of tilting as one plank
	bendX: number;
	bendZ: number;
	bodyX: number;
	bodyZ: number;
	tiltX: number;
	tiltZ: number;
	squash: number; // vertical scale multiplier, ~1
	camYaw: number;
	camPitch: number;
	dragging: PokePart | null;
};

// damped spring toward `target`; under-damped on purpose so releases overshoot
class Spring {
	x = 0;
	v = 0;
	target = 0;
	constructor(
		private k: number,
		private c: number,
	) {}
	update(dt: number): number {
		this.v += (-this.k * (this.x - this.target) - this.c * this.v) * dt;
		this.x += this.v * dt;
		return this.x;
	}
	kick(v: number): void {
		this.v += v;
	}
}

const TAP_MAX_NDC = 0.02; // pointer travel below this counts as a tap
const TAP_MAX_MS = 350;
const HAND_RADIUS = 0.14; // character is normalized to 1 unit tall

export function createInteraction(opts: {
	dom: HTMLElement;
	camera: THREE.Camera;
	// raycast targets (body + face mesh once the GLB is in)
	targets: () => THREE.Object3D[];
	bone: (n: "head" | "handL" | "handR") => THREE.Object3D | undefined;
	cameraDrag?: boolean;
	onPoke?: (part: PokePart, point: THREE.Vector3) => void;
	// character-drag began/ended (the viewer pauses OrbitControls with this)
	onDragChange?: (dragging: boolean) => void;
}): { update(t: number): InteractionFrame; dispose(): void } {
	const { dom, camera } = opts;

	const headPitch = new Spring(90, 12);
	const headYaw = new Spring(90, 12);
	const arm = {
		L: { swing: new Spring(140, 9), fwd: new Spring(140, 10), stretch: new Spring(160, 10) },
		R: { swing: new Spring(140, 9), fwd: new Spring(140, 10), stretch: new Spring(160, 10) },
	};
	const bodyX = new Spring(130, 9);
	const bodyZ = new Spring(130, 9);
	const tiltX = new Spring(130, 8);
	const tiltZ = new Spring(130, 8);
	const bendX = new Spring(120, 9);
	const bendZ = new Spring(120, 9);
	const legL = new Spring(110, 7);
	const legR = new Spring(110, 7);
	const squash = new Spring(110, 6);
	const camYaw = new Spring(70, 7);
	const camPitch = new Spring(70, 7);

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const hover = new THREE.Vector2(); // last pointer pos, drag or not
	const lookPoint = new THREE.Vector3();
	let lookHoldUntil = -1; // taps hold his gaze on the point for a beat
	const plane = new THREE.Plane();
	const camDir = new THREE.Vector3();
	const boneWorld = new THREE.Vector3();
	const headWorld = new THREE.Vector3();
	const lookDir = new THREE.Vector3();

	let drag: { part: PokePart; id: number; x0: number; y0: number; t0: number; moved: boolean; grabH: number } | null =
		null;
	let now = 0;
	let last = -1;

	const toNdc = (e: PointerEvent, out: THREE.Vector2) => {
		const r = dom.getBoundingClientRect();
		out.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
	};

	// world point under the pointer, on the camera-facing plane through him
	const pointerPoint = (out: THREE.Vector3): THREE.Vector3 => {
		raycaster.setFromCamera(ndc, camera);
		camera.getWorldDirection(camDir);
		plane.setFromNormalAndCoplanarPoint(camDir, out.set(0, 0.6, 0));
		return raycaster.ray.intersectPlane(plane, out) ?? out.copy(raycaster.ray.at(3, out));
	};

	const classify = (): { part: PokePart; grabH: number } => {
		raycaster.setFromCamera(ndc, camera);
		const hits = raycaster.intersectObjects(opts.targets(), false);
		if (!hits.length) return { part: "ground", grabH: 0 };
		const p = hits[0].point;
		// grab height as a fraction of him (feet 0 → crown 1) — a pull anchors
		// where you're actually holding: high grabs bend him, low grabs slide him
		const grabH = THREE.MathUtils.clamp(p.y, 0, 1);
		for (const side of ["handL", "handR"] as const) {
			const b = opts.bone(side);
			if (b && p.distanceTo(b.getWorldPosition(boneWorld)) < HAND_RADIUS) return { part: side, grabH };
		}
		const head = opts.bone("head");
		if (head && p.y > head.getWorldPosition(boneWorld).y - 0.05) return { part: "head", grabH };
		return { part: "body", grabH };
	};

	const onDown = (e: PointerEvent) => {
		if (drag) return;
		toNdc(e, ndc);
		hover.copy(ndc);
		const { part, grabH } = classify();
		drag = { part, id: e.pointerId, x0: ndc.x, y0: ndc.y, t0: performance.now(), moved: false, grabH };
		if (part === "ground" && !opts.cameraDrag) return; // look-at tap only
		dom.setPointerCapture(e.pointerId);
		if (part !== "ground") opts.onDragChange?.(true);
	};

	const onMove = (e: PointerEvent) => {
		toNdc(e, ndc);
		hover.copy(ndc);
		if (!drag || e.pointerId !== drag.id) return;
		const dx = ndc.x - drag.x0;
		const dy = ndc.y - drag.y0;
		const dist = Math.hypot(dx, dy);
		if (dist > TAP_MAX_NDC) drag.moved = true;
		const clamp = THREE.MathUtils.clamp;
		if (drag.part === "handL" || drag.part === "handR") {
			// vertical pull raises/lowers the arm (mirrored per side), horizontal
			// pull swings it outward/inward; distance stretches the whole limb
			const side = drag.part === "handL" ? 1 : -1;
			const a = arm[drag.part === "handL" ? "L" : "R"];
			a.swing.target = clamp(1.7 * dy * side + 1.3 * dx, -1.5, 1.5);
			a.fwd.target = -0.45 * Math.min(0.6, dist); // eases toward the camera
			a.stretch.target = clamp(0.55 * dist, 0, 0.38);
		} else if (drag.part === "body" || drag.part === "head") {
			// the pull anchors at the grab point: grabbing high mostly BENDS the
			// spine chain toward the pointer (the top leads, feet stay planted),
			// grabbing low mostly slides him; a small whole-body tilt on top
			const gh = drag.grabH;
			const wBend = 0.3 + 1.1 * gh;
			const wSlide = 1.15 - 0.8 * gh;
			bendZ.target = clamp(-1.05 * dx * wBend, -0.55, 0.55);
			bendX.target = clamp(-0.85 * dy * wBend, -0.42, 0.42);
			tiltZ.target = clamp(-0.22 * dx, -0.14, 0.14);
			tiltX.target = clamp(-0.18 * dy, -0.1, 0.1);
			bodyX.target = clamp(0.32 * dx * wSlide, -0.22, 0.22);
			// pulling up stretches him taller, pushing down squashes
			squash.target = clamp(0.3 * dy * gh, -0.12, 0.22);
			// secondary motion: arms swing after the yank (pull-side arm rises,
			// far arm counterweights), like being tugged rather than posed
			arm.L.swing.target = clamp(0.85 * dy + 0.7 * dx, -1.1, 1.1);
			arm.R.swing.target = clamp(-0.85 * dy + 0.7 * dx, -1.1, 1.1);
			// off balance: past a small lean the trailing leg lifts off the ground
			const lift = Math.min(0.55, Math.max(0, Math.abs(dx) - 0.04) * 2.4);
			legL.target = dx < 0 ? lift : 0; // his left leg = screen right
			legR.target = dx > 0 ? -lift : 0;
		} else if (opts.cameraDrag) {
			camYaw.target = clamp(-1.3 * dx, -0.5, 0.5);
			camPitch.target = clamp(dy, -0.28, 0.28);
		}
	};

	const release = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		const wasTap = !drag.moved && performance.now() - drag.t0 < TAP_MAX_MS;
		const part = drag.part;
		if (part !== "ground") opts.onDragChange?.(false);
		drag = null;
		// all drag targets home to zero — the springs do the bounce-back
		for (const s of [arm.L, arm.R]) {
			s.swing.target = 0;
			s.fwd.target = 0;
			s.stretch.target = 0;
		}
		tiltX.target = tiltZ.target = bodyX.target = bodyZ.target = squash.target = 0;
		bendX.target = bendZ.target = legL.target = legR.target = 0;
		camYaw.target = camPitch.target = 0;
		if (!wasTap) return;
		// tap: look at the point, and poked parts react physically
		toNdc(e, ndc);
		pointerPoint(lookPoint);
		lookHoldUntil = now + 2.2;
		if (part === "body") squash.kick(1.1);
		if (part === "head") {
			headPitch.kick(-2.2); // little startled head-bob
			squash.kick(0.5);
		}
		if (part === "handL") arm.L.swing.kick(5);
		if (part === "handR") arm.R.swing.kick(-5);
		opts.onPoke?.(part, lookPoint);
	};

	dom.style.touchAction = "none";
	dom.addEventListener("pointerdown", onDown);
	dom.addEventListener("pointermove", onMove);
	dom.addEventListener("pointerup", release);
	dom.addEventListener("pointercancel", release);

	const frame: InteractionFrame = {
		headPitch: 0,
		headYaw: 0,
		armL: { swing: 0, fwd: 0, stretch: 0 },
		armR: { swing: 0, fwd: 0, stretch: 0 },
		legL: { lift: 0, curl: 0 },
		legR: { lift: 0, curl: 0 },
		bendX: 0,
		bendZ: 0,
		bodyX: 0,
		bodyZ: 0,
		tiltX: 0,
		tiltZ: 0,
		squash: 1,
		camYaw: 0,
		camPitch: 0,
		dragging: null,
	};

	return {
		update(t: number): InteractionFrame {
			now = t;
			const dt = last < 0 ? 0.016 : Math.min(t - last, 0.05);
			last = t;

			// gaze: a tapped point holds his eyes for a beat, otherwise he
			// tracks the pointer (same feel as before, but spring-smoothed)
			const head = opts.bone("head");
			if (t < lookHoldUntil && head) {
				head.getWorldPosition(headWorld);
				lookDir.copy(lookPoint).sub(headWorld);
				const horiz = Math.hypot(lookDir.x, lookDir.z);
				headYaw.target = THREE.MathUtils.clamp(Math.atan2(lookDir.x, lookDir.z), -0.7, 0.7);
				headPitch.target = THREE.MathUtils.clamp(-Math.atan2(lookDir.y, horiz), -0.45, 0.45);
			} else {
				headYaw.target = hover.x * 0.45;
				headPitch.target = -hover.y * 0.22;
			}

			frame.headPitch = headPitch.update(dt);
			frame.headYaw = headYaw.update(dt);
			for (const [key, s] of [
				[frame.armL, arm.L],
				[frame.armR, arm.R],
			] as const) {
				key.swing = s.swing.update(dt);
				key.fwd = s.fwd.update(dt);
				key.stretch = Math.max(-0.2, s.stretch.update(dt));
			}
			frame.bodyX = bodyX.update(dt);
			frame.bodyZ = bodyZ.update(dt);
			frame.tiltX = tiltX.update(dt);
			frame.tiltZ = tiltZ.update(dt);
			frame.bendX = bendX.update(dt);
			frame.bendZ = bendZ.update(dt);
			frame.legL.lift = legL.update(dt);
			frame.legR.lift = legR.update(dt);
			// a lifted leg dangles: the knee curls back with the lift
			frame.legL.curl = -0.75 * Math.abs(frame.legL.lift);
			frame.legR.curl = -0.75 * Math.abs(frame.legR.lift);
			frame.squash = Math.max(0.6, 1 + squash.update(dt));
			frame.camYaw = camYaw.update(dt);
			frame.camPitch = camPitch.update(dt);
			frame.dragging = drag && drag.part !== "ground" ? drag.part : null;
			return frame;
		},
		dispose() {
			dom.removeEventListener("pointerdown", onDown);
			dom.removeEventListener("pointermove", onMove);
			dom.removeEventListener("pointerup", release);
			dom.removeEventListener("pointercancel", release);
		},
	};
}

// face pulse per poked part, shared by both routes
export const POKE_FACE = {
	head: "happy",
	body: "surprised",
	handL: "excited",
	handR: "excited",
	ground: null,
} as const;
