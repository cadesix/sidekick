import * as THREE from 'three';

// The web app builds its sky gradient with a 2D <canvas> (document.createElement),
// which doesn't exist in React Native. This builds the same vertical gradient
// straight into a DataTexture — pure JS, no DOM.

type Stop = { at: number; color: string };


// Soft elliptical contact-shadow blob (the web drew this with a DOM canvas
// radial gradient: 0 → 0.42 alpha, 0.7 → 0.12, 1 → 0). Ink color fixed at the
// web's warm near-black (30, 24, 16).
export function makeRadialShadowTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - half + 0.5, y - half + 0.5) / (half - 1));
      const a = r < 0.7 ? 0.42 + (0.12 - 0.42) * (r / 0.7) : 0.12 * (1 - (r - 0.7) / 0.3);
      const o = (y * size + x) * 4;
      data[o] = 30;
      data[o + 1] = 24;
      data[o + 2] = 16;
      data[o + 3] = Math.round(Math.max(0, a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Refill an existing gradient texture's pixels in place (live look-dev: no
// realloc/dispose per slider tick — reuploading the same 1×512 texture is
// seamless where swapping textures can flash).
export function fillGradientTexture(tex: THREE.DataTexture, stops: Stop[]): void {
  const height = tex.image.height;
  const data = tex.image.data as Uint8Array;
  // Store sRGB-ENCODED bytes. This texture is tagged SRGBColorSpace, so the GPU
  // sRGB-decodes it at sample time. THREE.Color(hex) holds LINEAR components
  // under color management, so writing those raw got decoded a SECOND time —
  // the sky came out dark and red-shifted (salmon/gold stops crushed toward
  // saturated red). Convert each stop back to sRGB and interpolate in sRGB
  // space, matching the web's 2D-canvas gradient, which also blends raw sRGB.
  const colors = stops.map((s) => {
    const c = new THREE.Color(s.color).convertLinearToSRGB();
    return { at: s.at, r: c.r, g: c.g, b: c.b };
  });
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    // find the surrounding stops
    let lo = colors[0];
    let hi = colors[colors.length - 1];
    for (let i = 0; i < colors.length - 1; i++) {
      if (t >= colors[i].at && t <= colors[i + 1].at) {
        lo = colors[i];
        hi = colors[i + 1];
        break;
      }
    }
    const span = hi.at - lo.at || 1;
    const local = THREE.MathUtils.clamp((t - lo.at) / span, 0, 1);
    const o = y * 4;
    data[o] = Math.round((lo.r + (hi.r - lo.r) * local) * 255);
    data[o + 1] = Math.round((lo.g + (hi.g - lo.g) * local) * 255);
    data[o + 2] = Math.round((lo.b + (hi.b - lo.b) * local) * 255);
    data[o + 3] = 255;
  }
  tex.needsUpdate = true;
}

// Vertical gradient as a (1 x height) sRGB DataTexture. stops are top→bottom.
export function makeGradientTexture(stops: Stop[], height = 512): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(height * 4), 1, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  fillGradientTexture(tex, stops);
  return tex;
}
