const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'core', 'out');
const DST = path.resolve(__dirname, 'core-out');
// `installers/` lives in core's static export so the website can serve the
// downloads, but bundling the installers *inside* the desktop app would make
// each rebuild compound on the previous one. Skip it.
const SKIP = new Set(['installers']);

if (!fs.existsSync(SRC)) {
  console.error(`[sync-core] missing ${SRC} — run \`npm run build\` in core/ first.`);
  process.exit(1);
}

fs.rmSync(DST, { recursive: true, force: true });
fs.cpSync(SRC, DST, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(SRC, src);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    return !SKIP.has(top);
  },
});
console.log(`[sync-core] copied ${SRC} → ${DST} (excluded: ${[...SKIP].join(', ')})`);
