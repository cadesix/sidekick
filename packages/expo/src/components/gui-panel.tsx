import { useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_BROWSER_PAN } from '../lib/web-style';
import { ColorPickerModal } from './look-controls';

// lil-gui look, rebuilt in RN primitives. The web /sidekick-3d editor docked
// two lil-gui panels — the main "Sidekick 3D" panel top-right and an
// "Equipment" panel top-left — over the live scene. These components reproduce
// that: narrow dark panels pinned to the screen edges, collapsible folders,
// compact slider / color / toggle / select rows. Colors match lil-gui's default
// dark theme so it reads as the same tool.

// lil-gui default theme tokens
const C = {
  bg: '#1a1a1a', // --background-color
  title: '#111111', // --title-background-color
  widget: '#3c3c3c', // --widget-color (slider track)
  focus: '#595959', // --focus-color
  number: '#2cc9ff', // --number-color
  text: '#ebebeb', // --text-color
  dim: '#bebebe',
  hair: '#1f1f1f',
};

const SCREEN = Dimensions.get('window');
// lil-gui is 245px; cap there on wide (Expo Web) windows but shrink on a phone
// so the two edge panels never overlap.
const PANEL_W = Math.min(245, Math.round(SCREEN.width * 0.46));

export function GuiPanel({
  side,
  title,
  children,
}: {
  side: 'left' | 'right';
  title: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(true);
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side]: 0,
        width: PANEL_W,
        zIndex: 45,
        paddingTop: insets.top,
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          backgroundColor: C.bg,
          maxHeight: '100%',
          borderBottomLeftRadius: side === 'right' ? 0 : 4,
          borderBottomRightRadius: side === 'left' ? 0 : 4,
          overflow: 'hidden',
        }}
      >
        {/* root title bar */}
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={{ backgroundColor: C.title, paddingHorizontal: 10, paddingVertical: 8 }}
        >
          <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>
            {open ? '▾' : '▸'}  {title}
          </Text>
        </Pressable>
        {open ? (
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 8) }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export function GuiFolder({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.hair }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ backgroundColor: C.title, paddingHorizontal: 10, paddingVertical: 6 }}
      >
        <Text style={{ color: C.dim, fontSize: 11, fontWeight: '700' }}>
          {open ? '▾' : '▸'}  {title}
        </Text>
      </Pressable>
      {open ? <View style={{ paddingVertical: 2 }}>{children}</View> : null}
    </View>
  );
}

// row scaffold: label on the left third, control on the right two-thirds
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        gap: 6,
      }}
    >
      <Text style={{ width: '34%', color: C.dim, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

export function GuiSlider({
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
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (
    <Row label={label}>
      <View
        style={[
          { height: 20, backgroundColor: C.widget, borderRadius: 2, justifyContent: 'center', overflow: 'hidden' },
          NO_BROWSER_PAN,
        ]}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => set(e.nativeEvent.locationX)}
        onResponderMove={(e) => set(e.nativeEvent.locationX)}
      >
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, backgroundColor: C.focus }} />
        <Text style={{ color: C.number, fontSize: 11, textAlign: 'right', paddingHorizontal: 6 }}>
          {value.toFixed(value < 10 && value > -10 ? 3 : 2)}
        </Text>
      </View>
    </Row>
  );
}

export function GuiColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <Row label={label}>
      <Pressable
        onPress={() => setEdit(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <View style={{ width: 26, height: 20, borderRadius: 2, backgroundColor: value, borderWidth: 1, borderColor: '#000' }} />
        <Text style={{ color: C.dim, fontSize: 11 }}>{value}</Text>
      </Pressable>
      {edit ? (
        <ColorPickerModal label={label} value={value} onChange={onChange} onClose={() => setEdit(false)} />
      ) : null}
    </Row>
  );
}

export function GuiToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <Pressable
        onPress={() => onChange(!value)}
        style={{
          width: 20,
          height: 20,
          borderRadius: 3,
          backgroundColor: C.widget,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? <Text style={{ color: C.number, fontSize: 13, fontWeight: '900' }}>✓</Text> : null}
      </Pressable>
    </Row>
  );
}

export function GuiSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <Row label={label}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => onChange(o.id)}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 3,
                backgroundColor: on ? C.focus : C.widget,
              }}
            >
              <Text style={{ color: on ? '#fff' : C.dim, fontSize: 11 }}>{o.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </Row>
  );
}
