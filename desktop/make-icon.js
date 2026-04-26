// Rasterize build/icon.svg → build/icon.ico (multi-size).
// Run via `npm run make-icon` after editing the SVG.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const SVG = path.join(__dirname, 'build', 'icon.svg');
const OUT_ICO = path.join(__dirname, 'build', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const svg = fs.readFileSync(SVG);
  const pngs = await Promise.all(
    SIZES.map((s) => sharp(svg).resize(s, s).png().toBuffer())
  );
  const ico = await pngToIco(pngs);
  fs.writeFileSync(OUT_ICO, ico);
  console.log(`[make-icon] wrote ${OUT_ICO} (${SIZES.join(', ')}px)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
