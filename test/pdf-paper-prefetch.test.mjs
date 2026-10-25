import assert from 'node:assert/strict';
import test from 'node:test';
import { isDarkPaper } from '../extension/workspaces/pdf-viewer/dark-paper.js';
import { renderedPaperBackground } from '../extension/workspaces/pdf-viewer/paper-background.js';
import { selectNearbyPage, installPagePrefetch } from '../extension/workspaces/pdf-viewer/prefetch.js';

function sample(size, pixel = (x, y) => [22 + Math.floor(x * 10 / size), 23 + Math.floor(y * 9 / size), 50, 255]) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(pixel(x, y), (y * size + x) * 4);
  return { width: size, height: size, data };
}
const white = [255, 255, 255, 255];
const model = () => ({ kind: 'image', ...sample(32) });

test('colored dark paper requires a proven dark background and rejects white margins and predominantly light pages', () => {
  for (const size of [128, 257]) {
    const paper = sample(size), evidence = model();
    assert.equal(isDarkPaper(paper), false, 'darkness alone does not prove paper');
    assert.equal(isDarkPaper(paper, .96, evidence), true);
    const writing = sample(size, (x, y) => x > size * .1 && x < size * .8 && y > size * .2 && y < size * .7 && y % 23 < 2
      ? white : [22 + Math.floor(x * 10 / size), 23 + Math.floor(y * 9 / size), 50, 255]);
    assert.equal(isDarkPaper(writing, .96, evidence), true);
    assert.equal(isDarkPaper(sample(size,(x,y)=>x>size*.2&&x<size*.8&&y>size*.3&&y<size*.65?white:[25,25,50,255]),.96,evidence),true,
      'an inset light panel does not turn a verified dark paper bed into white paper');
    for (const pixel of [
      (x, y) => x === 0 || y === 0 || x === size - 1 || y === size - 1 ? white : [25, 25, 50, 255],
      (x, y) => x > size * .1 && x < size * .9 && y > size * .1 && y < size * .9 ? white : [25, 25, 50, 255],
      () => white,
      () => [25, 25, 50, 0]
    ]) assert.equal(isDarkPaper(sample(size, pixel), .96, evidence), false);
    assert.equal(isDarkPaper(paper, .96, { kind: 'image', ...sample(32, () => white) }), false);
    assert.equal(isDarkPaper(paper, .96, { kind: 'image', ...sample(32, () => [100, 10, 10, 255]) }), false, 'background must agree with the page edge');
  }
});

test('background evidence uses only a completed first-paint image with opaque normal graphics state', () => {
  const names = ['save', 'restore', 'setGState', 'transform', 'dependency', 'paintImageXObject', 'eoClip', 'clip',
    'constructPath', 'endPath', 'beginMarkedContent', 'endMarkedContent', 'beginMarkedContentProps', 'beginText', 'endText', 'setFont', 'setLeading'];
  const ops = Object.fromEntries(names.map((name, index) => [name, index + 1]));
  let pixels = sample(32), reads = 0, matrix;
  const context = { canvas: {}, setTransform(...args) { matrix = args; }, transform() {}, save() {}, restore() {}, clip() {}, scale() {}, drawImage() {},
    getImageData() { reads++; return pixels; } };
  const steps = [[ops.beginMarkedContent, ['Artifact']], [ops.setGState, [[['BM', 'source-over'], ['ca', 1]]]],
    [ops.save, null], [ops.eoClip, null], [ops.constructPath, [ops.endPath, [{}]]],
    [ops.transform, [720, 0, 0, 540, 0, 0]], [ops.dependency, ['image']], [ops.paintImageXObject, ['image', 1600, 1200]]];
  const page = values => ({ view: [0, 0, 720, 540], objs: { has: () => true, get: () => ({ bitmap: {}, width: 1600, height: 1200 }) },
    _intentStates: new Map([['display', { displayReadyCapability: {}, operatorList: { lastChunk: true,
      fnArray: values.map(v => v[0]), argsArray: values.map(v => v[1]) } }]]) });
  assert.equal(renderedPaperBackground(page(steps), ops, context).kind, 'image');
  assert.equal(reads, 1);
  const shared = page(steps);
  shared.commonObjs = shared.objs;
  shared.objs = { has: () => false };
  assert.equal(renderedPaperBackground(shared, ops, context).kind, 'image', 'reused slide backgrounds may be in the shared image cache');
  assert.equal(context.canvas.width, 0);
  for (const before of [[ops.setGState, [[['ca', .5]]]], [ops.setGState, [[['BM', 'multiply']]]], [-1, []], [ops.constructPath, [99, [{}]]]]) {
    assert.equal(renderedPaperBackground(page([before, ...steps]), ops, context), null);
  }
  pixels = sample(32, (x, y) => x === 0 ? [0, 0, 0, 0] : [25, 25, 50, 255]);
  assert.equal(renderedPaperBackground(page(steps), ops, context), null, 'an inset or clipped image cannot prove a paper bed');
  pixels = sample(32);
  const rotated = page(steps);
  rotated.getViewport = ({ rotation }) => { assert.equal(rotation, 90); return { width: 540, height: 720, transform: [0, 1, 1, 0, 0, 0] }; };
  assert.equal(renderedPaperBackground(rotated, ops, context, 90).kind, 'image');
  assert.deepEqual(matrix, [0, 32 / 720, 32 / 540, 0, 0, 0]);
});

test('prefetch stays in a bounded directional window and preserves visible rendering priority', () => {
  const views = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, renderingState: 3 }));
  const visible = { first: { id: 5 }, last: { id: 6 }, views: [{ view: views[4] }, { view: views[5] }] };
  views[6].renderingState = views[3].renderingState = 0;
  assert.equal(selectNearbyPage(visible, views, true), views[6]);
  assert.equal(selectNearbyPage(visible, views, false), views[3]);
  views[6].renderingState = views[3].renderingState = 3;
  views[10].renderingState = 0;
  assert.equal(selectNearbyPage(visible, views, true), null, 'never scans the rest of a large document');
  let priority = views[4];
  const viewer = { renderingQueue: { getHighestPriority: () => priority } };
  installPagePrefetch(viewer);
  assert.equal(viewer.renderingQueue.getHighestPriority(visible, views, true), priority);
  priority = views[4].detailView = {};
  assert.equal(viewer.renderingQueue.getHighestPriority(visible, views, true), priority);
  priority = null; views[6].renderingState = 0;
  assert.equal(viewer.renderingQueue.getHighestPriority(visible, views, true), views[6]);
});
