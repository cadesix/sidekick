import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FACE_CELLS, type FaceExpression } from '~/three/face';

// Dev tool: lay out face-sheet-v7.png as its 3×3 grid so we can tap each cell and
// check every expression reads correctly. The cells are drawn on a transparent
// background (they composite onto the yellow head), so the backdrop toggle
// previews them over head-yellow / white / dark. Mapping comes straight from
// FACE_CELLS in three/face.ts, so this view stays honest as that table changes.

const SHEET = require('../../assets/textures/face-sheet-v7.png');
const GRID = 3;
const HEAD_YELLOW = '#f2b13c';

type Backdrop = { key: string; label: string; color: string; ink: string };
const BACKDROPS: Backdrop[] = [
  { key: 'head', label: 'Head', color: HEAD_YELLOW, ink: '#1a1205' },
  { key: 'white', label: 'White', color: '#ffffff', ink: '#111' },
  { key: 'dark', label: 'Dark', color: '#1a1a1e', ink: '#eee' },
];

// Invert FACE_CELLS into a [col][row] lookup — a cell can carry >1 name (blink and
// happy share the top-middle cell), and some may be empty.
function buildGrid(): FaceExpression[][][] {
  const grid: FaceExpression[][][] = Array.from({ length: GRID }, () =>
    Array.from({ length: GRID }, () => [] as FaceExpression[]),
  );
  for (const name of Object.keys(FACE_CELLS) as FaceExpression[]) {
    const [c, r] = FACE_CELLS[name];
    if (c >= 0 && c < GRID && r >= 0 && r < GRID) grid[c][r].push(name);
  }
  return grid;
}

/** One cropped cell of the sheet, over the chosen backdrop. */
function CellImage({ col, row, size, bg }: { col: number; row: number; size: number; bg: string }) {
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', backgroundColor: bg }}>
      <Image
        source={SHEET}
        style={{
          position: 'absolute',
          width: size * GRID,
          height: size * GRID,
          left: -col * size,
          top: -row * size,
        }}
      />
    </View>
  );
}

export default function FaceSheetRoute() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const grid = useMemo(buildGrid, []);

  const [backdropKey, setBackdropKey] = useState('head');
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const backdrop = BACKDROPS.find((b) => b.key === backdropKey) ?? BACKDROPS[0];

  const stats = useMemo(() => {
    let filled = 0;
    let dupes = 0;
    for (let c = 0; c < GRID; c++)
      for (let r = 0; r < GRID; r++) {
        const n = grid[c][r].length;
        if (n > 0) filled++;
        if (n > 1) dupes++;
      }
    return { filled, empty: GRID * GRID - filled, dupes, names: Object.keys(FACE_CELLS).length };
  }, [grid]);

  const [selCol, selRow] = sel;
  const selNames = grid[selCol][selRow];

  // Grid sizing: keep it square within the screen width, gutter between cells.
  const pad = 16;
  const gap = 6;
  const gridW = Math.min(width, 520) - pad * 2;
  const cellSize = (gridW - gap * (GRID - 1)) / GRID;
  const previewSize = Math.min(gridW, 260);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
      {/* header */}
      <View className="flex-row items-center px-2 h-12">
        <Pressable
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center"
        >
          <ChevronLeft size={26} color="#111" />
        </Pressable>
        <Text className="text-[17px] font-semibold text-ink">Face sheet</Text>
        <View className="flex-1" />
        <Text className="text-[12px] text-ink/40 pr-3">
          {stats.filled} filled · {stats.empty} empty{stats.dupes ? ` · ${stats.dupes} dup` : ''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: pad, paddingBottom: insets.bottom + 32, alignItems: 'center' }}>
        {/* large preview of the selected cell */}
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#0001' }}>
          <CellImage col={selCol} row={selRow} size={previewSize} bg={backdrop.color} />
        </View>
        <View className="h-3" />
        <Text className="text-[15px] font-semibold text-ink">
          {selNames.length ? selNames.join(' · ') : 'unmapped'}
        </Text>
        <Text className="text-[12px] text-ink/40 mt-0.5">
          cell [{selCol}, {selRow}]{selNames.length > 1 ? '  ·  ⚠ aliased' : ''}
        </Text>

        {/* backdrop toggle */}
        <View className="flex-row gap-2 mt-4 mb-5">
          {BACKDROPS.map((b) => {
            const on = b.key === backdropKey;
            return (
              <Pressable
                key={b.key}
                onPress={() => setBackdropKey(b.key)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: on ? '#111' : '#0000000d',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#fff' : '#111' }}>
                  {b.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* the 3×3 grid */}
        <View style={{ width: gridW }}>
          {Array.from({ length: GRID }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap, marginBottom: r < GRID - 1 ? gap : 0 }}>
              {Array.from({ length: GRID }, (_, c) => {
                const names = grid[c][r];
                const on = c === selCol && r === selRow;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setSel([c, r])}
                    style={{
                      width: cellSize,
                      borderRadius: 10,
                      overflow: 'hidden',
                      borderWidth: on ? 2 : 1,
                      borderColor: on ? '#2cc9ff' : '#0000001a',
                    }}
                  >
                    <CellImage col={c} row={r} size={cellSize - (on ? 4 : 2)} bg={backdrop.color} />
                    <View
                      style={{
                        paddingHorizontal: 4,
                        paddingVertical: 3,
                        backgroundColor: names.length ? '#0000000a' : '#0000',
                        minHeight: 20,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 10,
                          textAlign: 'center',
                          color: names.length ? '#111' : '#0003',
                          fontWeight: names.length > 1 ? '700' : '500',
                        }}
                      >
                        {names.length ? (names.length > 1 ? `⚠ ${names.join('/')}` : names[0]) : '—'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
