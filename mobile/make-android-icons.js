// Rasterize ../desktop/build/icon.svg → Android launcher PNGs at every
// density bucket. Run after editing the SVG:
//   node make-android-icons.js
//
// Outputs:
//   android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png
//   android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_round.png
//   android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png
//
// Sharp lives in ../desktop/node_modules so we don't need to add it as a
// dep here — desktop is the canonical icon-tooling project.

const fs = require('fs');
const path = require('path');
const sharp = require('../desktop/node_modules/sharp');

const SVG = path.join(__dirname, '..', 'desktop', 'build', 'icon.svg');
const RES = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// Adaptive icon foreground canvas is 108dp; the inner 72dp is the safe
// zone visible in every mask. The SVG's avatar circle (r=86 in a 256
// viewBox) fills ~67% of the canvas — i.e. exactly the 72/108 safe zone —
// so rendering the SVG full-bleed lines up with Android's keylines.
// Square legacy icons want the launcher mark only, no aura padding,
// because the OS draws them at full bleed.
const DENSITIES = {
  mdpi: { mult: 1, square: 48 },
  hdpi: { mult: 1.5, square: 72 },
  xhdpi: { mult: 2, square: 96 },
  xxhdpi: { mult: 3, square: 144 },
  xxxhdpi: { mult: 4, square: 192 },
};
const FG_BASE = 108;

(async () => {
  const svg = fs.readFileSync(SVG);
  for (const [bucket, { mult, square }] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${bucket}`);
    fs.mkdirSync(dir, { recursive: true });

    // Adaptive foreground.
    const fgSize = Math.round(FG_BASE * mult);
    await sharp(svg)
      .resize(fgSize, fgSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    // Legacy square + round (pre-API-26 launchers fall back to these).
    await sharp(svg).resize(square, square).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(svg).resize(square, square).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    console.log(`[icons] ${bucket}: foreground ${fgSize}px, legacy ${square}px`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
