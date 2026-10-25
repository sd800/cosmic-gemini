// Adapter for the pinned PDF.js renderer. Read at most 48 already-rendered
// operators, never getOperatorList() (which starts a separate operator stream).
// Unknown cache/graphics state fails closed; dependency upgrades must retest it.
export function renderedPaperShade(page, ops, context) {
  const states = page?._intentStates, view = page?.view;
  if (!(states instanceof Map) || states.size > 4 || !Array.isArray(view) || view.length !== 4 || !view.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = view;
  if (x1 <= x0 || y1 <= y0) return null;
  let list;
  for (const state of states.values()) {
    if (!state.displayReadyCapability || !state.operatorList?.lastChunk) continue;
    if (list) return null; // Do not guess between display/print/annotation states.
    list = state.operatorList;
  }
  if (!list || !Array.isArray(list.fnArray) || !Array.isArray(list.argsArray)) return null;
  const canvas = context.canvas, stack = [];
  let color = '#000000', clip = null;
  try {
    canvas.width = canvas.height = 32;
    context.setTransform(32 / (x1 - x0), 0, 0, -32 / (y1 - y0), -x0 * 32 / (x1 - x0), y1 * 32 / (y1 - y0));
    for (let i = 0; i < Math.min(48, list.fnArray.length); i++) {
      const fn = list.fnArray[i], args = list.argsArray[i];
      if (fn === ops.save) {
        if (stack.length >= 8 || clip) return null;
        stack.push(color); context.save();
      } else if (fn === ops.restore) {
        if (!stack.length || clip) return null;
        color = stack.pop(); context.restore();
      } else if (fn === ops.setFillRGBColor) {
        if (!/^#[0-9a-f]{6}$/i.test(args?.[0])) return null;
        color = args[0];
      } else if (fn === ops.clip || fn === ops.eoClip) {
        if (clip) return null;
        clip = fn === ops.clip ? 'nonzero' : 'evenodd';
      } else if (fn === ops.constructPath) {
        const [paint, paths, box] = args || [], path = paths?.[0];
        if (!path) return null;
        if (paint === ops.endPath && clip) { context.clip(path, clip); clip = null; continue; }
        if (paint === ops.endPath) continue; // Discarded path; no pixels or clip.
        // The first painted object must itself cover the complete paper.
        // Images, text, transformed paths, blend/alpha/mask operations and
        // groups before it are deliberately unsupported, not silently skipped.
        if (clip || (paint !== ops.fill && paint !== ops.eoFill) || !box || box.length !== 4 ||
            !Array.from(box).every(Number.isFinite) || box[0] > x0 || box[1] > y0 || box[2] < x1 || box[3] < y1) return null;
        const rgb = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));
        const shade = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
        if (Math.max(...rgb) - Math.min(...rgb) > 6 || shade >= 127.5) return null;
        // Bounding boxes alone do not prove coverage: a ring, a triangle or a
        // clipped rectangle can have the same bounds. Rasterize just this
        // cached path with its preceding clips into the existing tiny scratch.
        context.fillStyle = '#fff'; context.fill(path, paint === ops.eoFill ? 'evenodd' : 'nonzero');
        const data = context.getImageData(0, 0, 32, 32).data;
        for (let pixel = 3; pixel < data.length; pixel += 4) if (data[pixel] !== 255) return null;
        return shade;
      } else if (fn === ops.transform) {
        // Some producers start every page with an identity transform.
        // Non-identity transforms still require a more complete graphics model.
        if (!Array.isArray(args) || args.length !== 6 ||
            !args.every((value, at) => value === [1, 0, 0, 1, 0, 0][at])) return null;
      } else if (![ops.dependency, ops.beginText, ops.endText, ops.setFont, ops.setLeading].includes(fn)) return null;
      // Empty text/font initialization cannot paint. Actual showText, text
      // clipping modes and all other unknown graphics operations reject here.
    }
    return null;
  } catch { return null; }
  finally { canvas.width = canvas.height = 0; }
}

// Full-page background images are common in exported slide decks. Read the
// already-decoded image and rasterize its existing transform/clip at 32px;
// never fetch/decode an image or start another PDF operator stream here.
export function renderedPaperBackground(page, ops, context, rotation = page?.rotate || 0) {
  const shade = renderedPaperShade(page, ops, context);
  if (shade !== null) return shade;
  const states = page?._intentStates, view = page?.view;
  if (!(states instanceof Map) || states.size > 4 || !Array.isArray(view) || view.length !== 4 || !view.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = view;
  if (x1 <= x0 || y1 <= y0) return null;
  let list;
  for (const state of states.values()) {
    if (!state.displayReadyCapability || !state.operatorList?.lastChunk) continue;
    if (list) return null;
    list = state.operatorList;
  }
  if (!Array.isArray(list?.fnArray) || !Array.isArray(list.argsArray)) return null;
  let depth = 0, clip = null;
  try {
    context.canvas.width = context.canvas.height = 32;
    if (!Number.isFinite(rotation) || rotation % 90) return null;
    const viewport = page.getViewport?.({ scale: 1, rotation });
    if (viewport) {
      if (!(viewport.width > 0 && viewport.height > 0) || !viewport.transform?.every(Number.isFinite)) return null;
      const [a, b, c, d, e, f] = viewport.transform, sx = 32 / viewport.width, sy = 32 / viewport.height;
      context.setTransform(a * sx, b * sy, c * sx, d * sy, e * sx, f * sy);
    } else {
      if (rotation) return null;
      context.setTransform(32 / (x1 - x0), 0, 0, -32 / (y1 - y0), -x0 * 32 / (x1 - x0), y1 * 32 / (y1 - y0));
    }
    for (let i = 0; i < Math.min(48, list.fnArray.length); i++) {
      const fn = list.fnArray[i], args = list.argsArray[i];
      if (fn === ops.save) {
        if (++depth > 8 || clip) return null;
        context.save();
      } else if (fn === ops.restore) {
        if (!depth-- || clip) return null;
        context.restore();
      } else if (fn === ops.transform) {
        if (!Array.isArray(args) || args.length !== 6 || !args.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return null;
        context.transform(...args);
      } else if (fn === ops.clip || fn === ops.eoClip) {
        if (clip) return null;
        clip = fn === ops.clip ? 'nonzero' : 'evenodd';
      } else if (fn === ops.constructPath) {
        const [paint, paths] = args || [];
        if (paint !== ops.endPath || !paths?.[0]) return null; // A prior paint is not a paper-image background.
        if (clip) { context.clip(paths[0], clip); clip = null; }
      } else if (fn === ops.setGState) {
        if (!Array.isArray(args?.[0]) || !args[0].every(([name, value]) =>
          name === 'BM' && value === 'source-over' || ['ca', 'CA'].includes(name) && value === 1)) return null;
      } else if (fn === ops.paintImageXObject) {
        if (clip || typeof args?.[0] !== 'string') return null;
        const objects = page.objs?.has(args[0]) ? page.objs : page.commonObjs?.has(args[0]) ? page.commonObjs : null;
        const image = objects?.get(args[0]);
        if (!image?.bitmap || !image.width || !image.height) return null;
        context.scale(1, -1);
        context.drawImage(image.bitmap, 0, -1, 1, 1);
        const sample = context.getImageData(0, 0, 32, 32);
        // Require an entirely dark opaque bed, including every edge. A white
        // margin/panel, clipped/inset image, or bright photograph fails here.
        let total = 0;
        for (let at = 0; at < sample.data.length; at += 4) {
          const r = sample.data[at], g = sample.data[at + 1], b = sample.data[at + 2];
          const luminance = .2126 * r + .7152 * g + .0722 * b;
          if (sample.data[at + 3] !== 255 || Math.max(r, g, b) > 128 || luminance > 80) return null;
          total += luminance;
        }
        if (total / 1024 > 55) return null;
        return { kind: 'image', data: sample.data, width: 32, height: 32 };
      } else if (![ops.dependency, ops.beginMarkedContent, ops.beginMarkedContentProps, ops.endMarkedContent,
        ops.beginText, ops.endText, ops.setFont, ops.setLeading].includes(fn)) return null;
    }
    return null;
  } catch { return null; }
  finally { context.canvas.width = context.canvas.height = 0; }
}
