type RGB = [number, number, number];

export type AvatarVariant = {
  id: string;
  name: string;
  body: RGB;
  cheek?: RGB;
  antenna?: boolean;
};

export const VARIANTS: AvatarVariant[] = [
  { id: 'violet',   name: 'Violet',   body: [0.55, 0.36, 0.96] },
  { id: 'mint',     name: 'Mint',     body: [0.32, 0.80, 0.68], cheek: [0.95, 0.50, 0.62] },
  { id: 'peach',    name: 'Peach',    body: [0.99, 0.66, 0.54], cheek: [0.92, 0.32, 0.44] },
  { id: 'midnight', name: 'Midnight', body: [0.32, 0.36, 0.74], antenna: true },
  { id: 'sunshine', name: 'Sunshine', body: [0.99, 0.81, 0.30], antenna: true },
  { id: 'rose',     name: 'Rose',     body: [0.95, 0.42, 0.62], cheek: [0.99, 0.85, 0.90] },
];

const BOB_IN  = { x: 0.4, y: 1 };
const BOB_OUT = { x: 0.6, y: 0 };
const BOB_INA  = { x: [0.4, 0.4, 0.4], y: [1, 1, 1] };
const BOB_OUTA = { x: [0.6, 0.6, 0.6], y: [0, 0, 0] };

const bobY = (yLow: number, yHigh: number) => ({
  a: 1, k: [
    { t: 0,  s: [200, yLow,  0], i: BOB_IN, o: BOB_OUT },
    { t: 45, s: [200, yHigh, 0], i: BOB_IN, o: BOB_OUT },
    { t: 90, s: [200, yLow,  0] },
  ],
});
const bobXY = (x: number, yLow: number, yHigh: number) => ({
  a: 1, k: [
    { t: 0,  s: [x, yLow,  0], i: BOB_IN, o: BOB_OUT },
    { t: 45, s: [x, yHigh, 0], i: BOB_IN, o: BOB_OUT },
    { t: 90, s: [x, yLow,  0] },
  ],
});
const breathe = (lo: number, hi: number) => ({
  a: 1, k: [
    { t: 0,  s: [lo, lo, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 45, s: [hi, hi, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 90, s: [lo, lo, 100] },
  ],
});
const blink = () => ({
  a: 1, k: [
    { t: 0,  s: [100, 100, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 60, s: [100, 100, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 64, s: [100,  12, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 68, s: [100, 100, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 90, s: [100, 100, 100] },
  ],
});

const ellipseLayer = (
  ind: number, name: string, color: RGB, size: [number, number],
  position: any, scale: any = { a: 0, k: [100, 100, 100] }, opacity = 100
) => ({
  ddd: 0, ind, ty: 4, nm: name, sr: 1,
  ks: {
    o: { a: 0, k: opacity },
    r: { a: 0, k: 0 },
    p: position,
    a: { a: 0, k: [0, 0, 0] },
    s: scale,
  },
  shapes: [{
    ty: 'gr', it: [
      { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: size } },
      { ty: 'fl', c: { a: 0, k: [...color, 1] }, o: { a: 0, k: 100 } },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ],
  }],
  ip: 0, op: 90, st: 0, bm: 0,
});

export type Emotion =
  | 'idle' | 'happy' | 'surprised' | 'thinking' | 'love'
  | 'sad' | 'sleepy' | 'angry' | 'excited' | 'shy'
  | 'cool' | 'wink' | 'confused' | 'proud' | 'sick';

type EmotionConfig = {
  mouth: [number, number];
  eye: [number, number];
  mouthY: [number, number];
  /** Optional per-eye override (defaults to `eye`). */
  eyeR?: [number, number];
  eyeL?: [number, number];
};

const EMOTIONS: Record<Emotion, EmotionConfig> = {
  idle:      { mouth: [44, 18], eye: [22, 30], mouthY: [235, 219] },
  happy:     { mouth: [64, 26], eye: [22, 10], mouthY: [232, 216] },
  surprised: { mouth: [26, 26], eye: [28, 34], mouthY: [240, 224] },
  thinking:  { mouth: [22, 8],  eye: [22, 22], mouthY: [238, 222] },
  love:      { mouth: [54, 24], eye: [18, 8],  mouthY: [232, 216] },
  sad:       { mouth: [22, 10], eye: [20, 18], mouthY: [250, 234] },
  sleepy:    { mouth: [22, 10], eye: [26, 4],  mouthY: [240, 224] },
  angry:     { mouth: [22, 6],  eye: [28, 6],  mouthY: [242, 226] },
  excited:   { mouth: [56, 32], eye: [28, 32], mouthY: [230, 214] },
  shy:       { mouth: [16, 6],  eye: [18, 14], mouthY: [242, 226] },
  cool:      { mouth: [50, 18], eye: [24, 10], mouthY: [232, 216] },
  wink:      { mouth: [54, 22], eye: [22, 12], eyeR: [22, 4], mouthY: [232, 216] },
  confused:  { mouth: [22, 10], eye: [22, 18], eyeL: [22, 26], eyeR: [20, 14], mouthY: [238, 222] },
  proud:     { mouth: [48, 22], eye: [22, 8],  mouthY: [230, 214] },
  sick:      { mouth: [18, 14], eye: [20, 14], mouthY: [244, 228] },
};

export function buildAnimation(v: AvatarVariant, emotion: Emotion = 'idle') {
  const e = EMOTIONS[emotion];
  const layers: any[] = [];
  let ind = 1;

  if (v.antenna) {
    layers.push(ellipseLayer(ind++, 'antennaDot', v.body, [22, 22], bobXY(200, 110, 94)));
    layers.push(ellipseLayer(ind++, 'antennaStem', v.body, [6, 28], bobXY(200, 132, 116)));
  }

  layers.push(ellipseLayer(ind++, 'mouth', [1, 1, 1], e.mouth, bobY(e.mouthY[0], e.mouthY[1])));
  layers.push(ellipseLayer(ind++, 'eyeR', [1, 1, 1], e.eyeR ?? e.eye, bobXY(225, 195, 179), blink()));
  layers.push(ellipseLayer(ind++, 'eyeL', [1, 1, 1], e.eyeL ?? e.eye, bobXY(175, 195, 179), blink()));

  if (v.cheek) {
    layers.push(ellipseLayer(ind++, 'cheekR', v.cheek, [22, 14], bobXY(248, 218, 202), undefined, 70));
    layers.push(ellipseLayer(ind++, 'cheekL', v.cheek, [22, 14], bobXY(152, 218, 202), undefined, 70));
  }

  layers.push(ellipseLayer(ind++, 'highlight', [1, 1, 1], [50, 36], bobXY(165, 168, 152), undefined, 60));
  layers.push(ellipseLayer(ind++, 'body', v.body, [180, 180], bobY(208, 192), breathe(100, 106)));

  layers.push({
    ddd: 0, ind: ind++, ty: 4, nm: 'aura', sr: 1,
    ks: {
      o: { a: 1, k: [
        { t: 0,  s: [35], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
        { t: 45, s: [8],  i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
        { t: 90, s: [35] },
      ]},
      r: { a: 0, k: 0 },
      p: { a: 0, k: [200, 200, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: breathe(80, 125),
    },
    shapes: [{
      ty: 'gr', it: [
        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [260, 260] } },
        { ty: 'fl', c: { a: 0, k: [...v.body, 1] }, o: { a: 0, k: 100 } },
        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ],
    }],
    ip: 0, op: 90, st: 0, bm: 0,
  });

  return {
    v: '5.7.0', fr: 30, ip: 0, op: 90, w: 400, h: 400,
    nm: `buddy-${v.id}`, ddd: 0, assets: [], layers,
  };
}

export const cssColor = (rgb: RGB) =>
  `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
