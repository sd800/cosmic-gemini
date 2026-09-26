const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function gfMultiply(left, right) {
  let result = 0;
  let a = left;
  let b = right;
  while (b) {
    if (b & 1) result ^= a;
    a = (a << 1) ^ ((a & 0x80) ? 0x11b : 0);
    b >>>= 1;
  }
  return result & 0xff;
}

function gfPower(value, power) {
  let result = 1;
  let base = value;
  let exponent = power;
  while (exponent) {
    if (exponent & 1) result = gfMultiply(result, base);
    base = gfMultiply(base, base);
    exponent >>>= 1;
  }
  return result;
}

function rotateByte(value, count) {
  return ((value << count) | (value >>> (8 - count))) & 0xff;
}

const SBOX = new Uint8Array(256);
const INVERSE_SBOX = new Uint8Array(256);
for (let value = 0; value < 256; value += 1) {
  const inverse = value ? gfPower(value, 254) : 0;
  const substituted = inverse ^ rotateByte(inverse, 1) ^ rotateByte(inverse, 2)
    ^ rotateByte(inverse, 3) ^ rotateByte(inverse, 4) ^ 0x63;
  SBOX[value] = substituted;
  INVERSE_SBOX[substituted] = value;
}

function expandKey(key) {
  if (![16, 24, 32].includes(key.length)) throw new Error('Invalid AES key length.');
  const words = key.length / 4;
  const rounds = words + 6;
  const expanded = new Uint8Array(16 * (rounds + 1));
  expanded.set(key);
  const temp = new Uint8Array(4);
  let rcon = 1;
  for (let word = words; word < 4 * (rounds + 1); word += 1) {
    temp.set(expanded.subarray((word - 1) * 4, word * 4));
    if (word % words === 0) {
      const first = temp[0];
      temp[0] = SBOX[temp[1]] ^ rcon;
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[first];
      rcon = gfMultiply(rcon, 2);
    } else if (words > 6 && word % words === 4) {
      for (let index = 0; index < 4; index += 1) temp[index] = SBOX[temp[index]];
    }
    for (let index = 0; index < 4; index += 1) {
      expanded[word * 4 + index] = expanded[(word - words) * 4 + index] ^ temp[index];
    }
  }
  return { expanded, rounds };
}

function addRoundKey(state, expanded, round) {
  const offset = round * 16;
  for (let index = 0; index < 16; index += 1) state[index] ^= expanded[offset + index];
}

function shiftRows(state, inverse = false) {
  const source = state.slice();
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const inputColumn = (column + (inverse ? 4 - row : row)) % 4;
      state[row + 4 * column] = source[row + 4 * inputColumn];
    }
  }
}

function mixColumns(state, inverse = false) {
  const matrix = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1];
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const values = state.slice(offset, offset + 4);
    for (let row = 0; row < 4; row += 1) {
      state[offset + row] = gfMultiply(values[0], matrix[(4 - row) % 4])
        ^ gfMultiply(values[1], matrix[(5 - row) % 4])
        ^ gfMultiply(values[2], matrix[(6 - row) % 4])
        ^ gfMultiply(values[3], matrix[(7 - row) % 4]);
    }
  }
}

function encryptBlock(block, schedule) {
  const state = block.slice();
  addRoundKey(state, schedule.expanded, 0);
  for (let round = 1; round < schedule.rounds; round += 1) {
    for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, schedule.expanded, round);
  }
  for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
  shiftRows(state);
  addRoundKey(state, schedule.expanded, schedule.rounds);
  return state;
}

function decryptBlock(block, schedule) {
  const state = block.slice();
  addRoundKey(state, schedule.expanded, schedule.rounds);
  for (let round = schedule.rounds - 1; round > 0; round -= 1) {
    shiftRows(state, true);
    for (let index = 0; index < 16; index += 1) state[index] = INVERSE_SBOX[state[index]];
    addRoundKey(state, schedule.expanded, round);
    mixColumns(state, true);
  }
  shiftRows(state, true);
  for (let index = 0; index < 16; index += 1) state[index] = INVERSE_SBOX[state[index]];
  addRoundKey(state, schedule.expanded, 0);
  return state;
}

function removePadding(bytes) {
  if (!bytes.length) return bytes;
  const padding = bytes.at(-1);
  return padding >= 1 && padding <= 16 && padding <= bytes.length
    ? bytes.subarray(0, bytes.length - padding) : bytes;
}

function aesTransform(mode, input, key, iv) {
  const schedule = expandKey(key);
  const output = new Uint8Array(input.length);
  let feedback = iv?.slice() || new Uint8Array(16);
  for (let offset = 0; offset < input.length; offset += 16) {
    const length = Math.min(16, input.length - offset);
    const block = input.subarray(offset, offset + length);
    if (mode === 'ECB' || mode === 'CBC') {
      if (length !== 16) throw new Error('Invalid AES block length.');
      const decrypted = decryptBlock(block, schedule);
      for (let index = 0; index < 16; index += 1) {
        output[offset + index] = mode === 'CBC' ? decrypted[index] ^ feedback[index] : decrypted[index];
      }
      if (mode === 'CBC') feedback = block.slice();
      continue;
    }
    const stream = encryptBlock(feedback, schedule);
    for (let index = 0; index < length; index += 1) output[offset + index] = block[index] ^ stream[index];
    if (mode === 'CFB') feedback = block.slice();
    else feedback = stream;
  }
  return removePadding(output);
}

function base64Bytes(value, strict = false) {
  let text = typeof value === 'string' ? value : textDecoder.decode(value);
  text = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = text.length % 4;
  if (strict && remainder === 1) throw new Error('Invalid Base64 value.');
  if (remainder === 2) text += '==';
  else if (remainder === 3) text += '=';
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isHls(value) {
  const text = String(value || '').replace(/^\uFEFF/, '').trimStart();
  return text.startsWith('#EXTM3U') && /#EXT-X-(?:VERSION|STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)|#EXTINF/.test(text);
}

function parseEnvelope(bytes) {
  if (bytes.length < 7) return null;
  const metadataLengthText = textDecoder.decode(bytes.subarray(bytes.length - 2));
  if (!/^\d{2}$/.test(metadataLengthText)) return null;
  const metadataLength = Number(metadataLengthText);
  const metadataStart = bytes.length - 2 - metadataLength;
  if (metadataStart < 0 || metadataLength > bytes.length / 2) return null;
  const metadata = bytes.subarray(metadataStart, bytes.length - 2);
  let offset = 0;
  const tag = textDecoder.decode(metadata.subarray(offset, offset + 2));
  offset += 2;
  if (!['AA', 'AB', 'AC', 'AD', 'AE', 'AF'].includes(tag)) return null;
  const read = () => {
    const lengthText = textDecoder.decode(metadata.subarray(offset, offset + 2));
    if (!/^\d{2}$/.test(lengthText)) return null;
    offset += 2;
    const length = Number(lengthText);
    if (offset + length > metadata.length) return null;
    const value = metadata.slice(offset, offset + length);
    offset += length;
    return value;
  };
  const key = read();
  const iv = read();
  if (key === null || iv === null || offset !== metadata.length) return null;
  return { tag, key, iv, body: bytes.subarray(0, metadataStart) };
}

function decodeEnvelope(envelope) {
  const body = base64Bytes(envelope.body);
  if (envelope.tag === 'AA') return base64Bytes(body);
  if (envelope.tag === 'AB') {
    if (!envelope.key.length) throw new Error('Missing XOR key.');
    const result = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index += 1) result[index] = body[index] ^ envelope.key[index % envelope.key.length];
    return result;
  }
  const mode = { AC: 'ECB', AD: 'CBC', AE: 'CFB', AF: 'OFB' }[envelope.tag];
  const iv = mode === 'ECB' ? undefined : base64Bytes(envelope.iv, true);
  if (mode !== 'ECB' && iv.length !== 16) throw new Error('Invalid AES IV length.');
  return aesTransform(mode, body, envelope.key, iv);
}

export function unwrapObfuscatedHls(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const direct = textDecoder.decode(bytes);
  if (isHls(direct)) return direct.replace(/^\uFEFF/, '').trimStart();
  if (/^[\w+/=\- \r\n\t]+$/.test(direct) && direct.length > 20) {
    try {
      const decoded = textDecoder.decode(base64Bytes(textEncoder.encode(direct)));
      if (isHls(decoded)) return decoded.replace(/^\uFEFF/, '').trimStart();
    } catch {}
  }
  let envelope = parseEnvelope(bytes);
  if (!envelope && /^[\w+/=\- \r\n\t]+$/.test(direct)) {
    try { envelope = parseEnvelope(base64Bytes(textEncoder.encode(direct))); }
    catch {}
  }
  if (!envelope) return null;
  try {
    const result = textDecoder.decode(decodeEnvelope(envelope));
    return isHls(result) ? result.replace(/^\uFEFF/, '').trimStart() : null;
  } catch { return null; }
}
