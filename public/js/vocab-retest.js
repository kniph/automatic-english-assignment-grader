(function () {
  const params = new URLSearchParams(window.location.search);
  const sourceSubmissionId = Number(params.get('submission') || 0);

  const state = {
    retest: null,
    surfaces: [],
    activeSurface: null,
    tool: 'pen',
    color: '#111111',
    strokeSize: 3
  };

  function escHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function applyBrush(surface) {
    surface.setTool(state.tool);
    surface.setColor(state.color);
    surface.setStrokeSize(state.strokeSize);
  }

  function applyBrushToAll() {
    state.surfaces.forEach(applyBrush);
  }

  function bindToolbar() {
    document.querySelectorAll('[data-tool]').forEach(button => {
      button.addEventListener('click', () => {
        state.tool = button.dataset.tool;
        document.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('active', item.dataset.tool === state.tool));
        applyBrushToAll();
      });
    });

    document.querySelectorAll('[data-color]').forEach(dot => {
      dot.addEventListener('click', () => {
        state.color = dot.dataset.color;
        document.querySelectorAll('[data-color]').forEach(item => item.classList.toggle('active', item.dataset.color === state.color));
        applyBrushToAll();
      });
    });

    document.querySelectorAll('[data-size]').forEach(button => {
      button.addEventListener('click', () => {
        state.strokeSize = Number(button.dataset.size || 3);
        document.querySelectorAll('[data-size]').forEach(item => item.classList.toggle('active', Number(item.dataset.size) === state.strokeSize));
        applyBrushToAll();
      });
    });

    document.getElementById('undoRetestBtn').addEventListener('click', () => {
      if (state.activeSurface) {
        state.activeSurface.undo();
      }
    });

    document.getElementById('clearRetestBtn').addEventListener('click', () => {
      if (!window.confirm('確定清空這次重考作答？')) return;
      state.surfaces.forEach(surface => surface.clear());
    });

    document.getElementById('submitRetestBtn').addEventListener('click', submitRetest);
  }

  async function renderRetest(retest) {
    state.retest = retest;
    document.getElementById('retestTitle').textContent = retest.title;
    document.getElementById('retestMeta').innerHTML = [
      retest.student_name,
      `原始第 ${retest.original_attempt_no} 次`,
      `這次會記為第 ${retest.next_attempt_no} 次`,
      `通過 ${retest.pass_score}`
    ].map(text => `<span>${escHtml(text)}</span>`).join('');
    document.getElementById('backToResultLink').href = `vocab-result.html?id=${sourceSubmissionId}`;

    const wrap = document.getElementById('retestQuestionCards');
    wrap.innerHTML = retest.questions.map(question => `
      <div class="vocab-question-card">
        <div class="vocab-actions" style="justify-content: space-between; margin-bottom: 0.75rem;">
          <strong>第 ${question.question_number} 題</strong>
          <span>${question.points} 分</span>
        </div>
        <img src="data:image/jpeg;base64,${question.prompt_image}" alt="Question ${question.question_number}">
        <div id="answerMount-${question.question_id}"></div>
      </div>
    `).join('');

    state.surfaces = [];
    for (const question of retest.questions) {
      const surface = new VocabCanvasSurface({
        mount: document.getElementById(`answerMount-${question.question_id}`),
        width: question.answer_canvas_width,
        height: question.answer_canvas_height,
        maxDisplayWidth: 760,
        onInteraction: current => {
          state.activeSurface = current;
        }
      });
      await surface.init();
      applyBrush(surface);
      state.surfaces.push({ question_id: question.question_id, surface });
    }
    state.activeSurface = state.surfaces[0]?.surface || null;
  }

  async function submitRetest() {
    if (!state.retest) return;

    const button = document.getElementById('submitRetestBtn');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '批改中…';

    try {
      const questionAttempts = state.surfaces.map(item => ({
        question_id: item.question_id,
        image: item.surface.exportMergedBase64()
      }));

      const response = await apiCall('/api/vocab/submissions', {
        method: 'POST',
        body: {
          exam_id: state.retest.exam_id,
          student_name: state.retest.student_name,
          attempt_mode: 'retest',
          source_submission_id: state.retest.source_submission_id,
          question_attempts: questionAttempts
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
    if (!sourceSubmissionId) {
      showToast('缺少 submission id', 'error');
      return;
    }

    bindToolbar();

    try {
      const retest = await apiCall(`/api/vocab/submissions/${sourceSubmissionId}/retest`, {
        method: 'POST',
        body: {}
      });
      await renderRetest(retest);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  init();
})();
