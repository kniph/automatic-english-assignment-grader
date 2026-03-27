// === ROI Editor ===
// Canvas-based region-of-interest drawing tool for marking answer regions on a template image.

class ROIEditor {
  constructor(canvasEl, options = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.regions = [];
    this.image = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Drawing state
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentRect = null;
    this.selectedIndex = -1;
    this.dragMode = null; // null, 'move', 'resize'
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOrigRegion = null;

    // Callbacks
    this.onRegionAdded = options.onRegionAdded || (() => {});
    this.onRegionSelected = options.onRegionSelected || (() => {});
    this.onRegionMoved = options.onRegionMoved || (() => {});

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => this._onMouseUp());

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseDown(this._touchToMouse(touch));
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this._onMouseMove(this._touchToMouse(touch));
    });
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._onMouseUp();
    });
  }

  _touchToMouse(touch) {
    const rect = this.canvas.getBoundingClientRect();
    return { clientX: touch.clientX, clientY: touch.clientY };
  }

  _getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  // Convert canvas coords to image coords
  _canvasToImage(cx, cy) {
    return {
      x: (cx - this.offsetX) / this.scale,
      y: (cy - this.offsetY) / this.scale
    };
  }

  // Convert image coords to canvas coords
  _imageToCanvas(ix, iy) {
    return {
      x: ix * this.scale + this.offsetX,
      y: iy * this.scale + this.offsetY
    };
  }

  _hitTest(pos) {
    const imgPos = this._canvasToImage(pos.x, pos.y);
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i].region;
      if (imgPos.x >= r.x && imgPos.x <= r.x + r.width &&
          imgPos.y >= r.y && imgPos.y <= r.y + r.height) {
        return i;
      }
    }
    return -1;
  }

  _onMouseDown(e) {
    if (!this.image) return;
    const pos = this._getCanvasPos(e);
    const hitIndex = this._hitTest(pos);

    if (hitIndex >= 0) {
      // Select and start moving existing region
      this.selectedIndex = hitIndex;
      this.dragMode = 'move';
      this.dragStartX = pos.x;
      this.dragStartY = pos.y;
      const r = this.regions[hitIndex].region;
      this.dragOrigRegion = { x: r.x, y: r.y, width: r.width, height: r.height };
      this.onRegionSelected(hitIndex, this.regions[hitIndex]);
      this.render();
    } else {
      // Start drawing new region
      this.isDrawing = true;
      this.selectedIndex = -1;
      this.startX = pos.x;
      this.startY = pos.y;
    }
  }

  _onMouseMove(e) {
    if (!this.image) return;
    const pos = this._getCanvasPos(e);

    if (this.isDrawing) {
      const imgStart = this._canvasToImage(this.startX, this.startY);
      const imgEnd = this._canvasToImage(pos.x, pos.y);
      this.currentRect = {
        x: Math.min(imgStart.x, imgEnd.x),
        y: Math.min(imgStart.y, imgEnd.y),
        width: Math.abs(imgEnd.x - imgStart.x),
        height: Math.abs(imgEnd.y - imgStart.y)
      };
      this.render();
    } else if (this.dragMode === 'move' && this.selectedIndex >= 0) {
      const dx = (pos.x - this.dragStartX) / this.scale;
      const dy = (pos.y - this.dragStartY) / this.scale;
      const r = this.regions[this.selectedIndex].region;
      r.x = Math.max(0, Math.min(this.dragOrigRegion.x + dx, this.imageWidth - r.width));
      r.y = Math.max(0, Math.min(this.dragOrigRegion.y + dy, this.imageHeight - r.height));
      this.render();
    } else {
      // Cursor hint
      const hitIndex = this._hitTest(pos);
      this.canvas.style.cursor = hitIndex >= 0 ? 'move' : 'crosshair';
    }
  }

  _onMouseUp(e) {
    if (this.isDrawing && this.currentRect && this.currentRect.width > 10 && this.currentRect.height > 10) {
      const number = this.regions.length + 1;
      const newRegion = {
        number,
        type: 'fill_blank',
        region: {
          x: Math.round(this.currentRect.x),
          y: Math.round(this.currentRect.y),
          width: Math.round(this.currentRect.width),
          height: Math.round(this.currentRect.height)
        },
        correct_answer: '',
        alt_answers: [],
        points: 1,
        fuzzy_threshold: 0
      };
      this.regions.push(newRegion);
      this.selectedIndex = this.regions.length - 1;
      this.onRegionAdded(this.selectedIndex, newRegion);
    }

    if (this.dragMode === 'move' && this.selectedIndex >= 0) {
      this.onRegionMoved(this.selectedIndex, this.regions[this.selectedIndex]);
    }

    this.isDrawing = false;
    this.currentRect = null;
    this.dragMode = null;
    this.render();
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.imageWidth = img.naturalWidth;
        this.imageHeight = img.naturalHeight;
        this._fitCanvas();
        this.render();
        resolve({ width: this.imageWidth, height: this.imageHeight });
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  _fitCanvas() {
    const containerWidth = this.canvas.parentElement.clientWidth;
    const maxHeight = window.innerHeight * 0.7;
    this.scale = Math.min(containerWidth / this.imageWidth, maxHeight / this.imageHeight);
    this.canvas.width = Math.round(this.imageWidth * this.scale);
    this.canvas.height = Math.round(this.imageHeight * this.scale);
    this.offsetX = 0;
    this.offsetY = 0;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.image) return;

    // Draw image
    ctx.drawImage(this.image, this.offsetX, this.offsetY,
      this.imageWidth * this.scale, this.imageHeight * this.scale);

    // Draw existing regions
    this.regions.forEach((item, i) => {
      const r = item.region;
      const cPos = this._imageToCanvas(r.x, r.y);
      const cW = r.width * this.scale;
      const cH = r.height * this.scale;

      const isSelected = i === this.selectedIndex;

      ctx.strokeStyle = isSelected ? '#ff4444' : '#1a73e8';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [] : [5, 3]);
      ctx.strokeRect(cPos.x, cPos.y, cW, cH);
      ctx.setLineDash([]);

      // Fill with semi-transparent color
      ctx.fillStyle = isSelected ? 'rgba(255, 68, 68, 0.1)' : 'rgba(26, 115, 232, 0.08)';
      ctx.fillRect(cPos.x, cPos.y, cW, cH);

      // Label
      const label = `#${item.number}`;
      ctx.font = `bold ${Math.max(12, 14 * this.scale)}px sans-serif`;
      ctx.fillStyle = isSelected ? '#ff4444' : '#1a73e8';
      ctx.fillText(label, cPos.x + 4, cPos.y - 4);
    });

    // Draw current rectangle being drawn
    if (this.currentRect) {
      const cPos = this._imageToCanvas(this.currentRect.x, this.currentRect.y);
      const cW = this.currentRect.width * this.scale;
      const cH = this.currentRect.height * this.scale;
      ctx.strokeStyle = '#28a745';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(cPos.x, cPos.y, cW, cH);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(40, 167, 69, 0.15)';
      ctx.fillRect(cPos.x, cPos.y, cW, cH);
    }
  }

  selectRegion(index) {
    this.selectedIndex = index;
    this.render();
  }

  deleteRegion(index) {
    this.regions.splice(index, 1);
    // Re-number
    this.regions.forEach((r, i) => r.number = i + 1);
    if (this.selectedIndex >= this.regions.length) {
      this.selectedIndex = this.regions.length - 1;
    }
    this.render();
  }

  getRegions() {
    return this.regions;
  }

  setRegions(regions) {
    this.regions = regions;
    this.render();
  }

  clear() {
    this.regions = [];
    this.selectedIndex = -1;
    this.render();
  }
}
