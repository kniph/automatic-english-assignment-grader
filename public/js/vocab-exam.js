(function () {
  const params = new URLSearchParams(window.location.search);
  const preselectedExamId = Number(params.get('id') || 0);

  const state = {
    exams: [],
    customExams: [],
    exam: null,
    surfaces: [],
    activeSurface: null,
    selectedHowdy: null,
    selectedUnit: null,
    tool: 'pen',
    color: '#111111',
    strokeSize: 3,
    zoom: 1
  };

  const UNIT_LABELS = {
    1: 'Unit 1',
    2: 'Unit 2',
    3: 'Unit 3',
    4: 'Unit 4',
    5: 'Unit 5',
    6: 'Unit 6',
    7: 'Unit 7',
    8: 'Unit 8',
    9: 'Review 1',
    10: 'Review 2'
  };

  function escHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function getStudentName() {
    return document.getElementById('studentNameInput').value.trim();
  }

  function rememberStudentName() {
    const studentName = getStudentName();
    if (studentName) {
      sessionStorage.setItem('vocab_student_name', studentName);
    }
  }

  function getExamDerivedMeta(exam) {
    const directHowdy = Number(exam.howdy_level);
    const directUnit = Number(exam.unit);
    if (Number.isInteger(directHowdy) && directHowdy > 0 && Number.isInteger(directUnit) && directUnit > 0) {
      return {
        kind: 'howdy',
        howdy_level: directHowdy,
        unit: directUnit
      };
    }

    const titleMatch = String(exam.title || '').match(/^Howdy\s+(\d+)\s+Unit\s+(\d+)/i);
    if (titleMatch) {
      return {
        kind: 'howdy',
        howdy_level: Number(titleMatch[1]),
        unit: Number(titleMatch[2])
      };
    }

    return { kind: 'custom', howdy_level: null, unit: null };
  }

  function annotateExam(exam) {
    return {
      ...exam,
      derived_meta: getExamDerivedMeta(exam)
    };
  }

  function getExamMetaLabel(exam) {
    const meta = exam.derived_meta || getExamDerivedMeta(exam);
    if (meta.kind === 'howdy') {
      return `Howdy ${meta.howdy_level} / ${UNIT_LABELS[meta.unit] || `Unit ${meta.unit}`}`;
    }
    return 'Custom exam';
  }

  function updateSelectionSummary() {
    const studentName = getStudentName();
    const bar = document.getElementById('selectionSummaryBar');
    if (!bar) return;

    if (!studentName) {
      bar.textContent = '請輸入姓名開始';
      return;
    }

    let text = `👤 ${studentName}`;
    if (state.selectedHowdy) text += `　📘 Howdy ${state.selectedHowdy}`;
    if (state.selectedUnit) text += `　${UNIT_LABELS[state.selectedUnit] || `Unit ${state.selectedUnit}`}`;
    bar.textContent = text;
  }

  function showSelectionStep(stepId, options = {}) {
    const target = document.getElementById(stepId);
    if (!target) return;
    target.classList.remove('vocab-hidden');
    if (options.scroll === false) return;
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function bindExamButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-open]').forEach(button => {
      button.addEventListener('click', () => openExam(Number(button.dataset.open)));
    });
  }

  function renderExamCards(exams, mountId, emptyMessage) {
    const wrap = document.getElementById(mountId);
    if (!wrap) return;

    if (!exams.length) {
      wrap.innerHTML = `<div class="vocab-card"><div class="vocab-empty">${escHtml(emptyMessage)}</div></div>`;
      return;
    }

    wrap.innerHTML = exams.map(exam => `
      <div class="vocab-exam-card">
        <h3>${escHtml(exam.title)}</h3>
        <div class="vocab-meta-row">
          <span>${escHtml(getExamMetaLabel(exam))}</span>
          <span>${exam.page_count} 頁</span>
          <span>${exam.question_count} 題</span>
          <span>通過 ${exam.pass_score}%</span>
        </div>
        <div class="vocab-actions" style="margin-top: 0.9rem;">
          <button class="vocab-btn primary" type="button" data-open="${exam.id}">開始作答</button>
        </div>
      </div>
    `).join('');

    bindExamButtons(wrap);
  }

  function renderHowdyGrid() {
    const grid = document.getElementById('howdySelectionGrid');
    if (!grid) return;

    const howdyLevels = new Set(
      state.exams
        .map(exam => exam.derived_meta)
        .filter(meta => meta.kind === 'howdy')
        .map(meta => meta.howdy_level)
    );

    if (!howdyLevels.size) {
      grid.innerHTML = '<div class="vocab-empty">目前沒有可用的 Howdy 單字考卷。</div>';
      return;
    }

    grid.innerHTML = '';
    for (let level = 1; level <= 10; level += 1) {
      const has = howdyLevels.has(level);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `vocab-select-btn${has ? '' : ' unavail'}${state.selectedHowdy === level ? ' selected' : ''}`;
      button.textContent = String(level);
      if (has) {
        button.addEventListener('click', () => selectHowdy(level));
      }
      grid.appendChild(button);
    }
  }

  function renderUnitGrid(howdyLevel) {
    const grid = document.getElementById('unitSelectionGrid');
    if (!grid) return;

    grid.innerHTML = '';
    for (let unit = 1; unit <= 10; unit += 1) {
      const has = state.exams.some(exam => {
        const meta = exam.derived_meta;
        return meta.kind === 'howdy' && meta.howdy_level === howdyLevel && meta.unit === unit;
      });

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `vocab-select-btn${has ? '' : ' unavail'}${state.selectedUnit === unit ? ' selected' : ''}`;
      button.textContent = UNIT_LABELS[unit] || `Unit ${unit}`;
      if (has) {
        button.addEventListener('click', () => selectUnit(unit));
      }
      grid.appendChild(button);
    }
  }

  function renderFilteredExamList() {
    const filtered = state.exams.filter(exam => {
      const meta = exam.derived_meta;
      return meta.kind === 'howdy' && meta.howdy_level === state.selectedHowdy && meta.unit === state.selectedUnit;
    });

    renderExamCards(filtered, 'examSelectionList', '這個單元目前沒有可作答的考卷。');
    document.getElementById('stepExamCard').classList.toggle('vocab-hidden', !state.selectedHowdy || !state.selectedUnit);
  }

  function selectHowdy(level) {
    state.selectedHowdy = level;
    state.selectedUnit = null;
    updateSelectionSummary();
    renderHowdyGrid();
    renderUnitGrid(level);
    showSelectionStep('stepUnitCard');
    document.getElementById('stepExamCard').classList.add('vocab-hidden');
    document.getElementById('examSelectionList').innerHTML = '';
  }

  function selectUnit(unit) {
    state.selectedUnit = unit;
    updateSelectionSummary();
    renderUnitGrid(state.selectedHowdy);
    renderFilteredExamList();
    showSelectionStep('stepExamCard');
  }

  function clearWorkspaceSelection() {
    const workspace = document.getElementById('workspaceSection');
    if (!workspace || workspace.classList.contains('vocab-hidden')) return;

    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && selection.rangeCount) {
      selection.removeAllRanges();
    }
  }

  async function loadExamList() {
    const wrap = document.getElementById('examSelectionList');
    const customWrap = document.getElementById('customExamSelectionList');
    wrap.innerHTML = '<div class="vocab-card"><div class="vocab-empty">載入考卷中…</div></div>';
    if (customWrap) customWrap.innerHTML = '';

    try {
      state.exams = (await apiCall('/api/vocab/exams')).map(annotateExam);
      state.customExams = state.exams.filter(exam => exam.derived_meta.kind !== 'howdy');
      if (!state.exams.length) {
        wrap.innerHTML = '<div class="vocab-card"><div class="vocab-empty">目前沒有已發布的單字考卷。</div></div>';
        return;
      }

      if (getStudentName()) {
        showSelectionStep('stepHowdyCard', { scroll: false });
      }

      renderHowdyGrid();
      if (state.customExams.length) {
        renderExamCards(state.customExams, 'customExamSelectionList', '目前沒有自訂考卷。');
        document.getElementById('customExamCard').classList.remove('vocab-hidden');
      } else {
        document.getElementById('customExamCard').classList.add('vocab-hidden');
      }

      updateSelectionSummary();
    } catch (error) {
      wrap.innerHTML = `<div class="vocab-card"><div class="vocab-empty">${escHtml(error.message)}</div></div>`;
    }
  }

  function applyBrush(surface) {
    surface.setTool(state.tool);
    surface.setColor(state.color);
    surface.setStrokeSize(state.strokeSize);
  }

  function applyBrushToAllSurfaces() {
    state.surfaces.forEach(applyBrush);
  }

  function updateZoomLabel() {
    const label = document.getElementById('zoomLabel');
    if (!label) return;
    label.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function applyZoomToAllSurfaces() {
    state.surfaces.forEach(surface => surface.setZoom(state.zoom));
    updateZoomLabel();
  }

  function setZoom(nextZoom) {
    const clamped = Math.max(0.45, Math.min(2.4, Number(nextZoom) || 1));
    state.zoom = clamped;
    applyZoomToAllSurfaces();
  }

  async function buildExamWorkspace(exam) {
    state.exam = exam;
    state.surfaces = [];
    state.activeSurface = null;

    document.getElementById('workspaceTitle').textContent = exam.title;
    document.getElementById('workspaceMeta').innerHTML = [
      getExamMetaLabel(annotateExam(exam)),
      `${exam.page_count} 頁`,
      `${exam.question_count} 題`,
      `通過 ${exam.pass_score}%`
    ].map(text => `<span>${escHtml(text)}</span>`).join('');

    const stack = document.getElementById('pageSurfaceStack');
    stack.innerHTML = exam.pages.map(page => `
      <div class="vocab-page-card">
        <h3>第 ${page.page_number} 頁</h3>
        <div id="pageMount-${page.page_number}"></div>
      </div>
    `).join('');

    for (const page of exam.pages) {
      const guideBoxes = Array.isArray(exam.question_guides)
        ? exam.question_guides.filter(question => Number(question.page_number) === Number(page.page_number))
        : [];
      const surface = new VocabCanvasSurface({
        mount: document.getElementById(`pageMount-${page.page_number}`),
        backgroundBase64: page.blank_image,
        guideBoxes,
        zoom: state.zoom,
        onInteraction: current => {
          state.activeSurface = current;
        }
      });
      await surface.init();
      applyBrush(surface);
      state.surfaces.push(surface);
    }
    state.activeSurface = state.surfaces[0] || null;
    applyZoomToAllSurfaces();
  }

  async function openExam(examId) {
    const studentName = getStudentName();
    if (!studentName) {
      showToast('請先輸入學生姓名', 'error');
      return;
    }
    rememberStudentName();

    try {
      const exam = await apiCall(`/api/vocab/exams/${examId}`);
      await buildExamWorkspace(exam);
      document.getElementById('selectionSection').classList.add('vocab-hidden');
      document.getElementById('workspaceSection').classList.remove('vocab-hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function backToSelection() {
    document.getElementById('workspaceSection').classList.add('vocab-hidden');
    document.getElementById('selectionSection').classList.remove('vocab-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindToolbar() {
    document.querySelectorAll('[data-tool]').forEach(button => {
      button.addEventListener('click', () => {
        state.tool = button.dataset.tool;
        document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item.dataset.tool === state.tool));
        applyBrushToAllSurfaces();
      });
    });

    document.querySelectorAll('[data-color]').forEach(dot => {
      dot.addEventListener('click', () => {
        state.color = dot.dataset.color;
        document.querySelectorAll('[data-color]').forEach(item => item.classList.toggle('active', item.dataset.color === state.color));
        applyBrushToAllSurfaces();
      });
    });

    document.querySelectorAll('[data-size]').forEach(button => {
      button.addEventListener('click', () => {
        state.strokeSize = Number(button.dataset.size || 3);
        document.querySelectorAll('[data-size]').forEach(item => item.classList.toggle('active', Number(item.dataset.size) === state.strokeSize));
        applyBrushToAllSurfaces();
      });
    });

    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      setZoom(state.zoom - 0.15);
    });

    document.getElementById('zoomInBtn').addEventListener('click', () => {
      setZoom(state.zoom + 0.15);
    });

    document.getElementById('zoomFitBtn').addEventListener('click', () => {
      setZoom(1);
    });

    document.getElementById('undoBtn').addEventListener('click', () => {
      if (!state.activeSurface) return;
      state.activeSurface.undo();
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!state.surfaces.length) return;
      if (!window.confirm('確定清空目前所有作答內容？')) return;
      state.surfaces.forEach(surface => surface.clear());
    });

    document.getElementById('submitBtn').addEventListener('click', submitExam);
    document.getElementById('backToSelectionBtn').addEventListener('click', backToSelection);
    document.getElementById('studentNameInput').addEventListener('change', () => {
      rememberStudentName();
      if (getStudentName()) showSelectionStep('stepHowdyCard');
      updateSelectionSummary();
    });
    document.getElementById('studentNameInput').addEventListener('blur', () => {
      rememberStudentName();
      if (getStudentName()) showSelectionStep('stepHowdyCard');
      updateSelectionSummary();
    });
    document.getElementById('studentNameInput').addEventListener('input', updateSelectionSummary);
  }

  async function submitExam() {
    if (!state.exam || !state.surfaces.length) return;
    const studentName = getStudentName();
    if (!studentName) {
      showToast('請先輸入學生姓名', 'error');
      return;
    }

    const button = document.getElementById('submitBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '批改中…';

    try {
      const submissionImages = state.surfaces.map(surface => surface.exportMergedBase64());
      const response = await apiCall('/api/vocab/submissions', {
        method: 'POST',
        body: {
          exam_id: state.exam.id,
          student_name: studentName,
          submission_images: submissionImages
        }
      });
      window.location.href = `vocab-result.html?id=${response.id}`;
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function init() {
    const savedName = sessionStorage.getItem('vocab_student_name');
    if (savedName) {
      document.getElementById('studentNameInput').value = savedName;
    }

    document.documentElement.classList.add('selection-smooth-scroll');

    document.addEventListener('selectionchange', clearWorkspaceSelection);
    bindToolbar();
    updateZoomLabel();
    await loadExamList();

    if (preselectedExamId) {
      openExam(preselectedExamId);
    }
  }

  init();
})();
