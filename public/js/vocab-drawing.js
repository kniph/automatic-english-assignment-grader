class VocabCanvasSurface {
  constructor(options) {
    this.mount = options.mount;
    this.backgroundBase64 = options.backgroundBase64 || '';
    this.width = options.width || 0;
    this.height = options.height || 0;
    this.maxDisplayWidth = options.maxDisplayWidth || null;
    this.onInteraction = options.onInteraction || (() => {});

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

    this.bgCanvas = document.createElement('canvas');
    this.drawCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.drawCtx = this.drawCanvas.getContext('2d');

    [this.bgCanvas, this.drawCanvas].forEach(canvas => {
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    });

    this.drawCanvas.style.position = 'absolute';
    this.drawCanvas.style.inset = '0';
    this.drawCanvas.style.touchAction = 'pan-y pinch-zoom';
    this.drawCanvas.style.cursor = 'crosshair';

    this.shell.appendChild(this.bgCanvas);
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
    this.drawCanvas.width = width;
    this.drawCanvas.height = height;
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

  bindEvents() {
    this.drawCanvas.addEventListener('pointerdown', event => this.handlePointerDown(event));
    this.drawCanvas.addEventListener('pointermove', event => this.handlePointerMove(event));
    this.drawCanvas.addEventListener('pointerup', event => this.handlePointerUp(event));
    this.drawCanvas.addEventListener('pointercancel', event => this.handlePointerUp(event));
    this.drawCanvas.addEventListener('pointerleave', event => {
      if (this.isDrawing && event.pointerType !== 'touch') {
        this.handlePointerUp(event);
      }
    });
  }

  handlePointerDown(event) {
    if (event.pointerType === 'touch') return;
    event.preventDefault();
    this.onInteraction(this);
    this.isDrawing = true;
    const pos = this.getCanvasPoint(event);
    this.lastX = pos.x;
    this.lastY = pos.y;
  }

  handlePointerMove(event) {
    if (!this.isDrawing || event.pointerType === 'touch') return;
    event.preventDefault();

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
  }

  handlePointerUp(event) {
    if (event.pointerType === 'touch') return;
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.saveHistory();
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
