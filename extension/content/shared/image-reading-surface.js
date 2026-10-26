// Site-neutral, bounded pixel classifier. Product lifecycles remain independent.
(() => {
  const key = Symbol.for('cosmic-gemini.image-reading-surface');
  if (globalThis[key]) return;
  const COLOR_BUCKETS = 8;
  const luminance = color => (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  const classifier = {
    classify(data, width, height) {
      const pixelCount = Math.min(width * height, Math.floor(data.length / 4));
      if (!pixelCount) return { kind: 'photo' };
      const buckets = new Map();
      const edgeBuckets = new Map();
      const rowOpaque = new Uint16Array(height);
      const rowLightSurface = new Uint16Array(height);
      const rowDarkSurface = new Uint16Array(height);
      const edgeBand = Math.max(1, Math.round(Math.min(width, height) * 0.08));
      let opaque = 0;
      let edgeOpaque = 0;
      let transparent = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const alpha = data[offset + 3] / 255;
        if (alpha < 0.95) transparent += 1;
        const r = Math.round(data[offset] * alpha + 255 * (1 - alpha));
        const g = Math.round(data[offset + 1] * alpha + 255 * (1 - alpha));
        const b = Math.round(data[offset + 2] * alpha + 255 * (1 - alpha));
        const key = (Math.min(COLOR_BUCKETS - 1, r >> 5) << 6)
          | (Math.min(COLOR_BUCKETS - 1, g >> 5) << 3)
          | Math.min(COLOR_BUCKETS - 1, b >> 5);
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
        rowOpaque[y] += 1;
        const pixelValue = luminance({ r, g, b });
        const pixelChroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        if (pixelValue >= 0.72 && pixelChroma <= 0.32) rowLightSurface[y] += 1;
        if (pixelValue <= 0.28 && pixelChroma <= 0.18) rowDarkSurface[y] += 1;
        opaque += 1;
        if (x < edgeBand || x >= width - edgeBand || y < edgeBand || y >= height - edgeBand) {
          edgeBuckets.set(key, (edgeBuckets.get(key) || 0) + 1);
          edgeOpaque += 1;
        }
      }
      if (!buckets.size) return { kind: 'photo' };
      const colors = [...buckets.entries()]
        .map(bucket => {
          const [key, value] = bucket;
          const color = {
            r: value.r / value.count,
            g: value.g / value.count,
            b: value.b / value.count
          };
          return {
            key,
            ...color,
            count: value.count,
            share: value.count / opaque,
            value: luminance(color),
            chroma: (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / 255
          };
        });
      const colorsByShare = [...colors].sort((a, b) => b.count - a.count);
      const lightSurfaces = colorsByShare
        .filter(color => color.share >= 0.02 && color.value >= 0.64 && color.chroma <= 0.42)
        .slice(0, 4);
      const lightBackground = lightSurfaces.find(color => color.share >= 0.12
        && color.value >= 0.72 && color.chroma <= 0.32);
      const grayBackground = colorsByShare.find(color => color.share >= 0.48
        && color.value >= 0.3 && color.value <= 0.68 && color.chroma <= 0.14);
      const vividBackground = !lightBackground && !grayBackground
        ? colorsByShare.find(color => color.share >= 0.58
          && color.value >= 0.52 && color.chroma <= 0.72)
        : null;
      const darkPanel = lightBackground && colorsByShare.find(color => color.key !== lightBackground.key
        && color.share >= 0.12 && color.value <= 0.28 && color.chroma <= 0.18);
      const strongestPanelShare = counts => {
        const panelRows = Math.max(3, Math.round(height * 0.14));
        let panelPixels = 0;
        let panelOpaque = 0;
        let strongest = 0;
        for (let y = 0; y < height; y += 1) {
          panelPixels += counts[y];
          panelOpaque += rowOpaque[y];
          if (y >= panelRows) {
            panelPixels -= counts[y - panelRows];
            panelOpaque -= rowOpaque[y - panelRows];
          }
          if (y + 1 >= panelRows && panelOpaque) {
            strongest = Math.max(strongest, panelPixels / panelOpaque);
          }
        }
        return strongest;
      };
      const lightPanelShare = strongestPanelShare(rowLightSurface);
      const darkPanelShare = strongestPanelShare(rowDarkSurface);
      const splitToneLayout = !!(lightBackground && darkPanel
        && lightBackground.share + darkPanel.share >= 0.62
        && lightPanelShare >= 0.72
        && darkPanelShare >= 0.48);
      const background = lightBackground || grayBackground || vividBackground;
      if (!background) return { kind: 'photo' };
      const grayCard = !lightBackground && background === grayBackground;
      const vividCard = !lightBackground && !grayCard && background === vividBackground;
      const backgroundLuminance = luminance(background);
      const annotationSurfaces = lightBackground?.share >= 0.58
        ? colorsByShare.filter(color => color.key !== lightBackground.key
          && color.share >= 0.008 && color.share <= 0.18
          && color.value >= Math.max(0.62, backgroundLuminance - 0.28)
          && color.chroma >= 0.18 && color.chroma <= 0.78).slice(0, 3)
        : [];
      const annotationShare = annotationSurfaces.reduce((total, color) => total + color.share, 0);
      const annotatedCard = annotationShare >= 0.03 && annotationShare <= 0.24;
      let frame = null;
      if (edgeOpaque) {
        let edgeDominantKey = null;
        let edgeDominantCount = 0;
        for (const [key, count] of edgeBuckets) {
          if (count > edgeDominantCount) {
            edgeDominantKey = key;
            edgeDominantCount = count;
          }
        }
        const candidate = colors.find(color => color.key === edgeDominantKey);
        if (candidate) {
          const dr = (candidate.r - background.r) / 255;
          const dg = (candidate.g - background.g) / 255;
          const db = (candidate.b - background.b) / 255;
          const distance = dr * dr + dg * dg + db * db;
          const edgeShare = edgeDominantCount / edgeOpaque;
          if (edgeShare >= 0.42 && candidate.share >= 0.025 && distance >= 0.025) {
            frame = { ...candidate, edgeShare };
          }
        }
      }
      const conversationSurfaceCandidates = lightBackground
        ? colorsByShare.filter(color => {
          if (color.key === lightBackground.key
            || color.share < 0.025 || color.share > 0.38
            || color.value < 0.54 || color.chroma < 0.16 || color.chroma > 0.75) return false;
          const dr = (color.r - lightBackground.r) / 255;
          const dg = (color.g - lightBackground.g) / 255;
          const db = (color.b - lightBackground.b) / 255;
          return dr * dr + dg * dg + db * db >= 0.025;
        }).slice(0, 3)
        : [];
      const conversationSurfaceShare = conversationSurfaceCandidates
        .reduce((total, color) => total + color.share, 0);
      let conversationLayout = false;
      let conversationSurfaceComponents = { count: 0, largestShare: 0 };
      if (conversationSurfaceShare >= 0.06 && conversationSurfaceShare <= 0.4) {
        const conversationMask = new Uint8Array(pixelCount);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const offset = pixel * 4;
          const alpha = data[offset + 3] / 255;
          const color = {
            r: Math.round(data[offset] * alpha + 255 * (1 - alpha)),
            g: Math.round(data[offset + 1] * alpha + 255 * (1 - alpha)),
            b: Math.round(data[offset + 2] * alpha + 255 * (1 - alpha))
          };
          if (conversationSurfaceCandidates.some(surface => {
            const dr = (color.r - surface.r) / 255;
            const dg = (color.g - surface.g) / 255;
            const db = (color.b - surface.b) / 255;
            return dr * dr + dg * dg + db * db <= 0.045;
          })) conversationMask[pixel] = 1;
        }
        conversationSurfaceComponents = this.componentStats(conversationMask, width, height, opaque);
        conversationLayout = conversationSurfaceComponents.count >= 3
          && conversationSurfaceComponents.largestShare <= 0.16;
      }
      const surfacePalette = grayCard
        ? colorsByShare.filter(color => color.share >= 0.02
          && color.chroma <= 0.18 && Math.abs(color.value - backgroundLuminance) <= 0.16).slice(0, 4)
        : vividCard
          ? colorsByShare.filter(color => {
            const dr = (color.r - background.r) / 255;
            const dg = (color.g - background.g) / 255;
            const db = (color.b - background.b) / 255;
            return color.share >= 0.006
              && dr * dr + dg * dg + db * db <= 0.06
              && Math.abs(color.value - backgroundLuminance) <= 0.22;
          }).slice(0, 6)
          : [...lightSurfaces];
      if (conversationLayout) {
        for (const surface of conversationSurfaceCandidates) {
          if (!surfacePalette.some(existing => existing.key === surface.key)) surfacePalette.push(surface);
        }
      }
      if (annotatedCard) {
        for (const annotation of annotationSurfaces) {
          if (!surfacePalette.some(surface => surface.key === annotation.key)) surfacePalette.push(annotation);
        }
      }
      if (frame && !surfacePalette.some(surface => surface.key === frame.key)) surfacePalette.push(frame);
      if (splitToneLayout && !surfacePalette.some(surface => surface.key === darkPanel.key)) {
        surfacePalette.push(darkPanel);
      }
      const foregroundMask = new Uint8Array(pixelCount);
      let surfaceCount = 0;
      let lightCount = 0;
      let contrastForegroundCount = 0;
      let foregroundCount = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        const alpha = data[offset + 3] / 255;
        const color = {
          r: Math.round(data[offset] * alpha + 255 * (1 - alpha)),
          g: Math.round(data[offset + 1] * alpha + 255 * (1 - alpha)),
          b: Math.round(data[offset + 2] * alpha + 255 * (1 - alpha))
        };
        const value = luminance(color);
        if (value >= 0.64) lightCount += 1;
        const nearSurface = surfacePalette.some(surface => {
          const dr = (color.r - surface.r) / 255;
          const dg = (color.g - surface.g) / 255;
          const db = (color.b - surface.b) / 255;
          return dr * dr + dg * dg + db * db <= 0.045
            && Math.abs(value - surface.value) <= 0.18;
        });
        if (nearSurface) {
          surfaceCount += 1;
        } else {
          foregroundMask[pixel] = 1;
          foregroundCount += 1;
          if (splitToneLayout
            || (grayCard
              ? value >= backgroundLuminance + 0.22
              : vividCard
                ? Math.abs(value - backgroundLuminance) >= 0.22
                : value <= backgroundLuminance - 0.22)) {
            contrastForegroundCount += 1;
          }
        }
      }
      const surfaceShare = surfaceCount / opaque;
      const foregroundShare = foregroundCount / opaque;
      const lightShare = lightCount / opaque;
      const contrastForegroundShare = contrastForegroundCount / opaque;
      const transparencyShare = transparent / pixelCount;
      const foregroundComponents = this.componentStats(foregroundMask, width, height, opaque);
      const largestForegroundShare = foregroundComponents.largestShare;
      const uniformLightSurface = !grayCard && !vividCard && surfacePalette.length > 0
        && surfaceShare >= 0.72
        && lightShare >= (splitToneLayout ? 0.24 : frame ? 0.5 : 0.72);
      const uniformGraySurface = grayCard
        && surfacePalette.length > 0
        && surfaceShare >= 0.72;
      const uniformVividSurface = vividCard
        && surfacePalette.length > 0
        && surfaceShare >= 0.72;
      const regularTextForeground = foregroundShare >= 0.008
        && foregroundShare <= 0.32
        && contrastForegroundShare >= 0.006
        && largestForegroundShare <= 0.16;
      const sparseTextForeground = !grayCard && !vividCard
        && surfaceShare >= 0.985
        && backgroundLuminance >= 0.9
        && foregroundShare >= 0.005
        && foregroundShare < 0.008
        && contrastForegroundShare >= 0.004
        && foregroundComponents.count >= 3
        && largestForegroundShare <= 0.006;
      const textLikeForeground = regularTextForeground || sparseTextForeground;
      const vividTextStructure = !vividCard
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.08);
      const annotationTextStructure = !annotatedCard
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.12);
      const conversationTextStructure = !conversationLayout
        || (foregroundComponents.count >= 5 && largestForegroundShare <= 0.08);
      const transparentTextStructure = transparencyShare < 0.1
        || (foregroundComponents.count >= 3 && largestForegroundShare <= 0.12);
      return {
        kind: textLikeForeground && vividTextStructure && annotationTextStructure
          && conversationTextStructure && transparentTextStructure
          && (uniformLightSurface || uniformGraySurface || uniformVividSurface)
          ? grayCard ? 'gray-theme' : 'light-theme'
          : 'photo',
        backgroundShare: surfaceShare,
        surfaceCount: surfacePalette.length,
        frameDetected: frame !== null,
        splitToneLayout,
        frameEdgeShare: frame?.edgeShare || 0,
        foregroundShare,
        contrastForegroundShare,
        sparseTextForeground,
        backgroundLuminance,
        annotationShare,
        conversationLayout,
        conversationSurfaceShare,
        conversationSurfaceComponentCount: conversationSurfaceComponents.count,
        transparencyShare,
        largestForegroundShare,
        foregroundComponentCount: foregroundComponents.count
      };
    },

    componentStats(mask, width, height, opaque) {
      const visited = new Uint8Array(mask.length);
      const stack = [];
      let largest = 0;
      let count = 0;
      for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || visited[start]) continue;
        count += 1;
        visited[start] = 1;
        stack.push(start);
        let size = 0;
        while (stack.length) {
          const pixel = stack.pop();
          size += 1;
          const x = pixel % width;
          const left = pixel - 1;
          const right = pixel + 1;
          const up = pixel - width;
          const down = pixel + width;
          if (x > 0 && mask[left] && !visited[left]) { visited[left] = 1; stack.push(left); }
          if (x + 1 < width && mask[right] && !visited[right]) { visited[right] = 1; stack.push(right); }
          if (up >= 0 && mask[up] && !visited[up]) { visited[up] = 1; stack.push(up); }
          if (down < mask.length && mask[down] && !visited[down]) { visited[down] = 1; stack.push(down); }
        }
        largest = Math.max(largest, size);
      }
      return { count, largestShare: largest / Math.max(opaque, 1) };
    }
  };
  Object.defineProperty(globalThis, key, {value: Object.freeze(classifier), configurable: true});
})();
