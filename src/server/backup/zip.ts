import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A small, dependency-free ZIP reader and writer, enough for `.atlasbackup` files: stored or
 * deflated entries, UTF-8 names, CRC-32 checks. No ZIP64 and no encryption (a backup is far below
 * 4 GB, and is meant to be openable by any unzip tool after renaming it to `.zip`).
 */

export class ZipError extends Error {
  constructor(
    public readonly code: "not_zip" | "corrupt" | "unsupported" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
  /** Deflate it (default). Already-compressed data (a .gz) is better stored as is. */
  compress?: boolean;
  modified?: Date;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX = 0xfffffffe;

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    if (e.data.length > MAX)
      throw new ZipError("too_large", `${e.name} is too large for a backup.`);
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data) >>> 0;
    const deflated = e.compress === false ? null : deflateRawSync(e.data, { level: 6 });
    const useDeflate = deflated !== null && deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const { time, date } = dosTime(e.modified ?? new Date());
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(SIG_CENTRAL, 0);
    c.writeUInt16LE(20, 4); // made by
    c.writeUInt16LE(20, 6); // needed
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  offset: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  has(name: string): boolean;
  /** The entry's bytes, checked against its CRC-32. */
  read(name: string): Buffer;
}

export function readZip(buf: Buffer): ZipArchive {
  if (buf.length < 22) throw new ZipError("not_zip", "This file is not a valid backup.");
  // the end-of-central-directory record sits at the very end (with an optional comment)
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("not_zip", "This file is not a valid backup.");
  const count = buf.readUInt16LE(end + 10);
  const centralSize = buf.readUInt32LE(end + 12);
  const centralStart = buf.readUInt32LE(end + 16);
  if (count === 0xffff || centralStart === 0xffffffff)
    throw new ZipError("unsupported", "This backup uses a format that is not supported.");
  if (centralStart + centralSize > end) throw new ZipError("corrupt", "The backup is damaged.");

  const entries: ZipEntry[] = [];
  let p = centralStart;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new ZipError("corrupt", "The backup is damaged.");
    const flags = buf.readUInt16LE(p + 8);
    if (flags & 1) throw new ZipError("unsupported", "Encrypted backups are not supported.");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    has: (name) => byName.has(name),
    read(name) {
      const e = byName.get(name);
      if (!e) throw new ZipError("corrupt", `The backup is missing “${name}”.`);
      const o = e.offset;
      if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOCAL)
        throw new ZipError("corrupt", "The backup is damaged.");
      const nameLen = buf.readUInt16LE(o + 26);
      const extraLen = buf.readUInt16LE(o + 28);
      const start = o + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compressedSize);
      if (raw.length !== e.compressedSize) throw new ZipError("corrupt", "The backup is damaged.");
      let data: Buffer;
      try {
        if (e.method === 0) data = Buffer.from(raw);
        else if (e.method === 8) data = inflateRawSync(raw);
        else
          throw new ZipError(
            "unsupported",
            "This backup uses a compression that is not supported.",
          );
      } catch (err) {
        if (err instanceof ZipError) throw err;
        throw new ZipError("corrupt", "The backup is damaged.");
      }
      if (data.length !== e.size || crc32(data) >>> 0 !== e.crc)
        throw new ZipError("corrupt", `“${name}” is damaged inside the backup.`);
      return data;
    },
  };
}
