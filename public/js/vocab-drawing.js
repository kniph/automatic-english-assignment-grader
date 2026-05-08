class VocabCanvasSurface {
  constructor(options) {
    this.mount = options.mount;
    this.backgroundBase64 = options.backgroundBase64 || '';
    this.width = options.width || 0;
    this.height = options.height || 0;
    this.maxDisplayWidth = options.maxDisplayWidth || null;
    this.onInteraction = options.onInteraction || (() => {});
    this.guideBoxes = Array.isArray(options.guideBoxes) ? options.guideBoxes : [];
    this.traceGuides = Array.isArray(options.traceGuides) ? options.traceGuides : [];

    this.backgroundImage = null;
    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.history = [];
    this.tool = 'pen';
    this.color = '#111111';
    this.strokeSize = 3;
    this.zoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 1;
    this.minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : 0.45;
    this.maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : 2.4;
    this.activePointers = new Map();
    this.activeDrawPointerId = null;
    this.touchScroll = null;
    this.pageScroller = document.scrollingElement || document.documentElement;

    this.mount.style.overflowX = 'auto';
    this.mount.style.overflowY = 'hidden';
    this.mount.style.paddingBottom = '0.35rem';

    this.shell = document.createElement('div');
    this.shell.style.position = 'relative';
    this.shell.style.margin = '0 auto';
    this.shell.style.background = '#ffffff';
    this.shell.style.borderRadius = '16px';
    this.shell.style.boxShadow = '0 10px 30px rgba(10, 27, 51, 0.08)';
    this.shell.style.overflow = 'hidden';
    this.shell.style.webkitUserSelect = 'none';
    this.shell.style.userSelect = 'none';
    this.shell.style.webkitTouchCallout = 'none';
    this.shell.style.webkitTapHighlightColor = 'transparent';

    this.bgCanvas = document.createElement('canvas');
    this.guideCanvas = document.createElement('canvas');
    this.drawCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.guideCtx = this.guideCanvas.getContext('2d');
    this.drawCtx = this.drawCanvas.getContext('2d');

    [this.bgCanvas, this.guideCanvas, this.drawCanvas].forEach(canvas => {
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    });

    this.bgCanvas.style.position = 'absolute';
    this.bgCanvas.style.inset = '0';
    this.bgCanvas.style.zIndex = '0';

    this.guideCanvas.style.position = 'absolute';
    this.guideCanvas.style.inset = '0';
    this.guideCanvas.style.zIndex = '1';
    this.guideCanvas.style.pointerEvents = 'none';

    this.drawCanvas.style.position = 'absolute';
    this.drawCanvas.style.inset = '0';
    this.drawCanvas.style.zIndex = '2';
    this.drawCanvas.style.touchAction = 'none';
    this.drawCanvas.style.cursor = 'crosshair';
    this.drawCanvas.style.webkitUserSelect = 'none';
    this.drawCanvas.style.userSelect = 'none';
    this.drawCanvas.style.webkitTouchCallout = 'none';
    this.drawCanvas.style.webkitTapHighlightColor = 'transparent';

    this.bgCanvas.style.pointerEvents = 'none';
    this.bgCanvas.style.webkitUserSelect = 'none';
    this.bgCanvas.style.userSelect = 'none';
    this.bgCanvas.style.webkitTouchCallout = 'none';

    this.shell.appendChild(this.bgCanvas);
    this.shell.appendChild(this.guideCanvas);
    this.shell.appendChild(this.drawCanvas);
    this.mount.innerHTML = '';
    this.mount.appendChild(this.shell);
  }

  async init() {
    if (this.backgroundBase64) {
      await this.loadBackground(this.backgroundBase64);
    } else {
      this.setupCanvas(this.width, this.height);
      this.bgCtx.fillStyle = '#ffffff';
      this.bgCtx.fillRect(0, 0, this.width, this.height);
    }

    this.bindEvents();
    this.fitToContainer();
    this.saveHistory();
    window.addEventListener('resize', () => this.fitToContainer());
  }

  loadBackground(base64) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.backgroundImage = image;
        this.setupCanvas(image.naturalWidth, image.naturalHeight);
        this.bgCtx.drawImage(image, 0, 0, this.width, this.height);
        resolve();
      };
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
  }

  setupCanvas(width, height) {
    this.width = width;
    this.height = height;
    this.bgCanvas.width = width;
    this.bgCanvas.height = height;
    this.guideCanvas.width = width;
    this.guideCanvas.height = height;
    this.drawCanvas.width = width;
    this.drawCanvas.height = height;
    this.drawGuides();
  }

  fitToContainer() {
    const parentWidth = this.mount.clientWidth || this.width;
    const targetWidth = this.maxDisplayWidth
      ? Math.min(parentWidth, this.maxDisplayWidth)
      : Math.min(parentWidth, this.width);
    const baseScale = targetWidth / this.width;
    const scale = baseScale * this.zoom;
    const displayWidth = Math.max(120, Math.round(this.width * scale));
    const displayHeight = Math.max(120, Math.round(this.height * scale));

    this.shell.style.width = `${displayWidth}px`;
    this.shell.style.height = `${displayHeight}px`;
  }

  drawGuides() {
    if (!this.guideCtx) return;
    this.guideCtx.clearRect(0, 0, this.width, this.height);

    if (this.guideBoxes.length) {
      this.guideCtx.save();
      this.guideCtx.setLineDash([14, 10]);
      this.guideCtx.lineWidth = 3;
      this.guideCtx.strokeStyle = 'rgba(31, 122, 224, 0.9)';
      this.guideCtx.fillStyle = 'rgba(31, 122, 224, 0.06)';

      for (const guide of this.guideBoxes) {
        const box = guide.answer_box || guide;
        const x = Number(box.x) || 0;
        const y = Number(box.y) || 0;
        const width = Number(box.width) || 0;
        const height = Number(box.height) || 0;
        if (width <= 0 || height <= 0) continue;

        this.guideCtx.fillRect(x, y, width, height);
        this.guideCtx.strokeRect(x, y, width, height);

        const label = `Q${guide.question_number || ''}`.trim();
        if (!label || !this.guideCtx.fillText) continue;
        const labelX = x + 6;
        const labelY = Math.max(16, y - 8);

        this.guideCtx.save();
        this.guideCtx.setLineDash([]);
        this.guideCtx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
        const metrics = this.guideCtx.measureText(label);
        const pillWidth = Math.ceil(metrics.width + 12);
        this.guideCtx.fillStyle = 'rgba(31, 122, 224, 0.95)';
        this.guideCtx.fillRect(labelX - 4, labelY - 14, pillWidth, 18);
        this.guideCtx.fillStyle = '#ffffff';
        this.guideCtx.fillText(label, labelX, labelY);
        this.guideCtx.restore();
      }

      this.guideCtx.restore();
    }

    this.drawTraceGuides();
  }

  drawTraceGuides() {
    if (!this.traceGuides.length) return;

    this.guideCtx.save();

    for (const guide of this.traceGuides) {
      const text = String(guide.text || '').trim();
      const mode = String(guide.mode || 'dots').trim().toLowerCase();
      if (!text || mode === 'none') continue;

      const sourceBox = guide.box || guide.answer_box || {};
      const x = Number(sourceBox.x) || 0;
      const y = Number(sourceBox.y) || 0;
      const width = Number(sourceBox.width) || this.width;
      const height = Number(sourceBox.height) || this.height;
      if (width <= 0 || height <= 0) continue;

      const boxPadding = Math.max(12, Math.round(Math.min(width, height) * 0.1));
      const maxTextWidth = Math.max(40, width - (boxPadding * 2));
      const maxTextHeight = Math.max(40, height - (boxPadding * 2));
      this.drawDottedTraceText(this.guideCtx, text, {
        x: x + boxPadding,
        y: y + boxPadding,
        width: maxTextWidth,
        height: maxTextHeight
      });
    }

    this.guideCtx.restore();
  }

  drawDottedTraceText(ctx, text, box) {
    let fontSize = Math.min(Math.round(box.height * 0.6), 78);
    fontSize = Math.max(24, fontSize);
    let layout = null;

    while (fontSize >= 20) {
      layout = this.layoutTraceText(text, fontSize, box.width, box.height);
      if (layout.fits) break;
      fontSize -= 2;
    }

    if (!layout) return;

    const dotRadius = Math.max(1.9, Math.min(4.6, fontSize * 0.042));
    const dotSpacing = Math.max(6.2, fontSize * 0.13);
    const lineHeight = fontSize * 1.2;
    const totalHeight = layout.lines.length * lineHeight;
    const startY = box.y + Math.max(0, (box.height - totalHeight) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(78, 94, 112, 0.46)';

    layout.lines.forEach((line, lineIndex) => {
      const lineWidth = this.estimateTraceTextWidth(line, fontSize);
      const lineX = box.x + Math.max(0, (box.width - lineWidth) / 2);
      const visualTop = startY + (lineIndex * lineHeight) + ((lineHeight - fontSize) / 2);
      const baselineY = visualTop + (fontSize * 0.9);
      const lineTop = baselineY - (fontSize * 0.9);

      this.drawTraceWritingLines(ctx, box.x, baselineY, box.width, fontSize);
      this.drawDottedTraceLine(ctx, line, lineX, lineTop, fontSize, dotSpacing, dotRadius);
    });

    ctx.restore();
  }

  layoutTraceText(text, fontSize, maxWidth, maxHeight) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const words = normalized.split(' ').filter(Boolean);
    const lines = [];

    if (words.length <= 1) {
      lines.push(normalized);
    } else {
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && this.estimateTraceTextWidth(candidate, fontSize) > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
    }

    const widest = lines.reduce((max, line) => Math.max(max, this.estimateTraceTextWidth(line, fontSize)), 0);
    const totalHeight = lines.length * fontSize * 1.2;
    return {
      lines,
      fits: widest <= maxWidth && totalHeight <= maxHeight
    };
  }

  estimateTraceTextWidth(text, fontSize) {
    return Array.from(String(text || '')).reduce((total, char) => {
      return total + (this.getTraceCharWidth(char) * fontSize) + (fontSize * 0.08);
    }, 0);
  }

  getTraceCharWidth(char) {
    if (char === ' ') return 0.48;
    if (/['.,:;]/.test(char)) return 0.26;
    if (/[ilIj1!]/.test(char)) return 0.34;
    if (/[mwMW]/.test(char)) return 1.08;
    if (/[ftjr]/.test(char)) return 0.54;
    return 0.78;
  }

  drawTraceWritingLines(ctx, x, baselineY, width, fontSize) {
    ctx.save();
    ctx.lineWidth = Math.max(1, fontSize * 0.012);
    ctx.setLineDash([]);

    [
      { y: baselineY - (fontSize * 0.78), alpha: 0.12 },
      { y: baselineY - (fontSize * 0.38), alpha: 0.15 },
      { y: baselineY, alpha: 0.28 }
    ].forEach(line => {
      ctx.strokeStyle = `rgba(68, 132, 168, ${line.alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, line.y);
      ctx.lineTo(x + width, line.y);
      ctx.stroke();
    });

    ctx.restore();
  }

  drawDottedTraceLine(ctx, text, x, y, fontSize, dotSpacing, dotRadius) {
    let cursorX = x;
    Array.from(String(text || '')).forEach(char => {
      const charWidth = this.getTraceCharWidth(char) * fontSize;
      if (char === ' ') {
        cursorX += charWidth + (fontSize * 0.08);
        return;
      }

      this.drawDottedTraceGlyph(ctx, char, cursorX, y, charWidth, fontSize, dotSpacing, dotRadius);
      cursorX += charWidth + (fontSize * 0.08);
    });
  }

  drawDottedTraceGlyph(ctx, char, x, y, width, height, dotSpacing, dotRadius) {
    const glyph = this.getTraceGlyph(char);
    if (!glyph.length) return;

    glyph.forEach(stroke => {
      if (stroke.length === 1) {
        this.drawTraceDot(ctx, x + stroke[0][0] * width, y + stroke[0][1] * height, dotRadius * 1.08);
        return;
      }

      const points = stroke.map(point => [x + point[0] * width, y + point[1] * height]);
      this.drawDotsAlongStroke(ctx, points, dotSpacing, dotRadius);
    });
  }

  drawDotsAlongStroke(ctx, points, spacing, radius) {
    let carry = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length <= 0) continue;

      let distance = index === 0 ? 0 : spacing - carry;
      while (distance <= length) {
        const ratio = distance / length;
        this.drawTraceDot(ctx, x1 + dx * ratio, y1 + dy * ratio, radius);
        distance += spacing;
      }
      carry = length - (distance - spacing);
      if (carry < 0 || carry >= spacing) carry = 0;
    }
  }

  drawTraceDot(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  getTraceGlyph(char) {
    const lower = String(char || '').toLowerCase();
    const arc = (cx, cy, rx, ry, start, end, steps = 18) => {
      const points = [];
      for (let index = 0; index <= steps; index += 1) {
        const angle = start + ((end - start) * index / steps);
        points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
      }
      return points;
    };
    const oval = (cx = 0.5, cy = 0.58, rx = 0.32, ry = 0.32) => arc(cx, cy, rx, ry, 0, Math.PI * 2, 24);

    const glyphs = {
      a: [oval(0.47, 0.62, 0.3, 0.28), [[0.76, 0.36], [0.76, 0.9]]],
      b: [[[0.24, 0.12], [0.24, 0.9]], arc(0.51, 0.62, 0.29, 0.28, -Math.PI / 2, Math.PI * 1.5, 22)],
      c: [arc(0.56, 0.6, 0.34, 0.3, Math.PI * 0.18, Math.PI * 1.82, 22)],
      d: [[[0.76, 0.12], [0.76, 0.9]], arc(0.49, 0.62, 0.29, 0.28, Math.PI * 1.5, -Math.PI / 2, 22)],
      e: [arc(0.54, 0.6, 0.34, 0.3, Math.PI * 0.16, Math.PI * 1.86, 22), [[0.22, 0.58], [0.78, 0.58]]],
      f: [[[0.66, 0.14], [0.5, 0.12], [0.42, 0.28], [0.42, 0.92]], [[0.2, 0.42], [0.68, 0.42]]],
      g: [oval(0.48, 0.55, 0.3, 0.25), [[0.76, 0.36], [0.76, 0.88], [0.57, 1.0], [0.32, 0.9]]],
      h: [[[0.24, 0.12], [0.24, 0.9]], [[0.24, 0.56], [0.42, 0.38], [0.73, 0.46], [0.73, 0.9]]],
      i: [[[0.5, 0.42], [0.5, 0.9]], [[0.5, 0.22]]],
      j: [[[0.56, 0.42], [0.56, 0.86], [0.42, 0.98], [0.26, 0.9]], [[0.56, 0.22]]],
      k: [[[0.24, 0.12], [0.24, 0.9]], [[0.73, 0.38], [0.24, 0.64], [0.74, 0.9]]],
      l: [[[0.5, 0.12], [0.5, 0.9]]],
      m: [[[0.16, 0.9], [0.16, 0.42], [0.34, 0.34], [0.5, 0.52], [0.5, 0.9]], [[0.5, 0.52], [0.68, 0.34], [0.84, 0.44], [0.84, 0.9]]],
      n: [[[0.22, 0.9], [0.22, 0.42], [0.43, 0.34], [0.74, 0.46], [0.74, 0.9]]],
      o: [oval(0.5, 0.62, 0.32, 0.28)],
      p: [[[0.24, 0.4], [0.24, 1.0]], arc(0.52, 0.55, 0.29, 0.24, -Math.PI / 2, Math.PI * 1.5, 22)],
      q: [[[0.76, 0.4], [0.76, 1.0]], arc(0.48, 0.55, 0.29, 0.24, Math.PI * 1.5, -Math.PI / 2, 22)],
      r: [[[0.24, 0.9], [0.24, 0.42], [0.45, 0.34], [0.72, 0.42]]],
      s: [[[0.76, 0.42], [0.46, 0.34], [0.23, 0.5], [0.55, 0.63], [0.78, 0.78], [0.43, 0.92], [0.2, 0.82]]],
      t: [[[0.5, 0.18], [0.5, 0.86], [0.62, 0.92]], [[0.24, 0.42], [0.76, 0.42]]],
      u: [[[0.22, 0.42], [0.22, 0.75], [0.36, 0.9], [0.62, 0.9], [0.76, 0.75], [0.76, 0.42]]],
      v: [[[0.18, 0.42], [0.5, 0.9], [0.82, 0.42]]],
      w: [[[0.12, 0.42], [0.32, 0.9], [0.5, 0.58], [0.68, 0.9], [0.88, 0.42]]],
      x: [[[0.2, 0.42], [0.78, 0.9]], [[0.78, 0.42], [0.2, 0.9]]],
      y: [[[0.18, 0.42], [0.5, 0.78], [0.82, 0.42]], [[0.5, 0.78], [0.34, 1.0], [0.18, 0.92]]],
      z: [[[0.18, 0.42], [0.82, 0.42], [0.18, 0.9], [0.82, 0.9]]],
      0: [oval(0.5, 0.52, 0.33, 0.42)],
      1: [[[0.5, 0.14], [0.5, 0.9]], [[0.34, 0.28], [0.5, 0.14], [0.66, 0.28]]],
      2: [[[0.22, 0.34], [0.34, 0.18], [0.64, 0.18], [0.78, 0.36], [0.22, 0.9], [0.82, 0.9]]],
      3: [[[0.22, 0.22], [0.76, 0.22], [0.5, 0.52], [0.76, 0.78], [0.22, 0.9]]],
      4: [[[0.72, 0.12], [0.72, 0.9]], [[0.18, 0.62], [0.84, 0.62]], [[0.18, 0.62], [0.72, 0.12]]],
      5: [[[0.78, 0.18], [0.28, 0.18], [0.22, 0.5], [0.62, 0.5], [0.82, 0.68], [0.64, 0.9], [0.26, 0.86]]],
      6: [arc(0.54, 0.58, 0.31, 0.33, Math.PI * 0.22, Math.PI * 2.1, 25), [[0.68, 0.18], [0.34, 0.54]]],
      7: [[[0.2, 0.18], [0.82, 0.18], [0.4, 0.9]]],
      8: [oval(0.5, 0.34, 0.28, 0.2), oval(0.5, 0.72, 0.31, 0.24)],
      9: [arc(0.48, 0.42, 0.31, 0.24, 0, Math.PI * 2, 23), [[0.7, 0.48], [0.38, 0.9]]],
      '-': [[[0.26, 0.62], [0.74, 0.62]]],
      "'": [[[0.5, 0.12], [0.42, 0.28]]]
    };

    if (/[A-Z]/.test(char) && glyphs[lower]) {
      return glyphs[lower].map(stroke => stroke.map(point => [point[0], Math.max(0.1, point[1] - 0.08)]));
    }
    return glyphs[lower] || [];
  }

  bindEvents() {
    const suppressBrowserSelection = event => {
      event.preventDefault();
      this.clearDocumentSelection();
    };
    const suppressNativeTouch = event => {
      if (event.cancelable) {
        event.preventDefault();
      }
      this.clearDocumentSelection();
    };

    this.drawCanvas.addEventListener('pointerdown', event => this.handlePointerDown(event));
    this.drawCanvas.addEventListener('pointermove', event => this.handlePointerMove(event));
    this.drawCanvas.addEventListener('pointerup', event => this.handlePointerUp(event));
    this.drawCanvas.addEventListener('pointercancel', event => this.handlePointerUp(event));
    this.drawCanvas.addEventListener('touchstart', suppressNativeTouch, { passive: false });
    this.drawCanvas.addEventListener('touchmove', suppressNativeTouch, { passive: false });
    this.drawCanvas.addEventListener('touchend', suppressNativeTouch, { passive: false });
    this.drawCanvas.addEventListener('touchcancel', suppressNativeTouch, { passive: false });
    this.drawCanvas.addEventListener('contextmenu', suppressBrowserSelection);
    this.drawCanvas.addEventListener('selectstart', suppressBrowserSelection);
    this.drawCanvas.addEventListener('dragstart', suppressBrowserSelection);
    this.shell.addEventListener('contextmenu', suppressBrowserSelection);
    this.shell.addEventListener('selectstart', suppressBrowserSelection);
    this.shell.addEventListener('dragstart', suppressBrowserSelection);
    this.drawCanvas.addEventListener('pointerleave', event => {
      if (this.isDrawing && event.pointerType !== 'touch') {
        this.handlePointerUp(event);
      }
    });
  }

  clearDocumentSelection() {
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && selection.rangeCount) {
      selection.removeAllRanges();
    }
  }

  isPenPointer(event) {
    return event.pointerType === 'pen' || event.pointerType === 'mouse';
  }

  getTouchPointers() {
    return [...this.activePointers.values()].filter(pointer => pointer.type === 'touch');
  }

  handlePointerDown(event) {
    this.clearDocumentSelection();
    this.activePointers.set(event.pointerId, {
      type: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY
    });

    if (this.isPenPointer(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.onInteraction(this);
      this.touchScroll = null;
      this.isDrawing = true;
      this.activeDrawPointerId = event.pointerId;
      if (typeof this.drawCanvas.setPointerCapture === 'function') {
        try {
          this.drawCanvas.setPointerCapture(event.pointerId);
        } catch (_) {}
      }

      const pos = this.getCanvasPoint(event);
      this.lastX = pos.x;
      this.lastY = pos.y;
      return;
    }

    if (event.pointerType === 'touch') {
      const touches = this.getTouchPointers();
      if (touches.length === 1) {
        this.touchScroll = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startScrollLeft: this.mount.scrollLeft,
          startPageScrollTop: this.pageScroller.scrollTop
        };
      } else {
        this.touchScroll = null;
      }
    }
  }

  handlePointerMove(event) {
    this.clearDocumentSelection();
    const previous = this.activePointers.get(event.pointerId);
    if (previous) {
      this.activePointers.set(event.pointerId, {
        ...previous,
        clientX: event.clientX,
        clientY: event.clientY
      });
    }

    if (this.isPenPointer(event)) {
      if (!this.isDrawing || event.pointerId !== this.activeDrawPointerId) return;
      event.preventDefault();
      event.stopPropagation();

      const pos = this.getCanvasPoint(event);
      const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.6;

      this.drawCtx.lineJoin = 'round';
      this.drawCtx.lineCap = 'round';

      if (this.tool === 'eraser') {
        const eraseSize = this.strokeSize * 8;
        this.drawCtx.clearRect(pos.x - eraseSize / 2, pos.y - eraseSize / 2, eraseSize, eraseSize);
      } else {
        this.drawCtx.globalCompositeOperation = 'source-over';
        this.drawCtx.strokeStyle = this.color;
        this.drawCtx.lineWidth = Math.max(1.2, this.strokeSize * pressure * 1.6);
        this.drawCtx.beginPath();
        this.drawCtx.moveTo(this.lastX, this.lastY);
        this.drawCtx.lineTo(pos.x, pos.y);
        this.drawCtx.stroke();
      }

      this.lastX = pos.x;
      this.lastY = pos.y;
      return;
    }

    if (event.pointerType === 'touch' && this.touchScroll && this.touchScroll.id === event.pointerId) {
      event.preventDefault();
      const dx = this.touchScroll.startX - event.clientX;
      const dy = this.touchScroll.startY - event.clientY;
      this.mount.scrollLeft = this.touchScroll.startScrollLeft + dx;
      this.pageScroller.scrollTop = this.touchScroll.startPageScrollTop + dy;
    }
  }

  handlePointerUp(event) {
    this.clearDocumentSelection();
    this.activePointers.delete(event.pointerId);

    if (this.isPenPointer(event)) {
      if (this.activeDrawPointerId !== event.pointerId) return;
      if (typeof this.drawCanvas.releasePointerCapture === 'function') {
        try {
          this.drawCanvas.releasePointerCapture(event.pointerId);
        } catch (_) {}
      }
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.activeDrawPointerId = null;
      this.saveHistory();
      return;
    }

    if (event.pointerType === 'touch') {
      if (this.touchScroll && this.touchScroll.id === event.pointerId) {
        this.touchScroll = null;
      }
      if (!this.getTouchPointers().length) {
        this.touchScroll = null;
      }
    }
  }

  getCanvasPoint(event) {
    const rect = this.drawCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.drawCanvas.width / rect.width),
      y: (event.clientY - rect.top) * (this.drawCanvas.height / rect.height)
    };
  }

  setTool(tool) {
    this.tool = tool;
    this.drawCanvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
  }

  setColor(color) {
    this.color = color;
  }

  setStrokeSize(size) {
    this.strokeSize = size;
  }

  setZoom(zoom) {
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, Number(zoom) || 1));
    this.zoom = nextZoom;
    this.fitToContainer();
  }

  resetZoom() {
    this.setZoom(1);
  }

  saveHistory() {
    this.history.push(this.drawCanvas.toDataURL('image/png'));
    if (this.history.length > 8) {
      this.history.shift();
    }
  }

  undo() {
    if (this.history.length <= 1) return;
    this.history.pop();
    const snapshot = this.history[this.history.length - 1];
    this.restoreSnapshot(snapshot);
  }

  restoreSnapshot(snapshot) {
    const image = new Image();
    image.onload = () => {
      this.drawCtx.clearRect(0, 0, this.width, this.height);
      this.drawCtx.drawImage(image, 0, 0, this.width, this.height);
    };
    image.src = snapshot;
  }

  clear() {
    this.drawCtx.clearRect(0, 0, this.width, this.height);
    this.saveHistory();
  }

  exportMergedBase64() {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.bgCanvas, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.drawCanvas, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  }
}

window.VocabCanvasSurface = VocabCanvasSurface;
