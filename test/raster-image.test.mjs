import assert from 'node:assert/strict';
import test from 'node:test';
import { rasterPixels, rasterBudget } from '../extension/workspaces/document-preview/raster-image.js';

const uri = (type, bytes) => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
function png(width, height, frames) {
  const header = Buffer.alloc(33); Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(header);
  header.writeUInt32BE(13,8); header.write('IHDR',12); header.writeUInt32BE(width,16); header.writeUInt32BE(height,20);
  if (frames === undefined) return header;
  const animation = Buffer.alloc(20); animation.writeUInt32BE(8,0); animation.write('acTL',4); animation.writeUInt32BE(frames,8);
  return Buffer.concat([header,animation]);
}

test('embedded raster inspection accepts common formats and rejects disguised or excessive images', () => {
  assert.equal(rasterPixels(tinyPng),1);
  assert.equal(rasterPixels('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),1);
  assert.equal(rasterPixels(uri('jpeg',[255,216,255,192,0,8,8,0,10,0,20,1])),200);
  const webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBPVP8X',8);webp.writeUInt32LE(10,16);webp.writeUIntLE(19,24,3);webp.writeUIntLE(9,27,3);
  assert.equal(rasterPixels(uri('webp',webp)),200);
  for (const source of [uri('png','<svg/>'),uri('jpeg',png(1,1)),uri('png',png(0,10)),uri('png',png(100000,100000)),uri('png',png(8192,8192)),uri('png',png(4096,4096,3)),uri('png',png(1,1,0)),tinyPng.replace('png','svg+xml'),tinyPng+'!', 'https://example.test/image.png']) assert.equal(rasterPixels(source),0);
  assert.equal(rasterPixels(uri('png',png(4000,4000,2))),32_000_000);
  assert.equal(rasterPixels('data:image/png;base64,'+'A'.repeat(12*1024*1024)),0);
});

test('animation metadata is bounded and duplicate controls are rejected', () => {
  const animated=png(4,4,2);
  assert.equal(rasterPixels(uri('png',animated)),32);
  assert.equal(rasterPixels(uri('png',Buffer.concat([animated,animated.subarray(33)]))),0);
  assert.equal(rasterPixels(uri('png',animated.subarray(0,animated.length-1))),0);
  assert.equal(rasterPixels(uri('gif',Buffer.from('GIF89a\x01\0\x01\0\0\0\0\x2c','latin1'))),0);
});

test('a render budget charges distinct sources once without decoding any pixels', () => {
  const accept=rasterBudget(),first=uri('png',png(4096,4096,2)),second=uri('png',png(8192,4096)),third=uri('png',png(1,1));
  assert.equal(accept(first),true);assert.equal(accept(first),true);
  assert.equal(accept(second),true);assert.equal(accept(third),false);
  assert.equal(accept(third),false);assert.equal(accept(first),true);
  assert.equal(rasterBudget()(tinyPng),true);
});
