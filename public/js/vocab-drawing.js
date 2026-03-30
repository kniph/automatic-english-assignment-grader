class VocabCanvasSurface {
  constructor(options) {
    this.mount = options.mount;
    this.backgroundBase64 = options.backgroundBase64 || '';
    this.width = options.width || 0;
    this.height = options.height || 0;
    this.maxDisplayWidth = options.maxDisplayWidth || null;
    this.onInteraction = options.onInteraction || (() => {});
    this.guideBoxes = Array.isArray(options.guideBoxes) ? options.guideBoxes : [];

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

    this.guideCanvas.style.position = 'absolute';
    this.guideCanvas.style.inset = '0';
    this.guideCanvas.style.pointerEvents = 'none';

    this.drawCanvas.style.position = 'absolute';
    this.drawCanvas.style.inset = '0';
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
    if (!this.guideBoxes.length) return;

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
