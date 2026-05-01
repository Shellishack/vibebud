// Rasterize build/icon.svg into platform-specific desktop assets.
// Run via `npm run make-icon` after editing the SVG.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const BUILD = path.join(__dirname, 'build');
const SVG = path.join(BUILD, 'icon.svg');
const OUT_ICO = path.join(BUILD, 'icon.ico');
const OUT_LINUX = path.join(BUILD, 'icon.png');
const OUT_TRAY = path.join(BUILD, 'tray.png');
const OUT_TRAY_2X = path.join(BUILD, 'tray@2x.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const svg = fs.readFileSync(SVG);
  const pngs = await Promise.all(
    SIZES.map((s) => sharp(svg).resize(s, s).png().toBuffer())
  );
  fs.writeFileSync(OUT_ICO, await pngToIco(pngs));
  console.log(`[make-icon] wrote ${OUT_ICO} (${SIZES.join(', ')}px)`);

  await sharp(svg).resize(512, 512).png().toFile(OUT_LINUX);
  console.log(`[make-icon] wrote ${OUT_LINUX} (512px)`);

  await sharp(svg).resize(16, 16).png().toFile(OUT_TRAY);
  await sharp(svg).resize(32, 32).png().toFile(OUT_TRAY_2X);
  console.log(`[make-icon] wrote ${OUT_TRAY} and ${OUT_TRAY_2X}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
