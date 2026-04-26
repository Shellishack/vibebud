const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'core', 'out');
const DST = path.resolve(__dirname, 'core-out');

if (!fs.existsSync(SRC)) {
  console.error(`[sync-core] missing ${SRC} — run \`npm run build\` in core/ first.`);
  process.exit(1);
}

fs.rmSync(DST, { recursive: true, force: true });
fs.cpSync(SRC, DST, { recursive: true });
console.log(`[sync-core] copied ${SRC} → ${DST}`);
