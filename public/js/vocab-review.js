(function () {
  const params = new URLSearchParams(window.location.search);
  const sourceSubmissionId = Number(params.get('submission') || 0);
  const practiceExamId = Number(params.get('exam') || 0);
  const isPracticeMode = params.get('mode') === 'practice' || practiceExamId > 0;

  const state = {
    review: null,
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

  function getSupportConfig(question) {
    const raw = question?.support_config && typeof question.support_config === 'object'
      ? question.support_config
      : {};
    const syllables = Array.isArray(raw.syllables)
      ? raw.syllables.map(part => String(part || '').trim()).filter(Boolean)
      : [];
    return {
      syllables,
      show_syllables: raw.show_syllables !== false && syllables.length > 1,
      trace_mode: String(raw.trace_mode || 'dots').trim().toLowerCase() === 'none' ? 'none' : 'dots',
      trace_text: String(raw.trace_text || question?.correct_answer || '').trim()
    };
  }

  function renderSyllableRow(question) {
    const support = getSupportConfig(question);
    if (!support.show_syllables) return '';
    return `
      <div class="vocab-syllable-row">
        <span class="vocab-syllable-label">音節</span>
        ${support.syllables.map(part => `<span class="vocab-syllable-chip">${escHtml(part)}</span>`).join('')}
      </div>
    `;
  }

  function setStatus(message, type = 'info') {
    const card = document.getElementById('reviewStatusCard');
    const text = document.getElementById('reviewStatusText');
    if (!card || !text) return;
    card.classList.remove('vocab-hidden');
    text.textContent = message;
    text.className = `vocab-empty vocab-status-${type}`;
  }

  function hideStatus() {
    const card = document.getElementById('reviewStatusCard');
    if (card) card.classList.add('vocab-hidden');
  }

  function getQuestionHeading(question) {
    const primary = String(question.definition_zh || '').trim()
      || String(question.correct_answer || '').trim()
      || `第 ${question.question_number} 題`;
    const secondaryParts = [];
    if (question.question_number) secondaryParts.push(`第 ${question.question_number} 題`);
    if (question.points) secondaryParts.push(`${question.points} 分`);
    return { primary, secondary: secondaryParts.join(' · ') };
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

    document.getElementById('undoReviewBtn').addEventListener('click', () => {
      if (state.activeSurface) {
        state.activeSurface.undo();
      }
    });

    document.getElementById('clearReviewBtn').addEventListener('click', () => {
      if (!window.confirm('確定清空這次複習練習？')) return;
      state.surfaces.forEach(surface => surface.clear());
    });

    document.getElementById('startRetestBtn').addEventListener('click', () => {
      if (isPracticeMode && practiceExamId) {
        window.location.href = `vocab-exam.html?id=${practiceExamId}`;
        return;
      }
      window.location.href = `vocab-retest.html?submission=${sourceSubmissionId}`;
    });
  }

  async function renderReview(review) {
    state.review = review;
    const modeLabel = review.practice_mode ? '單字練習' : '錯題複習';
    const title = review.exam_title || review.title || modeLabel;
    document.querySelector('.vocab-header h1').textContent = modeLabel;
    document.querySelector('.vocab-app-title').textContent = review.practice_mode ? '✏️ Vocabulary Practice' : '📚 Vocabulary Review';
    document.querySelector('.vocab-app-subtitle').textContent = review.practice_mode
      ? '先看答案描一次，再回到正式考卷'
      : '先看題目與答案練習一次，再進入錯題再考';
    document.getElementById('reviewTitle').textContent = `${title} - ${modeLabel}`;

    const metaItems = review.practice_mode
      ? [
          review.student_name || sessionStorage.getItem('vocab_student_name') || '練習模式',
          `練習 ${review.questions.length} 題`,
          '不計分',
          '描點後回正式考'
        ]
      : [
          review.student_name,
          `原始第 ${review.original_attempt_no} 次`,
          `待複習 ${review.questions.length} 題`,
          '看答案練習一次'
        ];
    document.getElementById('reviewMeta').innerHTML = metaItems.map(text => `<span>${escHtml(text)}</span>`).join('');
    document.getElementById('backToReviewResultLink').href = review.practice_mode
      ? `vocab-exam.html?id=${review.exam_id}`
      : `vocab-result.html?id=${sourceSubmissionId}`;
    document.getElementById('backToReviewResultLink').textContent = review.practice_mode ? '回考卷列表' : '回上一份結果';
    document.getElementById('startRetestBtn').textContent = review.practice_mode ? '完成練習，開始正式考' : '完成複習，開始錯題再考';

    const wrap = document.getElementById('reviewQuestionCards');
    if (!Array.isArray(review.questions) || !review.questions.length) {
      wrap.innerHTML = '';
      setStatus('這一份沒有可複習的錯題。請回上一頁重新確認結果。', 'warning');
      return;
    }

    wrap.innerHTML = review.questions.map(question => {
      const heading = getQuestionHeading(question);
      return `
      <div class="vocab-question-card">
        <div class="vocab-question-heading">
          <strong>${escHtml(heading.primary)}</strong>
          <span>${escHtml(heading.secondary)}</span>
        </div>
        <img src="data:image/jpeg;base64,${question.prompt_image}" alt="Question ${question.question_number}">
        <div class="vocab-review-answer">
          <span class="vocab-review-answer-label">參考答案</span>
          <strong>${escHtml(question.correct_answer || '')}</strong>
        </div>
        ${renderSyllableRow(question)}
        <div id="reviewMount-${question.question_id}"></div>
      </div>
    `;
    }).join('');
    hideStatus();

    state.surfaces = [];
    for (const question of review.questions) {
      const surface = new VocabCanvasSurface({
        mount: document.getElementById(`reviewMount-${question.question_id}`),
        width: question.answer_canvas_width,
        height: question.answer_canvas_height,
        maxDisplayWidth: 760,
        traceGuides: getSupportConfig(question).trace_mode === 'dots'
          ? [{
              text: getSupportConfig(question).trace_text,
              mode: 'dots',
              box: {
                x: 0,
                y: 0,
                width: question.answer_canvas_width,
                height: question.answer_canvas_height
              }
            }]
          : [],
        onInteraction: current => {
          state.activeSurface = current;
        }
      });
      await surface.init();
      applyBrush(surface);
      state.surfaces.push(surface);
    }
    state.activeSurface = state.surfaces[0] || null;
  }

  async function init() {
    if (!sourceSubmissionId && !practiceExamId) {
      setStatus('缺少練習來源，無法建立內容。', 'error');
      showToast('缺少練習來源', 'error');
      return;
    }

    bindToolbar();
    setStatus(isPracticeMode ? '正在準備單字練習內容…' : '正在建立錯題複習內容，若題數較多可能需要幾秒鐘…', 'info');

    try {
      const review = isPracticeMode
        ? await apiCall(`/api/vocab/exams/${practiceExamId}/practice?student_name=${encodeURIComponent(sessionStorage.getItem('vocab_student_name') || '')}`)
        : await apiCall(`/api/vocab/submissions/${sourceSubmissionId}/retest`, {
            method: 'POST',
            body: {}
          });
      await renderReview(review);
    } catch (error) {
      setStatus(`${isPracticeMode ? '單字練習' : '錯題複習'}建立失敗：${error.message}`, 'error');
      showToast(error.message, 'error');
    }
  }

  init();
})();
