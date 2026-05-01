import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ACTIONS = ['idle', 'walk', 'climb', 'fall', 'sit', 'drag'] as const;

function safeSlug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'generated-sprite';
}

function xmlEscape(input: string) {
  return input.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generatedSheetSvg(name: string, imageDataUrl: string) {
  const frame = 256;
  const sheetW = frame * 4;
  const sheetH = frame * 6;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}" viewBox="0 0 ${sheetW} ${sheetH}">
    <title>${xmlEscape(name)} sheet</title>
    <filter id="remove-magenta" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 1 -1 1 0"/>
    </filter>
    <g filter="url(#remove-magenta)">
      <image href="${xmlEscape(imageDataUrl)}" x="0" y="0" width="${sheetW}" height="${sheetH}"/>
    </g>
  </svg>`, 'utf8');
}

function generatedPreviewSvg(name: string, imageDataUrl: string) {
  const frame = 256;
  const sheetW = frame * 4;
  const sheetH = frame * 6;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${frame}" height="${frame}" viewBox="0 0 ${frame} ${frame}">
    <title>${xmlEscape(name)} preview</title>
    <filter id="remove-magenta" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 1 -1 1 0"/>
    </filter>
    <g filter="url(#remove-magenta)">
      <image href="${xmlEscape(imageDataUrl)}" x="0" y="0" width="${sheetW}" height="${sheetH}"/>
    </g>
  </svg>`, 'utf8');
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function makeSpriteZip(name: string, prompt: string, imageDataUrl: string) {
  const cleanName = name.trim().slice(0, 80) || 'Custom Sprite';
  const manifest = {
    schemaVersion: 1,
    id: `${safeSlug(cleanName)}-${Date.now().toString(36)}`,
    name: cleanName,
    license: 'Generated for Vibebud user',
    author: 'Vibebud local processor',
    description: prompt.trim().slice(0, 300),
    preview: 'preview.svg',
    frameSize: { w: 256, h: 256 },
    scale: 1,
    animations: Object.fromEntries(ACTIONS.map((action, row) => [action, {
      src: 'sheet.svg',
      frames: 4,
      fps: action === 'walk' ? 8 : 5,
      loop: true,
      row,
    }])),
  };
  return makeZip([
    { name: 'sprite-manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'preview.svg', data: generatedPreviewSvg(cleanName, imageDataUrl) },
    { name: 'sheet.svg', data: generatedSheetSvg(cleanName, imageDataUrl) },
  ]);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: unknown; prompt?: unknown; imageDataUrl?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name : 'Custom Sprite';
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const imageDataUrl = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : '';
  if (!imageDataUrl.startsWith('data:image/')) {
    return Response.json({ error: 'imageDataUrl must be a data:image URL.' }, { status: 400 });
  }
  if (imageDataUrl.length > 12 * 1024 * 1024) {
    return Response.json({ error: 'imageDataUrl is too large.' }, { status: 413 });
  }
  const zip = makeSpriteZip(name, prompt, imageDataUrl);
  return new Response(zip, {
    status: 201,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeSlug(name)}.zip"`,
    },
  });
}
