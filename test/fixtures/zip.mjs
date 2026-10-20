import { deflateRawSync } from 'node:zlib';

export function storedZip(entries, compress = false) {
  let offset = 0;
  const locals = [], directory = [];
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), data = Buffer.from(text);
    const packed = compress ? deflateRawSync(data) : data;
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, packed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, n); offset += local.length + n.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const value = Buffer.concat([...locals, dir, end]);
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}
