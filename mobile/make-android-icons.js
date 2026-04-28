// Rasterize the brand SVGs → Android launcher PNGs + splash images.
// Run after editing any of the source SVGs:
//   node make-android-icons.js
//
// Three sources:
//   build/icon-launcher-foreground.svg  → adaptive-icon foreground (face on
//                                          transparent; the lavender adaptive
//                                          background shows through).
//   build/icon-launcher-legacy.svg      → pre-API-26 ic_launcher{,_round}.png
//                                          (same face baked onto a lavender
//                                          rounded square so non-adaptive
//                                          launchers display the same tile).
//   ../desktop/build/icon.svg           → splash screen (the buddy ball with
//                                          its purple aura, centered on a
//                                          lavender background at every density).
//
// Sharp lives in ../desktop/node_modules so we don't need to add it as a
// dep here — desktop is the canonical icon-tooling project.

const fs = require('fs');
const path = require('path');
const sharp = require('../desktop/node_modules/sharp');

const FG_SVG     = path.join(__dirname, 'build', 'icon-launcher-foreground.svg');
const LEGACY_SVG = path.join(__dirname, 'build', 'icon-launcher-legacy.svg');
const BALL_SVG   = path.join(__dirname, '..', 'desktop', 'build', 'icon.svg');
const RES        = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const SPLASH_BG  = '#EFE5FF';

// Adaptive icon foreground canvas is 108dp; the inner 72dp is the safe
// zone visible in every mask. Square legacy icons render full bleed.
const DENSITIES = {
  mdpi:    { mult: 1,   square: 48 },
  hdpi:    { mult: 1.5, square: 72 },
  xhdpi:   { mult: 2,   square: 96 },
  xxhdpi:  { mult: 3,   square: 144 },
  xxxhdpi: { mult: 4,   square: 192 },
};
const FG_BASE = 108;

// Splash dimensions per density / orientation (Capacitor defaults).
const SPLASH_SIZES = {
  mdpi:    { port: [320, 480],   land: [480, 320] },
  hdpi:    { port: [480, 800],   land: [800, 480] },
  xhdpi:   { port: [720, 1280],  land: [1280, 720] },
  xxhdpi:  { port: [960, 1600],  land: [1600, 960] },
  xxxhdpi: { port: [1280, 1920], land: [1920, 1280] },
};

async function makeSplash(width, height, ballSvg) {
  // Ball occupies ~33% of the smaller dimension; centered on lavender.
  const target = Math.round(Math.min(width, height) * 0.33);
  const ballPng = await sharp(ballSvg).resize(target, target).png().toBuffer();
  return sharp({
    create: {
      width, height, channels: 4,
      background: SPLASH_BG,
    },
  })
    .composite([{ input: ballPng, gravity: 'center' }])
    .png()
    .toBuffer();
}

(async () => {
  const fgSvg = fs.readFileSync(FG_SVG);
  const legacySvg = fs.readFileSync(LEGACY_SVG);
  const ballSvg = fs.readFileSync(BALL_SVG);

  // Launcher icons.
  for (const [bucket, { mult, square }] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${bucket}`);
    fs.mkdirSync(dir, { recursive: true });

    const fgSize = Math.round(FG_BASE * mult);
    await sharp(fgSvg)
      .resize(fgSize, fgSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    await sharp(legacySvg).resize(square, square).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(legacySvg).resize(square, square).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    console.log(`[icons] ${bucket}: foreground ${fgSize}px, legacy ${square}px`);
  }

  // Splash screens.
  for (const [bucket, sizes] of Object.entries(SPLASH_SIZES)) {
    for (const orient of ['port', 'land']) {
      const [w, h] = sizes[orient];
      const dir = path.join(RES, `drawable-${orient}-${bucket}`);
      fs.mkdirSync(dir, { recursive: true });
      const buf = await makeSplash(w, h, ballSvg);
      fs.writeFileSync(path.join(dir, 'splash.png'), buf);
      console.log(`[splash] ${orient}-${bucket}: ${w}x${h}`);
    }
  }

  // Default fallback splash (drawable/splash.png) — used if no density
  // qualifier matches. Use mdpi-land since that's the original size.
  const fallback = await makeSplash(480, 320, ballSvg);
  fs.writeFileSync(path.join(RES, 'drawable', 'splash.png'), fallback);
  console.log(`[splash] default: 480x320`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
