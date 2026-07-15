import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_BROWSER_PAN } from '../lib/web-style';

// Shared look-dev controls used by both the compact SettingsSheet and the full
// /sidekick-3d editor route: a dependency-free slider, a color row that opens a
// lil-gui-style HSV picker in a bottom-anchored modal, and a section header.
// Kept in one place so the two editors can never drift.

// ---- section header -----------------------------------------------------------

export function Section({ label }: { label: string }) {
  return (
    <Text className="pt-3 pb-0.5 text-[12px] font-bold uppercase tracking-wide text-neutral-400">
      {label}
    </Text>
  );
}

// ---- dependency-free slider (responder-driven) ------------------------------

export function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const width = useRef(1);
  const set = (x: number) => {
    const f = Math.min(1, Math.max(0, x / width.current));
    onChange(Math.round((min + f * (max - min)) * 1000) / 1000);
  };
  const frac = (value - min) / (max - min);
  return (
    <View className="flex-row items-center" style={{ gap: 10 }}>
      <Text className="w-[86px] text-[13px] text-neutral-600">{label}</Text>
      <View
        className="flex-1 justify-center"
        style={[{ height: 36 }, NO_BROWSER_PAN]}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => set(e.nativeEvent.locationX)}
        onResponderMove={(e) => set(e.nativeEvent.locationX)}
      >
        <View className="h-1.5 rounded-full bg-neutral-200" />
        <View
          className="absolute h-1.5 rounded-full bg-neutral-900"
          style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }}
        />
        <View
          className="absolute h-5 w-5 rounded-full bg-white"
          style={{
            left: `${Math.min(97, Math.max(0, frac * 97))}%`,
            borderWidth: 1.5,
            borderColor: '#171717',
          }}
        />
      </View>
      <Text className="w-[44px] text-right text-[12px] text-neutral-400">{value.toFixed(2)}</Text>
    </View>
  );
}

// ---- color row → modal picker -------------------------------------------------
// The picker opens in a bottom-anchored MODAL: a big drag surface that can't
// fight the settings ScrollView for the gesture, with the scene still visible
// above it.

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [openEditor, setOpenEditor] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpenEditor(true)}
        className="flex-row items-center"
        style={{ gap: 10, paddingVertical: 3 }}
      >
        <Text className="w-[86px] text-[13px] text-neutral-600">{label}</Text>
        <View
          className="h-7 w-12 rounded-md"
          style={{ backgroundColor: value, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }}
        />
        <Text className="text-[12px] text-neutral-400">{value}</Text>
        <Ionicons name="chevron-forward" size={14} color="#a3a3a3" style={{ marginLeft: 'auto' }} />
      </Pressable>
      {openEditor ? (
        <ColorPickerModal
          label={label}
          value={value}
          onChange={onChange}
          onClose={() => setOpenEditor(false)}
        />
      ) : null}
    </View>
  );
}

const STRIPS = 28;
const HUES = 30;

export function ColorPickerModal({
  label,
  value,
  onChange,
  onClose,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // full local HSV while the picker is open — hue survives when the dot sits
  // at white/black/grey (where hex loses hue information)
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [h, sat, val] = hsv;
  const current = hsvToHex(h, sat, val);
  const set = (nh: number, ns: number, nv: number) => {
    setHsv([nh, ns, nv]);
    onChange(hsvToHex(nh, ns, nv));
  };

  const sq = useRef({ w: 1, h: 1 });
  const setFromSquare = (x: number, y: number) => {
    const ns = Math.min(100, Math.max(0, (x / sq.current.w) * 100));
    const nv = Math.min(100, Math.max(0, 100 - (y / sq.current.h) * 100));
    set(h, ns, nv);
  };
  const hueW = useRef(1);
  const setFromHue = (x: number) => {
    set(Math.min(359.9, Math.max(0, (x / hueW.current) * 360)), sat, val);
  };

  const [r, g, b] = hexToRgb(current);
  const setChannel = (idx: number, text: string) => {
    const n = Math.min(255, Math.max(0, parseInt(text, 10) || 0));
    const rgb: [number, number, number] = [r, g, b];
    rgb[idx] = n;
    const hex = rgbToHex(...rgb);
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      {/* transparent backdrop: the live scene stays visible; tap outside closes */}
      <Pressable style={{ flex: 1 }} onPress={onClose} />
      <View
        className="bg-white px-5 pt-4"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          paddingBottom: Math.max(insets.bottom, 16),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.25,
          shadowRadius: 24,
          elevation: 16,
        }}
      >
        <View className="flex-row items-center justify-between pb-3">
          <Text className="text-[17px] font-bold text-neutral-900">{label}</Text>
          <Pressable
            onPress={onClose}
            className="h-9 px-4 rounded-full bg-neutral-900 items-center justify-center"
          >
            <Text className="text-[14px] font-semibold text-white">Done</Text>
          </Pressable>
        </View>

        {/* saturation / value square — big, and it owns the gesture entirely */}
        <View
          style={{ height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: hsvToHex(h, 100, 100) }}
          onLayout={(e) => (sq.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 })}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => setFromSquare(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          onResponderMove={(e) => setFromSquare(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        >
          {Array.from({ length: STRIPS }, (_, i) => (
            <View
              key={`w${i}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(i / STRIPS) * 100}%`,
                width: `${100 / STRIPS + 0.5}%`,
                backgroundColor: '#ffffff',
                opacity: 1 - (i + 0.5) / STRIPS,
              }}
            />
          ))}
          {Array.from({ length: STRIPS }, (_, i) => (
            <View
              key={`b${i}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${(i / STRIPS) * 100}%`,
                height: `${100 / STRIPS + 0.5}%`,
                backgroundColor: '#000000',
                opacity: (i + 0.5) / STRIPS,
              }}
            />
          ))}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${sat}%`,
              top: `${100 - val}%`,
              marginLeft: -11,
              marginTop: -11,
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 3,
              borderColor: '#ffffff',
              backgroundColor: current,
              shadowColor: '#000',
              shadowOpacity: 0.4,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
            }}
          />
        </View>

        {/* swatch + hue strip */}
        <View className="mt-4 flex-row items-center" style={{ gap: 12 }}>
          <View
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: current, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' }}
          />
          <View
            className="flex-1 justify-center"
            style={{ height: 40 }}
            onLayout={(e) => (hueW.current = e.nativeEvent.layout.width || 1)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={(e) => setFromHue(e.nativeEvent.locationX)}
            onResponderMove={(e) => setFromHue(e.nativeEvent.locationX)}
          >
            <View style={{ height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row' }}>
              {Array.from({ length: HUES }, (_, i) => (
                <View key={i} style={{ flex: 1, backgroundColor: hsvToHex((i / HUES) * 360, 100, 100) }} />
              ))}
            </View>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${(h / 360) * 94}%`,
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 3,
                borderColor: '#ffffff',
                backgroundColor: hsvToHex(h, 100, 100),
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
              }}
            />
          </View>
        </View>

        {/* hex + RGB inputs */}
        <View className="mt-3 flex-row items-end" style={{ gap: 8 }}>
          <View className="flex-[1.4] items-center">
            <TextInput
              key={`hex-${current}`}
              defaultValue={current}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onEndEditing={(e) => {
                const t = e.nativeEvent.text.trim().replace(/^#?/, '#');
                if (/^#[0-9a-fA-F]{6}$/.test(t)) {
                  setHsv(hexToHsv(t.toLowerCase()));
                  onChange(t.toLowerCase());
                }
              }}
              className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 text-center text-[15px] text-neutral-900"
            />
            <Text className="mt-0.5 text-[11px] text-neutral-400">HEX</Text>
          </View>
          {([r, g, b] as const).map((c, i) => (
            <View key={i} className="flex-1 items-center">
              <TextInput
                key={`${current}-${i}`}
                defaultValue={String(c)}
                keyboardType="number-pad"
                returnKeyType="done"
                onEndEditing={(e) => setChannel(i, e.nativeEvent.text)}
                className="w-full rounded-lg border border-neutral-200 bg-white py-1.5 text-center text-[15px] text-neutral-900"
              />
              <Text className="mt-0.5 text-[11px] text-neutral-400">{'RGB'[i]}</Text>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

// ---- tiny HSV/RGB <-> hex helpers ---------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const sat = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, sat * 100, v * 100];
}

function hsvToHex(h: number, s: number, v: number): string {
  const sn = s / 100;
  const vn = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return vn - vn * sn * Math.max(0, Math.min(k, Math.min(4 - k, 1)));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}
