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

const BOB_INA  = { x: [0.4, 0.4, 0.4], y: [1, 1, 1] };
const BOB_OUTA = { x: [0.6, 0.6, 0.6], y: [0, 0, 0] };

// Bob (vertical bounce) is intentionally NOT animated in Lottie — it lives
// as a CSS animation on the wrapper so emotion changes (which rebuild this
// animation) don't reset the bob phase. Positions use the "low" y value.
const bobY = (yLow: number, _yHigh: number) => ({ a: 0, k: [200, yLow, 0] });
const bobXY = (x: number, yLow: number, _yHigh: number) => ({ a: 0, k: [x, yLow, 0] });
const breathe = (lo: number, hi: number) => ({
  a: 1, k: [
    { t: 0,  s: [lo, lo, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 45, s: [hi, hi, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 90, s: [lo, lo, 100] },
  ],
});
// Same as `breathe` but applies a squish bias — width grows while height
// shrinks by `squish` percent. Used for sad/bored/sleepy droop.
const breatheSquish = (lo: number, hi: number, squish: number) => ({
  a: 1, k: [
    { t: 0,  s: [lo + squish, lo - squish, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 45, s: [hi + squish, hi - squish, 100], i: BOB_INA, o: BOB_OUTA },
    { t: 90, s: [lo + squish, lo - squish, 100] },
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
// Eyes nearly closed (sleepy / bored / relieved).
const halfLid = () => ({ a: 0, k: [100, 18, 100] });
// Static opacity loop — pulses between two values.
const pulseOpacity = (lo: number, hi: number) => ({
  a: 1, k: [
    { t: 0,  s: [lo], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
    { t: 45, s: [hi], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
    { t: 90, s: [lo] },
  ],
});
// Vertical drift — `dy` total over the loop (positive = down).
const driftY = (x: number, y0: number, dy: number) => ({
  a: 1, k: [
    { t: 0,  s: [x, y0, 0],       i: BOB_INA, o: BOB_OUTA },
    { t: 90, s: [x, y0 + dy, 0] },
  ],
});

const ellipseLayer = (
  ind: number, name: string, color: RGB, size: [number, number],
  position: any, scale: any = { a: 0, k: [100, 100, 100] }, opacity: any = 100,
  rotation = 0,
) => ({
  ddd: 0, ind, ty: 4, nm: name, sr: 1,
  ks: {
    o: typeof opacity === 'number' ? { a: 0, k: opacity } : opacity,
    r: { a: 0, k: rotation },
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

// Rounded-rectangle layer. Used for brows, ZZZ stripes, exclamation marks,
// flat-line mouths, confetti chips.
const rectLayer = (
  ind: number, name: string, color: RGB, size: [number, number],
  position: any, rotation = 0, opacity: any = 100, radius = 4,
) => ({
  ddd: 0, ind, ty: 4, nm: name, sr: 1,
  ks: {
    o: typeof opacity === 'number' ? { a: 0, k: opacity } : opacity,
    r: typeof rotation === 'number' ? { a: 0, k: rotation } : rotation,
    p: position,
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  },
  shapes: [{
    ty: 'gr', it: [
      { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: size }, r: { a: 0, k: radius } },
      { ty: 'fl', c: { a: 0, k: [...color, 1] }, o: { a: 0, k: 100 } },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ],
  }],
  ip: 0, op: 90, st: 0, bm: 0,
});

export type Emotion =
  // Original 15.
  | 'idle' | 'happy' | 'surprised' | 'thinking' | 'love'
  | 'sad' | 'sleepy' | 'angry' | 'excited' | 'shy'
  | 'cool' | 'wink' | 'confused' | 'proud' | 'sick'
  // Wave 2 (12).
  | 'celebrating' | 'working' | 'nervous' | 'frustrated'
  | 'curious' | 'smug' | 'bored' | 'determined'
  | 'mischievous' | 'relieved' | 'shocked' | 'embarrassed'
  // Wave 3 (12). Noto faces fall back to `default` when no codepoint is
  // mapped — the buddy family renders them all natively.
  | 'eureka' | 'laughing' | 'crying' | 'dizzy'
  | 'evil' | 'peaceful' | 'hopeful' | 'disappointed'
  | 'suspicious' | 'panicked' | 'awestruck' | 'flirty';

// A `noto` avatar family is a named group of Noto Animated Emoji where the
// rendered codepoint changes with the buddy's current emotion. Each group
// has a fallback `default` and an `emotions` map of per-emotion overrides.
export type NotoGroup = 'faces' | 'cats' | 'animals' | 'food';

type NotoGroupConfig = {
  label: string;
  /** Codepoint used for the swatch in the family picker. */
  preview: string;
  default: string;
  emotions: Partial<Record<Emotion, string>>;
};

export const NOTO_GROUPS: Record<NotoGroup, NotoGroupConfig> = {
  faces: {
    label: 'Faces',
    preview: '1f600',
    default: '1f642',
    emotions: {
      idle:        '1f642',
      happy:       '1f600',
      surprised:   '1f62e',
      thinking:    '1f914',
      love:        '1f60d',
      sad:         '1f622',
      sleepy:      '1f634',
      angry:       '1f620',
      excited:     '1f929',
      shy:         '1f60a',
      cool:        '1f60e',
      wink:        '1f609',
      confused:    '1f615',
      proud:       '1f60c',
      sick:        '1f912',
      celebrating: '1f973',
      working:     '1f9d0',
      nervous:     '1f628',
      frustrated:  '1f624',
      curious:     '1f9d0',
      smug:        '1f60f',
      bored:       '1f971',
      determined:  '1f624',
      mischievous: '1f608',
      relieved:    '1f60c',
      shocked:     '1f631',
      embarrassed: '1f633',
      // Wave 3
      eureka:       '1f4a1',
      laughing:     '1f602',
      crying:       '1f62d',
      dizzy:        '1f635',
      evil:         '1f608',
      peaceful:     '1f60c',
      hopeful:      '1f970',
      disappointed: '1f61e',
      suspicious:   '1f928',
      panicked:     '1f630',
      awestruck:    '1f929',
      flirty:       '1f60f',
    },
  },
  cats: {
    label: 'Cats',
    preview: '1f63a',
    default: '1f431',
    emotions: {
      idle:      '1f431',
      happy:     '1f63a',
      surprised: '1f640',
      love:      '1f63b',
      sad:       '1f63f',
      angry:     '1f63e',
      excited:   '1f63c',
      shy:       '1f63d',
      wink:      '1f63d',
      confused:  '1f640',
      sleepy:    '1f640',
      sick:      '1f640',
    },
  },
  animals: {
    label: 'Animals',
    preview: '1f436',
    default: '1f436',
    emotions: {
      idle:      '1f436',
      happy:     '1f981',
      surprised: '1f435',
      thinking:  '1f98a',
      love:      '1f43c',
      sad:       '1f43c',
      sleepy:    '1f428',
      angry:     '1f981',
      excited:   '1f435',
      shy:       '1f43c',
      cool:      '1f981',
      proud:     '1f981',
      sick:      '1f428',
    },
  },
  food: {
    label: 'Food',
    preview: '1f354',
    default: '1f354',
    emotions: {
      idle:      '1f354',
      happy:     '1f355',
      surprised: '1f370',
      thinking:  '1f36b',
      love:      '1f370',
      sad:       '1f368',
      sleepy:    '1f367',
      angry:     '1f336',
      excited:   '1f389',
      cool:      '1f366',
      sick:      '1f922',
      proud:     '1f382',
    },
  },
};

export function getNotoCodepoint(group: NotoGroup, emotion: Emotion): string {
  const g = NOTO_GROUPS[group];
  return g.emotions[emotion] ?? g.default;
}

type AccessoryKind =
  | 'tearDrop' | 'sweatDrop' | 'heart' | 'sparkles'
  | 'zzz' | 'questionMark' | 'exclamation'
  | 'steamPuff' | 'confetti' | 'dotDotDot'
  | 'lightbulb' | 'tearStream' | 'swirl';

type EmotionConfig = {
  mouth: [number, number];
  eye: [number, number];
  mouthY: [number, number];
  eyeR?: [number, number];
  eyeL?: [number, number];

  // Optional channels — all default to "off / neutral".
  /** Brow rotation in degrees and Y-lift (positive = lower / closer to eyes). */
  brow?: { tilt: number; lift: number; tiltL?: number; tiltR?: number };
  /** Pupil offset within each eye (px). */
  pupil?: { dx: number; dy: number; size?: number };
  /** Color shift on the body. */
  bodyTint?: 'flush' | 'pale' | null;
  /** Vertical squish in scale-percent units. Positive = wider/shorter. */
  bodySquish?: number;
  /** Mouth render style. Defaults to ellipse. */
  mouthShape?: 'ellipse' | 'smirk' | 'flatLine' | 'open' | 'frown' | 'tongue';
  /** One decoration above/around the head. */
  accessory?: AccessoryKind;
  /** Force-half-lid the eyes (sleepy/bored/relieved). */
  halfLid?: boolean;
  /** Force cheeks to render even on variants without a cheek color. */
  forceCheeks?: 'flush' | 'embarrassed';
};

const EMOTIONS: Record<Emotion, EmotionConfig> = {
  // — Original 15, mostly preserved, lightly enriched —
  idle:      { mouth: [44, 18], eye: [22, 30], mouthY: [235, 219] },
  happy:     { mouth: [64, 26], eye: [22, 10], mouthY: [232, 216], mouthShape: 'open' },
  surprised: { mouth: [26, 26], eye: [28, 34], mouthY: [240, 224], pupil: { dx: 0, dy: 0, size: 6 } },
  thinking:  { mouth: [22, 8],  eye: [22, 22], mouthY: [238, 222],
               brow: { tilt: 0, lift: 0, tiltL: -14, tiltR: 0 },
               pupil: { dx: 5, dy: -4 },
               accessory: 'questionMark' },
  love:      { mouth: [54, 24], eye: [18, 8],  mouthY: [232, 216], accessory: 'heart' },
  sad:       { mouth: [22, 10], eye: [20, 18], mouthY: [250, 234],
               brow: { tilt: 12, lift: -4 }, bodySquish: 12, accessory: 'tearDrop' },
  sleepy:    { mouth: [22, 10], eye: [26, 4],  mouthY: [240, 224],
               halfLid: true, bodySquish: 8, accessory: 'zzz' },
  angry:     { mouth: [22, 6],  eye: [28, 6],  mouthY: [242, 226],
               brow: { tilt: -22, lift: 6 }, accessory: 'steamPuff' },
  excited:   { mouth: [56, 32], eye: [28, 32], mouthY: [230, 214],
               mouthShape: 'open', accessory: 'sparkles' },
  shy:       { mouth: [16, 6],  eye: [18, 14], mouthY: [242, 226],
               pupil: { dx: 0, dy: 4 }, bodyTint: 'flush', forceCheeks: 'flush' },
  cool:      { mouth: [50, 18], eye: [24, 10], mouthY: [232, 216],
               brow: { tilt: -6, lift: 0 }, mouthShape: 'smirk' },
  wink:      { mouth: [54, 22], eye: [22, 12], eyeR: [22, 4], mouthY: [232, 216] },
  confused:  { mouth: [22, 10], eye: [22, 18], eyeL: [22, 26], eyeR: [20, 14], mouthY: [238, 222],
               brow: { tilt: 0, lift: 0, tiltL: 18, tiltR: -10 } },
  proud:     { mouth: [48, 22], eye: [22, 8],  mouthY: [230, 214],
               brow: { tilt: -8, lift: -4 }, mouthShape: 'smirk' },
  sick:      { mouth: [18, 14], eye: [20, 14], mouthY: [244, 228],
               bodyTint: 'pale', accessory: 'sweatDrop' },

  // — New 12 —
  celebrating: { mouth: [70, 32], eye: [22, 8], mouthY: [228, 212],
                 mouthShape: 'open', accessory: 'confetti' },
  working:     { mouth: [22, 10], eye: [22, 24], mouthY: [236, 220],
                 brow: { tilt: -4, lift: -2 }, accessory: 'dotDotDot' },
  nervous:     { mouth: [28, 8],  eye: [22, 22], mouthY: [240, 224],
                 brow: { tilt: 8,  lift: -2 }, accessory: 'sweatDrop' },
  frustrated:  { mouth: [30, 8],  eye: [26, 14], mouthY: [244, 228],
                 brow: { tilt: -28, lift: 8 }, mouthShape: 'flatLine',
                 accessory: 'steamPuff' },
  curious:     { mouth: [22, 16], eye: [24, 26], mouthY: [236, 220],
                 brow: { tilt: 0, lift: -6, tiltL: -16, tiltR: -2 },
                 pupil: { dx: -4, dy: -3 }, accessory: 'questionMark' },
  smug:        { mouth: [38, 16], eye: [22, 8], eyeR: [22, 4], mouthY: [232, 216],
                 brow: { tilt: 0, lift: -2, tiltL: -8, tiltR: -16 },
                 mouthShape: 'smirk' },
  bored:       { mouth: [30, 6],  eye: [26, 6],  mouthY: [240, 224],
                 halfLid: true, bodySquish: 10, mouthShape: 'flatLine',
                 brow: { tilt: 0, lift: -2 } },
  determined:  { mouth: [34, 8],  eye: [24, 14], mouthY: [240, 224],
                 brow: { tilt: -18, lift: 6 }, mouthShape: 'flatLine' },
  mischievous: { mouth: [42, 18], eye: [22, 12], mouthY: [232, 216],
                 brow: { tilt: 0, lift: -2, tiltL: -4, tiltR: -18 },
                 pupil: { dx: 6, dy: 0 }, mouthShape: 'smirk' },
  relieved:    { mouth: [40, 14], eye: [22, 10], mouthY: [232, 216],
                 halfLid: true, brow: { tilt: 6, lift: -6 }, mouthShape: 'smirk' },
  shocked:     { mouth: [40, 40], eye: [32, 38], mouthY: [240, 224],
                 mouthShape: 'open', pupil: { dx: 0, dy: 0, size: 5 },
                 brow: { tilt: 0, lift: -10 }, accessory: 'exclamation' },
  embarrassed: { mouth: [22, 8],  eye: [18, 14], mouthY: [242, 226],
                 pupil: { dx: -6, dy: 2 }, bodyTint: 'flush',
                 forceCheeks: 'embarrassed' },

  // — Wave 3 —
  eureka:       { mouth: [40, 28], eye: [26, 30], mouthY: [232, 216],
                  mouthShape: 'open', brow: { tilt: 0, lift: -8 },
                  pupil: { dx: 0, dy: -4, size: 8 }, accessory: 'lightbulb' },
  laughing:     { mouth: [70, 36], eye: [22, 6], mouthY: [228, 212],
                  halfLid: true, mouthShape: 'open',
                  brow: { tilt: 6, lift: -4 }, accessory: 'tearStream' },
  crying:       { mouth: [28, 12], eye: [20, 14], mouthY: [248, 232],
                  brow: { tilt: 14, lift: -2 }, mouthShape: 'frown',
                  accessory: 'tearStream' },
  dizzy:        { mouth: [22, 14], eye: [22, 22], mouthY: [240, 224],
                  pupil: { dx: 0, dy: 0, size: 6 }, mouthShape: 'smirk',
                  accessory: 'swirl' },
  evil:         { mouth: [44, 18], eye: [22, 10], mouthY: [232, 216],
                  brow: { tilt: -24, lift: 6 },
                  pupil: { dx: 5, dy: -2 }, mouthShape: 'smirk',
                  bodyTint: 'pale' },
  peaceful:     { mouth: [34, 12], eye: [22, 6], mouthY: [232, 216],
                  halfLid: true, brow: { tilt: 4, lift: -6 },
                  mouthShape: 'smirk', bodySquish: 4 },
  hopeful:      { mouth: [30, 20], eye: [24, 28], mouthY: [232, 216],
                  brow: { tilt: 0, lift: -8 }, pupil: { dx: 0, dy: -6 },
                  mouthShape: 'open', accessory: 'sparkles' },
  disappointed: { mouth: [26, 8], eye: [22, 10], mouthY: [248, 232],
                  halfLid: true, brow: { tilt: 6, lift: 0 },
                  mouthShape: 'frown' },
  suspicious:   { mouth: [22, 8], eye: [22, 8], eyeR: [22, 14], eyeL: [22, 6],
                  mouthY: [240, 224],
                  brow: { tilt: 0, lift: 2, tiltL: -4, tiltR: -22 },
                  pupil: { dx: -5, dy: 0 }, mouthShape: 'flatLine' },
  panicked:     { mouth: [40, 32], eye: [30, 36], mouthY: [240, 224],
                  pupil: { dx: 0, dy: 0, size: 5 },
                  brow: { tilt: 0, lift: -8 }, mouthShape: 'open',
                  accessory: 'sweatDrop' },
  awestruck:    { mouth: [38, 30], eye: [30, 34], mouthY: [232, 216],
                  brow: { tilt: 0, lift: -8 }, mouthShape: 'open',
                  accessory: 'sparkles' },
  flirty:       { mouth: [44, 18], eye: [22, 12], eyeR: [22, 4], mouthY: [232, 216],
                  brow: { tilt: 0, lift: -2, tiltL: -2, tiltR: -16 },
                  mouthShape: 'smirk', accessory: 'heart' },
};

// Blend a body color toward a target by `t` (0..1).
const tint = (c: RGB, target: RGB, t: number): RGB =>
  [c[0] + (target[0] - c[0]) * t, c[1] + (target[1] - c[1]) * t, c[2] + (target[2] - c[2]) * t];

const FLUSH_TARGET: RGB = [1.0, 0.55, 0.62];
const PALE_TARGET:  RGB = [0.78, 0.82, 0.78];
const TEAR_BLUE:    RGB = [0.42, 0.72, 0.96];
const HEART_PINK:   RGB = [0.98, 0.40, 0.58];
const STEAM_GREY:   RGB = [0.78, 0.80, 0.82];
const SPARKLE_GOLD: RGB = [1.00, 0.86, 0.40];
const CONFETTI_PALETTE: RGB[] = [
  [0.95, 0.42, 0.62], [0.32, 0.80, 0.68], [0.99, 0.66, 0.54],
  [0.55, 0.36, 0.96], [0.99, 0.81, 0.30], [0.42, 0.72, 0.96],
];

// Build the layers for a given accessory. Returns a list because most
// accessories use multiple shapes (e.g. confetti = 6 chips).
function accessoryLayers(kind: AccessoryKind, indStart: number, bodyColor: RGB): any[] {
  const layers: any[] = [];
  let ind = indStart;
  switch (kind) {
    case 'tearDrop':
      layers.push(ellipseLayer(ind++, 'tear', TEAR_BLUE, [12, 18],
        driftY(170, 210, 18), { a: 0, k: [100, 100, 100] }, pulseOpacity(60, 100)));
      break;
    case 'sweatDrop':
      layers.push(ellipseLayer(ind++, 'sweat', TEAR_BLUE, [14, 22],
        driftY(252, 156, 22), { a: 0, k: [100, 100, 100] }, pulseOpacity(70, 100)));
      break;
    case 'heart': {
      // Cheap heart: two small ellipses side-by-side as the lobes, one
      // square rotated 45° for the bottom point. Pulses opacity.
      layers.push(ellipseLayer(ind++, 'heartL', HEART_PINK, [22, 22],
        { a: 0, k: [188, 92, 0] }, breathe(95, 115)));
      layers.push(ellipseLayer(ind++, 'heartR', HEART_PINK, [22, 22],
        { a: 0, k: [212, 92, 0] }, breathe(95, 115)));
      layers.push(rectLayer(ind++, 'heartTip', HEART_PINK, [22, 22],
        { a: 0, k: [200, 108, 0] }, 45, 100, 2));
      break;
    }
    case 'sparkles':
      // Four little gold "+" sparkles around the head, twinkling.
      layers.push(rectLayer(ind++, 'spk1', SPARKLE_GOLD, [4, 16],
        { a: 0, k: [128, 130, 0] }, 0, pulseOpacity(40, 100), 2));
      layers.push(rectLayer(ind++, 'spk1b', SPARKLE_GOLD, [16, 4],
        { a: 0, k: [128, 130, 0] }, 0, pulseOpacity(40, 100), 2));
      layers.push(rectLayer(ind++, 'spk2', SPARKLE_GOLD, [3, 12],
        { a: 0, k: [272, 96, 0] }, 0, pulseOpacity(100, 30), 2));
      layers.push(rectLayer(ind++, 'spk2b', SPARKLE_GOLD, [12, 3],
        { a: 0, k: [272, 96, 0] }, 0, pulseOpacity(100, 30), 2));
      layers.push(rectLayer(ind++, 'spk3', SPARKLE_GOLD, [3, 10],
        { a: 0, k: [88, 220, 0] }, 0, pulseOpacity(60, 100), 2));
      layers.push(rectLayer(ind++, 'spk3b', SPARKLE_GOLD, [10, 3],
        { a: 0, k: [88, 220, 0] }, 0, pulseOpacity(60, 100), 2));
      break;
    case 'zzz':
      // Three small rotated stripes climbing diagonally up-right.
      layers.push(rectLayer(ind++, 'zzz1', [1, 1, 1], [22, 4],
        driftY(258, 110, -10), -20, pulseOpacity(40, 100), 1));
      layers.push(rectLayer(ind++, 'zzz2', [1, 1, 1], [18, 3.5],
        driftY(280, 80, -10), -20, pulseOpacity(20, 90), 1));
      layers.push(rectLayer(ind++, 'zzz3', [1, 1, 1], [14, 3],
        driftY(300, 56, -8), -20, pulseOpacity(0, 75), 1));
      break;
    case 'questionMark':
      // Hook (small ellipse) + dot underneath. Hovers above head.
      layers.push(ellipseLayer(ind++, 'qHook', [1, 1, 1], [16, 18],
        { a: 0, k: [275, 92, 0] }));
      layers.push(ellipseLayer(ind++, 'qHookHole', bodyColor, [8, 10],
        { a: 0, k: [273, 88, 0] }));
      layers.push(rectLayer(ind++, 'qStem', [1, 1, 1], [4, 8],
        { a: 0, k: [277, 108, 0] }, 0, 100, 1));
      layers.push(ellipseLayer(ind++, 'qDot', [1, 1, 1], [6, 6],
        { a: 0, k: [277, 122, 0] }));
      break;
    case 'exclamation':
      layers.push(rectLayer(ind++, 'excStem', [1, 1, 1], [6, 26],
        { a: 0, k: [200, 96, 0] }, 0, 100, 2));
      layers.push(ellipseLayer(ind++, 'excDot', [1, 1, 1], [8, 8],
        { a: 0, k: [200, 116, 0] }));
      break;
    case 'steamPuff':
      layers.push(ellipseLayer(ind++, 'steam1', STEAM_GREY, [26, 22],
        driftY(260, 110, -16), { a: 0, k: [100, 100, 100] }, pulseOpacity(40, 90)));
      layers.push(ellipseLayer(ind++, 'steam2', STEAM_GREY, [22, 18],
        driftY(140, 130, -14), { a: 0, k: [100, 100, 100] }, pulseOpacity(80, 30)));
      layers.push(ellipseLayer(ind++, 'steam3', STEAM_GREY, [18, 14],
        driftY(290, 80, -10), { a: 0, k: [100, 100, 100] }, pulseOpacity(20, 80)));
      break;
    case 'confetti': {
      // Six chips falling and twirling.
      const slots: { x: number; y0: number; rot: number }[] = [
        { x: 110, y0: 60,  rot: 12 },
        { x: 150, y0: 30,  rot: -22 },
        { x: 200, y0: 50,  rot: 0 },
        { x: 250, y0: 28,  rot: 18 },
        { x: 295, y0: 64,  rot: -12 },
        { x: 330, y0: 110, rot: 30 },
      ];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const color = CONFETTI_PALETTE[i % CONFETTI_PALETTE.length];
        layers.push(rectLayer(ind++, `conf${i}`, color, [10, 6],
          driftY(s.x, s.y0, 24), s.rot, pulseOpacity(70, 100), 1));
      }
      break;
    }
    case 'dotDotDot':
      // Three small dots near the mouth, cycling brightness.
      layers.push(ellipseLayer(ind++, 'dot1', [1, 1, 1], [8, 8],
        { a: 0, k: [170, 285, 0] }, { a: 0, k: [100, 100, 100] }, pulseOpacity(20, 100)));
      layers.push(ellipseLayer(ind++, 'dot2', [1, 1, 1], [8, 8],
        { a: 0, k: [200, 285, 0] }, { a: 0, k: [100, 100, 100] }, pulseOpacity(60, 100)));
      layers.push(ellipseLayer(ind++, 'dot3', [1, 1, 1], [8, 8],
        { a: 0, k: [230, 285, 0] }, { a: 0, k: [100, 100, 100] }, pulseOpacity(100, 20)));
      break;
    case 'lightbulb': {
      // Yellow bulb + small grey screw base above head, glow-pulses.
      const bulbYellow: RGB = [1.00, 0.90, 0.30];
      const bulbBase:   RGB = [0.55, 0.55, 0.58];
      layers.push(ellipseLayer(ind++, 'bulbGlow', bulbYellow, [44, 44],
        { a: 0, k: [200, 88, 0] }, { a: 0, k: [100, 100, 100] }, pulseOpacity(20, 70)));
      layers.push(ellipseLayer(ind++, 'bulb', bulbYellow, [30, 32],
        { a: 0, k: [200, 86, 0] }, { a: 0, k: [100, 100, 100] }, 100));
      layers.push(rectLayer(ind++, 'bulbBase', bulbBase, [16, 8],
        { a: 0, k: [200, 106, 0] }, 0, 100, 1));
      layers.push(rectLayer(ind++, 'bulbBase2', bulbBase, [12, 4],
        { a: 0, k: [200, 114, 0] }, 0, 100, 1));
      // Tiny shine highlight on the bulb.
      layers.push(ellipseLayer(ind++, 'bulbShine', [1, 1, 1], [8, 6],
        { a: 0, k: [192, 80, 0] }, { a: 0, k: [100, 100, 100] }, 80));
      break;
    }
    case 'tearStream':
      // Two tears each side, falling continuously (heavier than `tearDrop`).
      layers.push(ellipseLayer(ind++, 'tsR1', TEAR_BLUE, [12, 18],
        driftY(228, 200, 60), { a: 0, k: [100, 100, 100] }, pulseOpacity(60, 100)));
      layers.push(ellipseLayer(ind++, 'tsR2', TEAR_BLUE, [10, 14],
        driftY(232, 230, 60), { a: 0, k: [100, 100, 100] }, pulseOpacity(100, 30)));
      layers.push(ellipseLayer(ind++, 'tsL1', TEAR_BLUE, [12, 18],
        driftY(172, 200, 60), { a: 0, k: [100, 100, 100] }, pulseOpacity(100, 60)));
      layers.push(ellipseLayer(ind++, 'tsL2', TEAR_BLUE, [10, 14],
        driftY(168, 230, 60), { a: 0, k: [100, 100, 100] }, pulseOpacity(30, 100)));
      break;
    case 'swirl': {
      // Three little dark dots orbiting above the head — classic dizzy.
      const swirl = (ind: number, name: string, phase: number, radius: number, size: number): any => ({
        ddd: 0, ind, ty: 4, nm: name, sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 1, k: [
            { t: 0,  s: [phase],         i: BOB_INA, o: BOB_OUTA },
            { t: 90, s: [phase + 360] },
          ]},
          p: { a: 0, k: [200, 88, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [{
          ty: 'gr', it: [
            { ty: 'el', p: { a: 0, k: [radius, 0] }, s: { a: 0, k: [size, size] } },
            { ty: 'fl', c: { a: 0, k: [0.15, 0.15, 0.18, 1] }, o: { a: 0, k: 100 } },
            { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        }],
        ip: 0, op: 90, st: 0, bm: 0,
      });
      layers.push(swirl(ind++, 'swirl1', 0,   28, 10));
      layers.push(swirl(ind++, 'swirl2', 120, 28, 8));
      layers.push(swirl(ind++, 'swirl3', 240, 28, 6));
      break;
    }
  }
  return layers;
}

export function buildAnimation(v: AvatarVariant, emotion: Emotion = 'idle') {
  const e = EMOTIONS[emotion] ?? EMOTIONS.idle;
  const layers: any[] = [];
  let ind = 1;

  // Body color with optional emotion-driven tint.
  const bodyColor: RGB =
    e.bodyTint === 'flush' ? tint(v.body, FLUSH_TARGET, 0.25)
    : e.bodyTint === 'pale' ? tint(v.body, PALE_TARGET, 0.35)
    : v.body;

  // Z-order recap: layers pushed FIRST render ON TOP. So the front-to-back
  // walk is: accessories → brows → pupils → eyes/mouth → cheeks → highlight
  // → body → aura.

  // 1. Accessories on top of everything (other than antenna which we keep
  //    where it is).
  if (e.accessory) {
    for (const L of accessoryLayers(e.accessory, ind, bodyColor)) {
      layers.push(L);
      ind++;
    }
  }

  // 2. Antenna (variant feature, sits above head).
  if (v.antenna) {
    layers.push(ellipseLayer(ind++, 'antennaDot', bodyColor, [22, 22], bobXY(200, 110, 94)));
    layers.push(ellipseLayer(ind++, 'antennaStem', bodyColor, [6, 28], bobXY(200, 132, 116)));
  }

  // 3. Mouth — pick a shape variant.
  const mouthShape = e.mouthShape ?? 'ellipse';
  if (mouthShape === 'flatLine') {
    layers.push(rectLayer(ind++, 'mouth', [0.1, 0.1, 0.1],
      [Math.max(e.mouth[0], 28), Math.max(e.mouth[1], 4)],
      bobY(e.mouthY[0], e.mouthY[1]), 0, 100, 3));
  } else if (mouthShape === 'smirk') {
    // Off-center small ellipse, slightly rotated up on one side.
    layers.push(ellipseLayer(ind++, 'mouth', [0.1, 0.1, 0.1],
      [Math.max(e.mouth[0], 26), Math.max(e.mouth[1], 10)],
      { a: 0, k: [212, e.mouthY[0], 0] }, undefined, 100, -8));
  } else if (mouthShape === 'open') {
    // Big black ellipse + small white "tongue" highlight.
    layers.push(ellipseLayer(ind++, 'mouthOpen', [0.08, 0.08, 0.08],
      [Math.max(e.mouth[0], 30), Math.max(e.mouth[1], 22)],
      bobY(e.mouthY[0], e.mouthY[1])));
    layers.push(ellipseLayer(ind++, 'mouthShine', [1, 1, 1],
      [10, 6], bobY(e.mouthY[0] - 4, e.mouthY[1] - 4), undefined, 70));
  } else if (mouthShape === 'frown') {
    // Cover-up trick: a body-color ellipse sits ON TOP of the dark mouth
    // ellipse, hiding its upper half so the visible portion reads as a
    // downward arc. Push the eraser FIRST (it's higher in z-order).
    const mw = Math.max(e.mouth[0], 30);
    const mh = Math.max(e.mouth[1], 14);
    layers.push(ellipseLayer(ind++, 'mouthErase', bodyColor, [mw + 4, mh + 4],
      bobY(e.mouthY[0] - mh / 2 - 1, e.mouthY[1] - mh / 2 - 1)));
    layers.push(ellipseLayer(ind++, 'mouthFrown', [0.05, 0.05, 0.05],
      [mw, mh], bobY(e.mouthY[0], e.mouthY[1])));
  } else if (mouthShape === 'tongue') {
    // Small open mouth with a pink tongue blob below.
    const tonguePink: RGB = [0.95, 0.45, 0.55];
    layers.push(ellipseLayer(ind++, 'tongue', tonguePink, [16, 10],
      bobY(e.mouthY[0] + 6, e.mouthY[1] + 6)));
    layers.push(ellipseLayer(ind++, 'mouthOpen', [0.08, 0.08, 0.08],
      [Math.max(e.mouth[0], 26), Math.max(e.mouth[1], 16)],
      bobY(e.mouthY[0], e.mouthY[1])));
  } else {
    // Default ellipse (current behavior).
    layers.push(ellipseLayer(ind++, 'mouth', [0.05, 0.05, 0.05],
      e.mouth, bobY(e.mouthY[0], e.mouthY[1])));
  }

  // 4. Pupils (rendered above eyes by being pushed first).
  if (e.pupil) {
    const ps = e.pupil.size ?? 8;
    const pupilColor: RGB = [0.05, 0.05, 0.08];
    layers.push(ellipseLayer(ind++, 'pupilR', pupilColor, [ps, ps],
      bobXY(225 + e.pupil.dx, 195 + e.pupil.dy, 179 + e.pupil.dy)));
    layers.push(ellipseLayer(ind++, 'pupilL', pupilColor, [ps, ps],
      bobXY(175 + e.pupil.dx, 195 + e.pupil.dy, 179 + e.pupil.dy)));
  }

  // 5. Eyes. Half-lid emotions skip the blink loop.
  const eyeScale = e.halfLid ? halfLid() : blink();
  layers.push(ellipseLayer(ind++, 'eyeR', [1, 1, 1], e.eyeR ?? e.eye, bobXY(225, 195, 179), eyeScale));
  layers.push(ellipseLayer(ind++, 'eyeL', [1, 1, 1], e.eyeL ?? e.eye, bobXY(175, 195, 179), eyeScale));

  // 6. Brows above the eyes.
  if (e.brow) {
    const tiltL = e.brow.tiltL ?? e.brow.tilt;
    const tiltR = e.brow.tiltR ?? e.brow.tilt;
    const browY = 168 + e.brow.lift;
    const browColor: RGB = [0.08, 0.08, 0.08];
    layers.push(rectLayer(ind++, 'browR', browColor, [30, 6],
      { a: 0, k: [225, browY, 0] }, tiltR, 100, 3));
    layers.push(rectLayer(ind++, 'browL', browColor, [30, 6],
      { a: 0, k: [175, browY, 0] }, tiltL, 100, 3));
  }

  // 7. Cheeks. Variant cheeks render normally; emotions like shy/embarrassed
  //    can force-render a flush blush even on variants without `cheek`.
  const renderCheek = v.cheek ?? (e.forceCheeks ? FLUSH_TARGET : null);
  if (renderCheek) {
    const op = e.forceCheeks === 'embarrassed' ? 90 : 70;
    layers.push(ellipseLayer(ind++, 'cheekR', renderCheek, [22, 14], bobXY(248, 218, 202), undefined, op));
    layers.push(ellipseLayer(ind++, 'cheekL', renderCheek, [22, 14], bobXY(152, 218, 202), undefined, op));
  }

  // 8. Body highlight + body + aura.
  layers.push(ellipseLayer(ind++, 'highlight', [1, 1, 1], [50, 36], bobXY(165, 168, 152), undefined, 60));
  const bodyScale = e.bodySquish ? breatheSquish(100, 106, e.bodySquish) : breathe(100, 106);
  layers.push(ellipseLayer(ind++, 'body', bodyColor, [180, 180], bobY(208, 192), bodyScale));

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
        { ty: 'fl', c: { a: 0, k: [...bodyColor, 1] }, o: { a: 0, k: 100 } },
        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ],
    }],
    ip: 0, op: 90, st: 0, bm: 0,
  });

  return {
    v: '5.7.0', fr: 30, ip: 0, op: 90, w: 400, h: 400,
    nm: `buddy-${v.id}-${emotion}`, ddd: 0, assets: [], layers,
  };
}

export const cssColor = (rgb: RGB) =>
  `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
