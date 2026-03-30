(function () {
  const params = new URLSearchParams(window.location.search);
  const preselectedExamId = Number(params.get('id') || 0);

  const state = {
    exams: [],
    exam: null,
    surfaces: [],
    activeSurface: null,
    tool: 'pen',
    color: '#111111',
    strokeSize: 3,
    zoom: 1
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

  async function loadExamList() {
    const wrap = document.getElementById('examSelectionList');
    wrap.innerHTML = '<div class="vocab-card"><div class="vocab-empty">載入考卷中…</div></div>';

    try {
      state.exams = await apiCall('/api/vocab/exams');
      if (!state.exams.length) {
        wrap.innerHTML = '<div class="vocab-card"><div class="vocab-empty">目前沒有已發布的單字考卷。</div></div>';
        return;
      }

      wrap.innerHTML = state.exams.map(exam => `
        <div class="vocab-exam-card">
          <h3>${escHtml(exam.title)}</h3>
          <div class="vocab-meta-row">
            <span>${exam.source_type === 'howdy'
              ? `Howdy ${exam.howdy_level} / Unit ${exam.unit} / ${exam.book_type}`
              : 'Custom exam'}</span>
            <span>${exam.page_count} 頁</span>
            <span>${exam.question_count} 題</span>
            <span>通過 ${exam.pass_score}</span>
          </div>
          <div class="vocab-actions" style="margin-top: 0.9rem;">
            <button class="vocab-btn primary" type="button" data-open="${exam.id}">開始作答</button>
          </div>
        </div>
      `).join('');

      wrap.querySelectorAll('[data-open]').forEach(button => {
        button.addEventListener('click', () => openExam(Number(button.dataset.open)));
      });
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
      exam.source_type === 'howdy' ? `Howdy ${exam.howdy_level} / Unit ${exam.unit} / ${exam.book_type}` : 'Custom exam',
      `${exam.page_count} 頁`,
      `${exam.question_count} 題`,
      `通過 ${exam.pass_score}`
    ].map(text => `<span>${escHtml(text)}</span>`).join('');

    const stack = document.getElementById('pageSurfaceStack');
    stack.innerHTML = exam.pages.map(page => `
      <div class="vocab-page-card">
        <h3>第 ${page.page_number} 頁</h3>
        <div id="pageMount-${page.page_number}"></div>
      </div>
    `).join('');

    for (const page of exam.pages) {
      const surface = new VocabCanvasSurface({
        mount: document.getElementById(`pageMount-${page.page_number}`),
        backgroundBase64: page.blank_image,
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
    document.getElementById('studentNameInput').addEventListener('change', rememberStudentName);
    document.getElementById('studentNameInput').addEventListener('blur', rememberStudentName);
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

    bindToolbar();
    updateZoomLabel();
    await loadExamList();

    if (preselectedExamId) {
      openExam(preselectedExamId);
    }
  }

  init();
})();
