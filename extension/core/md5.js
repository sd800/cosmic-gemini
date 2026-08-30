function add(left, right) {
  return (left + right) | 0;
}

function rotateLeft(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}

function step(fn, a, b, c, d, word, shift, constant) {
  return add(rotateLeft(add(add(a, fn(b, c, d)), add(word, constant)), shift), b);
}

function toUtf8(value) {
  return new TextEncoder().encode(String(value));
}

export function md5(value) {
  const input = toUtf8(value);
  const bitLength = input.byteLength * 8;
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.byteLength] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0);

  for (let offset = 0; offset < bytes.byteLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getInt32(offset + index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let fn;
      let wordIndex;
      if (index < 16) {
        fn = (x, y, z) => (x & y) | (~x & z);
        wordIndex = index;
      } else if (index < 32) {
        fn = (x, y, z) => (x & z) | (y & ~z);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        fn = (x, y, z) => x ^ y ^ z;
        wordIndex = (3 * index + 5) % 16;
      } else {
        fn = (x, y, z) => y ^ (x | ~z);
        wordIndex = (7 * index) % 16;
      }
      const nextA = d;
      const nextB = step(fn, a, b, c, d, words[wordIndex], shifts[index], constants[index]);
      d = c;
      c = b;
      b = nextB;
      a = nextA;
    }
    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }

  return [a0, b0, c0, d0]
    .map(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join(''))
    .join('');
}
