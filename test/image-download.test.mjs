import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalImageFamilyKey,
  groupImageCandidates,
  imageContentLength,
  imageExtension,
  imageLayout,
  imageMimeFromHeaders,
  normalizeImageCandidate,
  sanitizeImageFilename
} from '../extension/core/image-download.js';

test('responsive variants form one family and prefer the strongest original candidate', () => {
  const groups = groupImageCandidates([
    { url: 'https://cdn.example/photo-320x180.jpg?w=320', familyKey: 'hero', width: 320, height: 180, source: 'image' },
    { url: 'https://cdn.example/photo.jpg?w=1920', familyKey: 'hero', width: 1920, height: 1080, source: 'srcset', descriptorWidth: 1920 },
    { url: 'https://cdn.example/photo-original.jpg', familyKey: 'hero', width: 2400, height: 1350, source: 'original-attribute', originalHint: 8 }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].candidates.length, 3);
  assert.equal(groups[0].recommended.url, 'https://cdn.example/photo-original.jpg');
});

test('candidate normalization rejects non-image MIME responses and unsupported schemes', () => {
  assert.equal(normalizeImageCandidate({ url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeImageCandidate({ url: 'https://example.com/page', mime: 'text/html' }), null);
  assert.equal(normalizeImageCandidate({ url: 'https://example.com/image?id=1', mime: 'image/webp' }).extension, 'webp');
});

test('family keys ignore common thumbnail sizing parameters', () => {
  assert.equal(
    canonicalImageFamilyKey('https://cdn.example/photo-320x180.jpg?w=320&quality=70&id=8'),
    canonicalImageFamilyKey('https://cdn.example/photo.jpg?w=1920&quality=95&id=8')
  );
});

test('image metadata uses response totals and portable filenames', () => {
  const headers = [
    { name: 'Content-Type', value: 'image/avif; charset=binary' },
    { name: 'Content-Range', value: 'bytes 0-1023/8192' }
  ];
  assert.equal(imageMimeFromHeaders(headers), 'image/avif');
  assert.equal(imageContentLength(headers), 8192);
  assert.equal(imageExtension('https://example.com/no-extension', 'image/avif'), 'avif');
  assert.equal(sanitizeImageFilename('A <photo>: title? ', 'PNG'), 'A photo title.png');
});

test('image layouts distinguish square, wide, tall, and unknown dimensions', () => {
  assert.equal(imageLayout(1000, 950), 'square');
  assert.equal(imageLayout(1600, 900), 'wide');
  assert.equal(imageLayout(900, 1600), 'tall');
  assert.equal(imageLayout(0, 0), 'unknown');
});
