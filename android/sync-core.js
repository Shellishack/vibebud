const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'core', 'out');
const DST = path.resolve(__dirname, 'www');
// Same rationale as desktop/sync-core.js: the core export hosts installer
// downloads under installers/, but bundling them into the APK would cause
// each rebuild to compound on the previous one.
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
