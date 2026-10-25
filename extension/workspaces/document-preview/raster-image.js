// Inspect embedded raster metadata before handing bytes to a browser decoder.
// No source code, network access, or image decoding runs during this check.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_DIMENSION = 32768;
const MAX_DOCUMENT_PIXELS = 64 * 1024 * 1024;

export function rasterPixels(uri) {
  if (typeof uri !== 'string' || uri.length > Math.ceil(MAX_BYTES / 3) * 4 + 128) return 0;
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(uri);
  if (!match) return 0;
  let data;
  try { data = atob(match[2]); } catch { return 0; }
  if (data.length > MAX_BYTES) return 0;
  const byte = i => data.charCodeAt(i);
  const u16 = i => byte(i) | byte(i + 1) << 8;
  const u24 = i => byte(i) + byte(i + 1) * 256 + byte(i + 2) * 65536;
  const u32 = i => (byte(i) + byte(i + 1) * 256 + byte(i + 2) * 65536 + byte(i + 3) * 16777216) >>> 0;
  const be32 = i => (byte(i) * 16777216 + byte(i + 1) * 65536 + byte(i + 2) * 256 + byte(i + 3)) >>> 0;
  let width = 0, height = 0, frames = 1;
  switch (match[1].toLowerCase()) {
    case 'png': {
      if (data.length < 33 || data.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || be32(8) !== 13 || data.slice(12, 16) !== 'IHDR') return 0;
      width = be32(16); height = be32(20);
      let animated = false;
      for (let at = 8; at + 12 <= data.length;) {
        const length = be32(at), next = at + 12 + length;
        if (next > data.length) return 0;
        if (data.slice(at + 4, at + 8) === 'acTL') {
          if (length !== 8 || animated) return 0;
          animated = true;
          frames = be32(at + 8);
        }
        at = next;
      }
      break;
    }
    case 'jpeg': {
      if (data.slice(0, 2) !== '\xff\xd8') return 0;
      for (let at = 2; at + 4 <= data.length && at < 512 * 1024;) {
        if (byte(at++) !== 255) return 0;
        while (byte(at) === 255) at++;
        const marker = byte(at++);
        if (marker === 0xda || marker === 0xd9) return 0;
        const length = byte(at) * 256 + byte(at + 1);
        if (length < 2 || at + length > data.length) return 0;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          if (length < 8) return 0;
          height = byte(at + 3) * 256 + byte(at + 4); width = byte(at + 5) * 256 + byte(at + 6); break;
        }
        at += length;
      }
      break;
    }
    case 'gif': {
      if (data.length < 13 || !['GIF87a','GIF89a'].includes(data.slice(0, 6))) return 0;
      width = u16(6); height = u16(8); frames = 0;
      let at = 13 + (byte(10) & 128 ? 3 * (1 << ((byte(10) & 7) + 1)) : 0);
      const blocks = () => { while (at < data.length) { const size = byte(at++); if (!size) return true; at += size; } return false; };
      while (at < data.length) {
        const type = byte(at++);
        if (type === 0x3b) break;
        if (type === 0x21) { at++; if (!blocks()) return 0; }
        else if (type === 0x2c) {
          if (at + 9 > data.length) return 0;
          const frameWidth = u16(at + 4), frameHeight = u16(at + 6), packed = byte(at + 8);
          if (!frameWidth || !frameHeight || frameWidth > width || frameHeight > height) return 0;
          at += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0) + 1;
          if (++frames > 256 || !blocks()) return 0;
        } else return 0;
      }
      break;
    }
    case 'webp': {
      if (data.length < 20 || data.slice(0, 4) !== 'RIFF' || data.slice(8, 12) !== 'WEBP' || u32(4) + 8 !== data.length) return 0;
      const type = data.slice(12, 16);
      if (type === 'VP8X' && data.length >= 30 && u32(16) === 10) {
        width = 1 + u24(24); height = 1 + u24(27);
        frames = 0;
        for (let at = 12; at + 8 <= data.length;) {
          const length = u32(at + 4), next = at + 8 + length + (length & 1);
          if (next > data.length) return 0;
          if (data.slice(at, at + 4) === 'ANMF') frames++;
          at = next;
        }
        frames ||= 1;
      } else if (type === 'VP8L' && data.length >= 25 && u32(16) >= 5 && byte(20) === 0x2f) {
        const bits = u32(21); width = 1 + (bits & 0x3fff); height = 1 + (bits >>> 14 & 0x3fff);
      } else if (type === 'VP8 ' && data.length >= 30 && u32(16) >= 10 && data.slice(23, 26) === '\x9d\x01\x2a') {
        width = u16(26) & 0x3fff; height = u16(28) & 0x3fff;
      }
      break;
    }
  }
  const pixels = width * height * frames;
  return width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION && frames > 0 && frames <= 256 && pixels <= MAX_PIXELS ? pixels : 0;
}

export function rasterBudget() {
  const accepted = new Map();
  let pixels = 0;
  return uri => {
    if (accepted.has(uri)) return accepted.get(uri);
    const size = rasterPixels(uri), allowed = size > 0 && pixels + size <= MAX_DOCUMENT_PIXELS;
    if (allowed) pixels += size;
    accepted.set(uri, allowed);
    return allowed;
  };
}
