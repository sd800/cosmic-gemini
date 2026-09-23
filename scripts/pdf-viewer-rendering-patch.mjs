// Narrow, reproducible patch to pdfjs-dist@6.3.289's reusable viewer only.
// Keep the parser/worker untouched. Fail closed if upstream patch points change.
export function patchPdfViewer(source) {
  function replace(before, after, count = 1) {
    if (source.split(before).length - 1 !== count) throw Error('PDF viewer rendering patch no longer matches: ' + before);
    source = source.replaceAll(before, after);
  }
  replace('const DEFAULT_CACHE_SIZE = 10;', 'const DEFAULT_CACHE_SIZE = 4;');
  replace('    this.maxCanvasPixels = options.maxCanvasPixels',
    '    this.getRenderPixelRatio = options.getRenderPixelRatio || (() => OutputScale.pixelRatio);\n    this.maxCanvasPixels = options.maxCanvasPixels', 2);
  replace('    this.maxCanvasDim = options.maxCanvasDim',
    '    this.maxDetailCanvasPixels = options.maxDetailCanvasPixels ?? this.maxCanvasPixels;\n    this.maxCanvasDim = options.maxCanvasDim', 2);
  for (const indent of ['      ', '          ']) {
    replace('\n' + indent + 'maxCanvasPixels: this.maxCanvasPixels,',
      '\n' + indent + 'getRenderPixelRatio: this.getRenderPixelRatio,\n' + indent + 'maxDetailCanvasPixels: this.maxDetailCanvasPixels,\n' + indent + 'maxCanvasPixels: this.maxCanvasPixels,');
  }
  // The deliberately small base budget already bounds cached previews. Keep
  // them readable while scrolling instead of reducing their density again.
  replace('const factor = this.enableOptimizedPartialRendering ? 4 : 2;',
    'const factor = this.maxDetailCanvasPixels > this.maxCanvasPixels ? 1 : this.enableOptimizedPartialRendering ? 4 : 2;');
  // getVisibleElements uses null for a fully visible page, whereas the page
  // view uses null to remove detail. Fully visible/fit pages still need supersampled detail.
  replace('      view.updateVisibleArea(visibleArea);', `      view.updateVisibleArea(visibleArea || {
        minX: 0, minY: 0, maxX: view.viewport.width, maxY: view.viewport.height
      });`);
  replace('    const outputScale = this.outputScale = new OutputScale();',
    '    const outputScale = this.outputScale = new OutputScale();\n    outputScale.sx = outputScale.sy = this.getRenderPixelRatio();');
  replace('    const sfy = approximateFraction(outputScale.sy);', `    const sfy = approximateFraction(outputScale.sy);
    // A coarse base preview must not snap the entire page (and its high-res
    // detail/text layers) to an eight-CSS-pixel grid at fractional zoom.
    if (this.#hasRestrictedScaling && this.enableDetailCanvas) {
      sfx[1] = sfy[1] = 1;
    }`);
  // Detail renders must use the same sampling density as full pages. Limit
  // density when even the visible rectangle would exceed the canvas budget.
  replace('      maxCanvasPixels,\n      capCanvasAreaFactor\n    } = this.pageView;',
    '      maxDetailCanvasPixels: maxCanvasPixels,\n      capCanvasAreaFactor\n    } = this.pageView;');
  replace('    const visiblePixels = visibleWidth * visibleHeight * OutputScale.pixelRatio ** 2;', `    const pixelBudget = OutputScale.capPixels(maxCanvasPixels, capCanvasAreaFactor);
    // Leave room around the viewport so small scrolls can reuse this canvas.
    const pixelRatio = Math.min(this.pageView.getRenderPixelRatio(),
      Math.sqrt(pixelBudget / (visibleWidth * visibleHeight * 1.25)),
      this.pageView.maxCanvasDim / visibleWidth, this.pageView.maxCanvasDim / visibleHeight);
    const visiblePixels = visibleWidth * visibleHeight * pixelRatio ** 2;`);
  replace('    this.#detailArea = {\n      minX,', '    this.#detailArea = {\n      pixelRatio,\n      minX,');
  replace('    const overflowWidth = visibleWidth * overflowScale;\n    const overflowHeight = visibleHeight * overflowScale;',
    `    const maxDimension = this.pageView.maxCanvasDim / pixelRatio;
    const overflowWidth = Math.min(visibleWidth * overflowScale, Math.max(0, (maxDimension - visibleWidth) / 2));
    const overflowHeight = Math.min(visibleHeight * overflowScale, Math.max(0, (maxDimension - visibleHeight) / 2));`);
  replace(`    const {
      pixelRatio
    } = OutputScale;
    const transform = [pixelRatio, 0, 0, pixelRatio, -area.minX * pixelRatio, -area.minY * pixelRatio];
    canvas.width = area.width * pixelRatio;
    canvas.height = area.height * pixelRatio;`, `    const { pixelRatio } = area;
    canvas.width = Math.max(1, Math.floor(area.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(area.height * pixelRatio));
    // Integer backing dimensions must map to the exact CSS rectangle, avoiding
    // a second fractional squeeze of small glyphs and fine rules.
    const sx = canvas.width / area.width, sy = canvas.height / area.height;
    const transform = [sx, 0, 0, sy, -area.minX * sx, -area.minY * sy];`);
  return source;
}
