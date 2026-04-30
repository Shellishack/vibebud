type ZipEntry = {
  name: string;
  method: number;
  compressed: Uint8Array;
  uncompressedSize: number;
};

const decoder = new TextDecoder();

const u16 = (dv: DataView, o: number) => dv.getUint16(o, true);
const u32 = (dv: DataView, o: number) => dv.getUint32(o, true);

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress ZIP files.');
  }
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(file: File): Promise<Record<string, Uint8Array>> {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries: ZipEntry[] = [];
  let p = 0;

  while (p + 30 <= bytes.length && u32(dv, p) === 0x04034b50) {
    const flags = u16(dv, p + 6);
    const method = u16(dv, p + 8);
    const compressedSize = u32(dv, p + 18);
    const uncompressedSize = u32(dv, p + 22);
    const nameLen = u16(dv, p + 26);
    const extraLen = u16(dv, p + 28);
    if (flags & 0x08) throw new Error('ZIP data descriptors are not supported.');
    const nameStart = p + 30;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLen)).replace(/\\/g, '/');
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('Invalid ZIP entry size.');
    if (name.startsWith('/') || name.includes('../') || name.includes('/..')) {
      throw new Error(`Unsafe ZIP path: ${name}`);
    }
    if (!name.endsWith('/')) {
      entries.push({ name, method, compressed: bytes.slice(dataStart, dataEnd), uncompressedSize });
    }
    p = dataEnd;
  }

  if (!entries.length) throw new Error('No ZIP entries found.');
  const out: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    let data: Uint8Array;
    if (entry.method === 0) data = entry.compressed;
    else if (entry.method === 8) data = await inflateRaw(entry.compressed);
    else throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
    if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
      throw new Error(`Invalid size for ${entry.name}.`);
    }
    out[entry.name] = data;
  }
  return out;
}
