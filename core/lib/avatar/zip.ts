type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressed: Uint8Array;
  uncompressedSize: number;
};

const decoder = new TextDecoder();

const u16 = (dv: DataView, o: number) => dv.getUint16(o, true);
const u32 = (dv: DataView, o: number) => dv.getUint32(o, true);
const ZIP64_SIZE = 0xffffffff;

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
  const eocdOffset = findEndOfCentralDirectory(dv, bytes);

  if (eocdOffset >= 0) {
    const entryCount = u16(dv, eocdOffset + 10);
    const centralDirectoryOffset = u32(dv, eocdOffset + 16);
    let p = centralDirectoryOffset;
    for (let i = 0; i < entryCount; i += 1) {
      if (p + 46 > bytes.length || u32(dv, p) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
      const flags = u16(dv, p + 8);
      const method = u16(dv, p + 10);
      const compressedSize = u32(dv, p + 20);
      const uncompressedSize = u32(dv, p + 24);
      const nameLen = u16(dv, p + 28);
      const extraLen = u16(dv, p + 30);
      const commentLen = u16(dv, p + 32);
      const localHeaderOffset = u32(dv, p + 42);
      if (compressedSize === ZIP64_SIZE || uncompressedSize === ZIP64_SIZE || localHeaderOffset === ZIP64_SIZE) {
        throw new Error('ZIP64 archives are not supported.');
      }
      const nameStart = p + 46;
      const name = decodeEntryName(bytes.slice(nameStart, nameStart + nameLen), flags);
      const entry = readLocalEntry(dv, bytes, name, flags, method, compressedSize, uncompressedSize, localHeaderOffset);
      pushEntry(entries, entry);
      p = nameStart + nameLen + extraLen + commentLen;
    }
  } else {
    let p = 0;
    while (p + 30 <= bytes.length && u32(dv, p) === 0x04034b50) {
      const flags = u16(dv, p + 6);
      if (flags & 0x08) throw new Error('ZIP data descriptors are not supported.');
      const method = u16(dv, p + 8);
      const compressedSize = u32(dv, p + 18);
      const uncompressedSize = u32(dv, p + 22);
      const nameLen = u16(dv, p + 26);
      const extraLen = u16(dv, p + 28);
      const nameStart = p + 30;
      const name = decodeEntryName(bytes.slice(nameStart, nameStart + nameLen), flags);
      const dataStart = nameStart + nameLen + extraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) throw new Error('Invalid ZIP entry size.');
      pushEntry(entries, {
        name,
        flags,
        method,
        compressed: bytes.slice(dataStart, dataEnd),
        uncompressedSize,
      });
      p = dataEnd;
    }
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

function findEndOfCentralDirectory(dv: DataView, bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let p = bytes.length - 22; p >= min; p -= 1) {
    if (u32(dv, p) === 0x06054b50) return p;
  }
  return -1;
}

function decodeEntryName(bytes: Uint8Array, flags: number): string {
  if (flags & 0x800) return decoder.decode(bytes).replace(/\\/g, '/');
  let name = '';
  for (const byte of bytes) name += String.fromCharCode(byte);
  return name.replace(/\\/g, '/');
}

function readLocalEntry(
  dv: DataView,
  bytes: Uint8Array,
  name: string,
  flags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  localHeaderOffset: number,
): ZipEntry {
  if (localHeaderOffset + 30 > bytes.length || u32(dv, localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid ZIP entry header: ${name}`);
  }
  const nameLen = u16(dv, localHeaderOffset + 26);
  const extraLen = u16(dv, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > bytes.length) throw new Error('Invalid ZIP entry size.');
  const entry = {
    name,
    flags,
    method,
    compressed: bytes.slice(dataStart, dataEnd),
    uncompressedSize,
  };
  pushEntry([], entry);
  return entry;
}

function pushEntry(entries: ZipEntry[], entry: ZipEntry): void {
  const name = entry.name;
  if (name.startsWith('/') || name.includes('../') || name.includes('/..')) {
    throw new Error(`Unsafe ZIP path: ${name}`);
  }
  if (!name.endsWith('/')) {
    entries.push(entry);
  }
}
