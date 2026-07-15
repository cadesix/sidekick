import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
// expo-three patches THREE.TextureLoader to accept an expo Asset and upload it
// through the expo-gl context.
import { loadTextureAsync } from 'expo-three';

// Loading THREE assets in React Native.
//
// GLB: three's GLTFLoader.parse() can't decode embedded images in RN, but our
// GLBs are texture-stripped (scripts/strip-glb.mjs), so we read the file to an
// ArrayBuffer and parse it directly — no fetch(file://) and no image decoding.
//
// Textures (the face sheet) are real bundled PNGs, loaded via expo-three which
// knows how to turn an expo Asset into a GPU texture on expo-gl.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes has no atob; decode base64 → ArrayBuffer by hand.
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((len * 3) / 4) - pad;
  const bytes = new Uint8Array(byteLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (p < byteLength) bytes[p++] = (n >> 16) & 0xff;
    if (p < byteLength) bytes[p++] = (n >> 8) & 0xff;
    if (p < byteLength) bytes[p++] = n & 0xff;
  }
  return bytes.buffer;
}

// Load a bundled .glb (require(...) module) into a parsed GLTF.
export async function loadGLB(moduleRef: number): Promise<GLTF> {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  // Per-platform asset read: on web the uri is an HTTP URL Metro serves, so
  // fetch it directly (expo-file-system has no web implementation); on native
  // there's no fetch(file://), so read the file to base64 → ArrayBuffer.
  const buffer =
    Platform.OS === 'web'
      ? await fetch(uri).then((r) => r.arrayBuffer())
      : base64ToArrayBuffer(await FileSystem.readAsStringAsync(uri, { encoding: 'base64' }));
  const loader = new GLTFLoader();
  return new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });
}

// Load a bundled image (require(...) module) into a THREE.Texture.
export async function loadTexture(moduleRef: number): Promise<THREE.Texture> {
  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  const tex = (await loadTextureAsync({ asset })) as THREE.Texture;
  return tex;
}

// Load a cosmetic variant albedo (glTF UV convention, like the face sheet).
export async function loadItemTexture(moduleRef: number): Promise<THREE.Texture> {
  const tex = await loadTexture(moduleRef);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// De-interleave a GLB-parsed geometry into standalone, tightly-packed attribute
// buffers. GLTFLoader often produces INTERLEAVED attributes (position/normal/uv
// share one strided buffer); expo-gl's bufferData/vertexAttribPointer mishandles
// the stride, so interleaved meshes silently never render (while procedural,
// non-interleaved geometry draws fine). This copies each attribute component by
// component (getX/Y/Z/W) into its own tight Float32Array — the correct fix (a raw
// .slice() of an interleaved array copies the neighbouring attributes' bytes too).
export function deinterleaveGeometry(geo: THREE.BufferGeometry): void {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name] as THREE.BufferAttribute & {
      isInterleavedBufferAttribute?: boolean;
    };
    if (!a.isInterleavedBufferAttribute) continue;
    const { itemSize, count } = a;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      out[i * itemSize] = a.getX(i);
      if (itemSize > 1) out[i * itemSize + 1] = a.getY(i);
      if (itemSize > 2) out[i * itemSize + 2] = a.getZ(i);
      if (itemSize > 3) out[i * itemSize + 3] = a.getW(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, itemSize, a.normalized));
  }
  // The index is a plain (non-interleaved) attribute but may be a byteOffset view
  // into the shared GLB buffer; copy it into a standalone buffer as well.
  if (geo.index) {
    const src = geo.index.array as Uint16Array | Uint32Array;
    const copy = src.slice();
    geo.setIndex(new THREE.BufferAttribute(copy, 1));
  }
}
