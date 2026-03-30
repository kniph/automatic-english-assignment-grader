(function () {
  const state = {
    examId: null,
    pages: [],
    questions: [],
    currentPage: 1,
    selectedQuestionKey: null,
    showAnswerPreview: false,
    editor: null,
    loadToken: 0,
    blankUploads: [],
    answerUploads: []
  };

  let questionCounter = 0;

  function nextQuestionKey() {
    questionCounter += 1;
    return `vq-${Date.now()}-${questionCounter}`;
  }

  function escHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function getCurrentSourceType() {
    return document.querySelector('input[name="sourceType"]:checked')?.value || 'howdy';
  }

  function getPassScore() {
    return getCurrentSourceType() === 'custom'
      ? Number(document.getElementById('customPassScore').value || 80)
      : Number(document.getElementById('passScore').value || 80);
  }

  function setPassScore(value) {
    document.getElementById('passScore').value = value;
    document.getElementById('customPassScore').value = value;
  }

  function buildHowdyTitle() {
    const howdy = document.getElementById('howdyLevel').value;
    const unit = document.getElementById('unitNumber').value;
    const book = document.getElementById('bookType').value;
    if (!howdy || !unit || !book) return '';
    return `Howdy ${howdy} Unit ${unit} ${book} Vocabulary`;
  }

  function defaultTitleForCurrentSource() {
    if (getCurrentSourceType() === 'howdy') {
      return buildHowdyTitle();
    }
    return document.getElementById('customTitle').value.trim();
  }

  function updateSourceFields() {
    const isHowdy = getCurrentSourceType() === 'howdy';
    document.getElementById('howdyFields').classList.toggle('vocab-hidden', !isHowdy);
    document.getElementById('customFields').classList.toggle('vocab-hidden', isHowdy);
    const titleInput = document.getElementById('examTitle');
    if (!titleInput.value.trim()) {
      titleInput.placeholder = isHowdy ? buildHowdyTitle() || '不填會自動命名' : '例如：Unit 4 Vocabulary Quiz';
    }
  }

  function ensureEditor() {
    if (state.editor) return state.editor;

    state.editor = new ROIEditor(document.getElementById('templateCanvas'), {
      onRegionAdded: (_index, newRegion) => {
        const question = {
          client_key: nextQuestionKey(),
          page_number: state.currentPage,
          question_number: nextQuestionNumber(),
          prompt_type: 'picture_word',
          answer_text: '',
          answer_box: { ...newRegion.region },
          points: 5
        };
        state.questions.push(question);
        state.selectedQuestionKey = question.client_key;
        syncEditorRegions();
        renderQuestionTable();
        renderQuestionForm();
        showToast(`已新增第 ${question.question_number} 題`);
      },
      onRegionSelected: index => {
        const pageQuestions = getQuestionsForPage(state.currentPage);
        const question = pageQuestions[index];
        if (!question) return;
        state.selectedQuestionKey = question.client_key;
        renderQuestionTable();
        renderQuestionForm();
      },
      onRegionMoved: (index, region) => {
        const pageQuestions = getQuestionsForPage(state.currentPage);
        const question = pageQuestions[index];
        if (!question) return;
        question.answer_box = { ...region.region };
        state.selectedQuestionKey = question.client_key;
        renderQuestionForm();
      }
    });

    return state.editor;
  }

  function nextQuestionNumber() {
    return state.questions.reduce((max, question) => Math.max(max, Number(question.question_number) || 0), 0) + 1;
  }

  function getQuestionsForPage(pageNumber) {
    return state.questions
      .filter(question => Number(question.page_number) === Number(pageNumber))
      .sort((a, b) => Number(a.question_number) - Number(b.question_number));
  }

  function getSelectedQuestion() {
    return state.questions.find(question => question.client_key === state.selectedQuestionKey) || null;
  }

  function renderPageTabs() {
    const wrap = document.getElementById('pageTabs');
    if (!state.pages.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = state.pages.map(page => `
      <button class="vocab-page-btn ${page.page_number === state.currentPage ? 'active' : ''}" type="button" data-page="${page.page_number}">
        第 ${page.page_number} 頁
      </button>
    `).join('');
    wrap.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        state.currentPage = Number(button.dataset.page);
        loadCurrentPage();
      });
    });
  }

  function renderUploadPreview(elementId, images) {
    const wrap = document.getElementById(elementId);
    wrap.innerHTML = images.map((image, index) => `
      <img class="vocab-thumb" src="data:image/jpeg;base64,${image}" alt="Page ${index + 1}">
    `).join('');
  }

  function renderBuilderStatus(message) {
    const statusEl = document.getElementById('builderStatus');
    if (message) {
      statusEl.textContent = message;
      return;
    }

    const statusBits = [];
    if (state.examId) statusBits.push(`ID ${state.examId}`);
    if (state.pages.length) statusBits.push(`${state.pages.length} 頁`);
    if (state.questions.length) statusBits.push(`${state.questions.length} 題`);
    statusEl.textContent = statusBits.join(' · ');
  }

  async function loadCurrentPage() {
    renderPageTabs();
    renderQuestionTable();
    renderQuestionForm();
    populateQuestionPageOptions();
    renderBuilderStatus();

    const page = state.pages.find(item => item.page_number === state.currentPage);
    const answerWrap = document.getElementById('answerPreviewWrap');

    if (!page) {
      document.getElementById('templateCanvas').width = 1;
      document.getElementById('templateCanvas').height = 1;
      answerWrap.classList.add('vocab-hidden');
      return;
    }

    if (state.showAnswerPreview) {
      document.getElementById('answerPagePreview').src = `data:image/jpeg;base64,${page.answer_key_image}`;
      answerWrap.classList.remove('vocab-hidden');
    } else {
      answerWrap.classList.add('vocab-hidden');
    }

    const editor = ensureEditor();
    const token = ++state.loadToken;
    await editor.loadImage(`data:image/jpeg;base64,${page.blank_image}`);
    if (token !== state.loadToken) return;
    syncEditorRegions();
  }

  function syncEditorRegions() {
    if (!state.editor) return;
    const pageQuestions = getQuestionsForPage(state.currentPage);
    state.editor.setRegions(pageQuestions.map(question => ({
      number: question.question_number,
      type: question.prompt_type,
      region: { ...question.answer_box },
      correct_answer: question.answer_text,
      points: question.points
    })));

    const selected = getSelectedQuestion();
    if (!selected || Number(selected.page_number) !== Number(state.currentPage)) {
      state.editor.selectRegion(-1);
      return;
    }

    const selectedIndex = pageQuestions.findIndex(question => question.client_key === selected.client_key);
    state.editor.selectRegion(selectedIndex);
  }

  function populateQuestionPageOptions() {
    const select = document.getElementById('questionPageInput');
    select.innerHTML = state.pages.map(page => `<option value="${page.page_number}">第 ${page.page_number} 頁</option>`).join('');
  }

  function renderQuestionForm() {
    const question = getSelectedQuestion();
    const fields = {
      questionNumberInput: question?.question_number || '',
      questionPageInput: question?.page_number || '',
      questionPointsInput: question?.points || 5,
      questionPromptTypeInput: question?.prompt_type || 'picture_word',
      questionAnswerInput: question?.answer_text || '',
      boxXInput: question?.answer_box?.x ?? '',
      boxYInput: question?.answer_box?.y ?? '',
      boxWidthInput: question?.answer_box?.width ?? '',
      boxHeightInput: question?.answer_box?.height ?? ''
    };

    Object.entries(fields).forEach(([id, value]) => {
      document.getElementById(id).value = value;
      document.getElementById(id).disabled = !question;
    });
    document.getElementById('deleteQuestionBtn').disabled = !question;
  }

  function renderQuestionTable() {
    const tbody = document.getElementById('questionTableBody');
    const questions = [...state.questions].sort((a, b) => Number(a.question_number) - Number(b.question_number));
    if (!questions.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="vocab-empty">先在畫面上拖曳畫框建立題目。</td></tr>';
      return;
    }

    tbody.innerHTML = questions.map(question => `
      <tr class="${question.client_key === state.selectedQuestionKey ? 'vocab-row-active' : ''}">
        <td><button class="vocab-row-button" type="button" data-key="${question.client_key}">${question.question_number}</button></td>
        <td>${question.page_number}</td>
        <td>${escHtml(question.answer_text || '未填')}</td>
        <td>${question.points}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-key]').forEach(button => {
      button.addEventListener('click', () => selectQuestion(button.dataset.key));
    });
  }

  function selectQuestion(key) {
    const question = state.questions.find(item => item.client_key === key);
    if (!question) return;
    state.selectedQuestionKey = question.client_key;
    if (Number(question.page_number) !== Number(state.currentPage)) {
      state.currentPage = Number(question.page_number);
      loadCurrentPage();
      return;
    }
    syncEditorRegions();
    renderQuestionTable();
    renderQuestionForm();
  }

  function applyQuestionForm() {
    const question = getSelectedQuestion();
    if (!question) return;

    question.question_number = Number(document.getElementById('questionNumberInput').value || question.question_number);
    question.page_number = Number(document.getElementById('questionPageInput').value || question.page_number);
    question.points = Number(document.getElementById('questionPointsInput').value || question.points || 5);
    question.prompt_type = document.getElementById('questionPromptTypeInput').value || 'picture_word';
    question.answer_text = document.getElementById('questionAnswerInput').value.trim();
    question.answer_box = {
      x: Number(document.getElementById('boxXInput').value || question.answer_box.x),
      y: Number(document.getElementById('boxYInput').value || question.answer_box.y),
      width: Number(document.getElementById('boxWidthInput').value || question.answer_box.width),
      height: Number(document.getElementById('boxHeightInput').value || question.answer_box.height)
    };

    const newPage = Number(question.page_number);
    renderQuestionTable();
    if (newPage !== Number(state.currentPage)) {
      state.currentPage = newPage;
      loadCurrentPage();
      return;
    }
    syncEditorRegions();
  }

  function deleteSelectedQuestion() {
    const question = getSelectedQuestion();
    if (!question) return;
    state.questions = state.questions.filter(item => item.client_key !== question.client_key);
    state.selectedQuestionKey = null;
    syncEditorRegions();
    renderQuestionTable();
    renderQuestionForm();
  }

  function renumberQuestions() {
    const ordered = [...state.questions].sort((a, b) => {
      if (Number(a.page_number) !== Number(b.page_number)) {
        return Number(a.page_number) - Number(b.page_number);
      }
      return Number(a.question_number) - Number(b.question_number);
    });
    ordered.forEach((question, index) => {
      question.question_number = index + 1;
    });
    state.questions = ordered;
    syncEditorRegions();
    renderQuestionTable();
    renderQuestionForm();
    showToast('題號已重新排序');
  }

  function collectExamPayload() {
    const sourceType = getCurrentSourceType();
    const title = document.getElementById('examTitle').value.trim() || defaultTitleForCurrentSource();
    const payload = {
      source_type: sourceType,
      title,
      pass_score: getPassScore(),
      status: 'draft',
      pages: state.pages,
      questions: state.questions.map(question => ({
        page_number: question.page_number,
        question_number: question.question_number,
        prompt_type: question.prompt_type,
        answer_text: question.answer_text,
        answer_box: question.answer_box,
        points: question.points
      }))
    };

    if (sourceType === 'howdy') {
      payload.howdy_level = Number(document.getElementById('howdyLevel').value);
      payload.unit = Number(document.getElementById('unitNumber').value);
      payload.book_type = document.getElementById('bookType').value;
    } else {
      payload.howdy_level = null;
      payload.unit = null;
      payload.book_type = null;
      if (!title) {
        payload.title = document.getElementById('customTitle').value.trim();
      }
    }

    return payload;
  }

  async function saveExam(options = {}) {
    const publishAfter = Boolean(options.publishAfter);
    const payload = collectExamPayload();
    const saveButton = publishAfter ? document.getElementById('publishBtn') : document.getElementById('saveDraftBtn');
    const originalText = saveButton.textContent;

    saveButton.disabled = true;
    saveButton.textContent = publishAfter ? '發布中…' : '儲存中…';

    try {
      const url = state.examId ? `/api/vocab/exams/${state.examId}` : '/api/vocab/exams';
      const method = state.examId ? 'PATCH' : 'POST';
      const saved = await apiCall(url, { method, body: payload });
      state.examId = saved.id;
      state.pages = saved.pages || state.pages;
      state.questions = (saved.questions || []).map(question => ({
        ...question,
        client_key: question.client_key || String(question.id || nextQuestionKey())
      }));
      state.blankUploads = state.pages.map(page => page.blank_image);
      state.answerUploads = state.pages.map(page => page.answer_key_image);

      if (publishAfter) {
        await apiCall(`/api/vocab/exams/${state.examId}/publish`, { method: 'POST', body: {} });
        showToast('考卷已發布');
      } else {
        showToast('草稿已儲存');
      }

      renderUploadPreview('blankPreview', state.blankUploads);
      renderUploadPreview('answerPreview', state.answerUploads);
      loadCurrentPage();
      loadExamList();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalText;
    }
  }

  function resetBuilder() {
    state.examId = null;
    state.pages = [];
    state.questions = [];
    state.currentPage = 1;
    state.selectedQuestionKey = null;
    state.blankUploads = [];
    state.answerUploads = [];
    state.showAnswerPreview = false;

    document.querySelector('input[name="sourceType"][value="howdy"]').checked = true;
    document.getElementById('customTitle').value = '';
    document.getElementById('examTitle').value = '';
    setPassScore(80);
    document.getElementById('howdyLevel').value = '1';
    document.getElementById('unitNumber').value = '1';
    document.getElementById('bookType').value = 'A';

    document.getElementById('blankPreview').innerHTML = '';
    document.getElementById('answerPreview').innerHTML = '';
    document.getElementById('blankUploadBox').classList.remove('has-file');
    document.getElementById('answerUploadBox').classList.remove('has-file');
    document.getElementById('answerPreviewWrap').classList.add('vocab-hidden');
    document.getElementById('toggleAnswerBtn').textContent = '顯示答案頁';

    updateSourceFields();
    loadCurrentPage();
  }

  async function loadExamList() {
    const tbody = document.getElementById('examListBody');
    tbody.innerHTML = '<tr><td colspan="9" class="vocab-empty">載入中…</td></tr>';

    try {
      const exams = await apiCall('/api/vocab/exams?scope=teacher');
      if (!exams.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="vocab-empty">尚未建立任何考卷。</td></tr>';
        return;
      }

      tbody.innerHTML = exams.map(exam => `
        <tr>
          <td>${escHtml(exam.title)}</td>
          <td>${exam.source_type === 'howdy'
            ? `Howdy ${exam.howdy_level} / Unit ${exam.unit} / ${exam.book_type}`
            : 'Custom'}</td>
          <td>${exam.page_count}</td>
          <td>${exam.question_count}</td>
          <td>${exam.pass_score}</td>
          <td><span class="vocab-badge ${exam.status}">${exam.status}</span></td>
          <td>${exam.submission_count}</td>
          <td>${new Date(exam.updated_at || exam.created_at).toLocaleString('zh-TW')}</td>
          <td>
            <div class="vocab-actions">
              <button class="vocab-btn secondary" type="button" data-edit="${exam.id}">編輯</button>
              ${exam.status !== 'published'
                ? `<button class="vocab-btn success" type="button" data-publish="${exam.id}">發布</button>`
                : ''}
              <button class="vocab-btn ghost" type="button" data-open="${exam.id}">學生頁</button>
            </div>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-edit]').forEach(button => {
        button.addEventListener('click', () => editExam(button.dataset.edit));
      });
      tbody.querySelectorAll('[data-publish]').forEach(button => {
        button.addEventListener('click', async () => {
          try {
            await apiCall(`/api/vocab/exams/${button.dataset.publish}/publish`, { method: 'POST', body: {} });
            showToast('考卷已發布');
            loadExamList();
          } catch (error) {
            showToast(error.message, 'error');
          }
        });
      });
      tbody.querySelectorAll('[data-open]').forEach(button => {
        button.addEventListener('click', () => {
          window.open(`vocab-exam.html?id=${button.dataset.open}`, '_blank');
        });
      });
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="9" class="vocab-empty">${escHtml(error.message)}</td></tr>`;
    }
  }

  async function editExam(examId) {
    try {
      const exam = await apiCall(`/api/vocab/exams/${examId}`);
      state.examId = exam.id;
      state.pages = exam.pages || [];
      state.questions = (exam.questions || []).map(question => ({
        ...question,
        client_key: String(question.id || nextQuestionKey())
      }));
      state.blankUploads = state.pages.map(page => page.blank_image);
      state.answerUploads = state.pages.map(page => page.answer_key_image);
      state.currentPage = 1;
      state.selectedQuestionKey = state.questions[0]?.client_key || null;
      state.showAnswerPreview = false;

      document.querySelector(`input[name="sourceType"][value="${exam.source_type}"]`).checked = true;
      document.getElementById('howdyLevel').value = String(exam.howdy_level || 1);
      document.getElementById('unitNumber').value = String(exam.unit || 1);
      document.getElementById('bookType').value = exam.book_type || 'A';
      document.getElementById('customTitle').value = exam.source_type === 'custom' ? exam.title : '';
      document.getElementById('examTitle').value = exam.title || '';
      setPassScore(exam.pass_score || 80);
      document.getElementById('blankUploadBox').classList.toggle('has-file', state.blankUploads.length > 0);
      document.getElementById('answerUploadBox').classList.toggle('has-file', state.answerUploads.length > 0);
      renderUploadPreview('blankPreview', state.blankUploads);
      renderUploadPreview('answerPreview', state.answerUploads);
      updateSourceFields();
      switchTab('builder');
      loadCurrentPage();
      showToast('已載入考卷');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function switchTab(tab) {
    const builder = document.getElementById('builderTab');
    const list = document.getElementById('listTab');
    const builderBtn = document.getElementById('tabBuilderBtn');
    const listBtn = document.getElementById('tabListBtn');

    builder.classList.toggle('vocab-hidden', tab !== 'builder');
    list.classList.toggle('vocab-hidden', tab !== 'list');
    builderBtn.classList.toggle('secondary', tab !== 'builder');
    builderBtn.classList.toggle('primary', tab === 'builder');
    listBtn.classList.toggle('secondary', tab === 'builder');
    listBtn.classList.toggle('primary', tab === 'list');

    if (tab === 'list') {
      loadExamList();
    } else if (state.pages.length) {
      loadCurrentPage();
    }
  }

  async function convertImageFileToBase64(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'pdf') {
      return convertPdfToBase64Pages(file);
    }
    if (extension === 'heic' || file.type === 'image/heic') {
      const raw = await fileToBase64(file);
      const response = await apiCall('/api/convert-heic', { method: 'POST', body: { image: raw } });
      return [response.image];
    }

    const image = await fileToImageBase64(file);
    return [image];
  }

  function fileToImageBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const maxDim = 2800;
          let width = image.width;
          let height = image.height;
          if (Math.max(width, height) > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
        };
        image.onerror = reject;
        image.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function convertPdfToBase64Pages(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js 未載入');
    }
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
      const page = await pdf.getPage(pageIndex);
      const viewport = page.getViewport({ scale: 2.3 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
    }
    return pages;
  }

  async function handlePageUpload(kind, files) {
    if (!files.length) return;

    try {
      const pages = [];
      for (const file of Array.from(files)) {
        const convertedPages = await convertImageFileToBase64(file);
        pages.push(...convertedPages);
      }

      if (!pages.length || pages.length > 4) {
        throw new Error('考卷頁數必須介於 1 到 4 頁');
      }

      if (kind === 'blank') {
        state.blankUploads = pages;
      } else {
        state.answerUploads = pages;
      }

      const currentBlank = state.blankUploads.length ? state.blankUploads : state.pages.map(page => page.blank_image);
      const currentAnswer = state.answerUploads.length ? state.answerUploads : state.pages.map(page => page.answer_key_image);

      if (currentBlank.length && currentAnswer.length) {
        if (currentBlank.length !== currentAnswer.length) {
          throw new Error('空白卷和答案卷頁數不一致');
        }
        state.pages = currentBlank.map((blankImage, index) => ({
          page_number: index + 1,
          blank_image: blankImage,
          answer_key_image: currentAnswer[index]
        }));
        state.questions = state.questions.filter(question => Number(question.page_number) <= state.pages.length);
        state.currentPage = Math.min(state.currentPage, state.pages.length) || 1;
      }

      renderUploadPreview('blankPreview', state.blankUploads.length ? state.blankUploads : state.pages.map(page => page.blank_image));
      renderUploadPreview('answerPreview', state.answerUploads.length ? state.answerUploads : state.pages.map(page => page.answer_key_image));
      document.getElementById('blankUploadBox').classList.toggle('has-file', (state.blankUploads.length || state.pages.length) > 0);
      document.getElementById('answerUploadBox').classList.toggle('has-file', (state.answerUploads.length || state.pages.length) > 0);

      await loadCurrentPage();
      showToast('頁面已更新');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function init() {
    const allowed = await ensureTeacherAccess({ redirectTo: 'index.html' });
    if (!allowed) return;

    const howdySelect = document.getElementById('howdyLevel');
    const unitSelect = document.getElementById('unitNumber');
    for (let index = 1; index <= 10; index++) {
      howdySelect.insertAdjacentHTML('beforeend', `<option value="${index}">${index}</option>`);
      const unitLabel = index === 9 ? 'Review 1' : index === 10 ? 'Review 2' : `Unit ${index}`;
      unitSelect.insertAdjacentHTML('beforeend', `<option value="${index}">${unitLabel}</option>`);
    }
    howdySelect.value = '1';
    unitSelect.value = '1';

    document.querySelectorAll('input[name="sourceType"]').forEach(input => {
      input.addEventListener('change', updateSourceFields);
    });
    ['howdyLevel', 'unitNumber', 'bookType', 'customTitle'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateSourceFields);
      document.getElementById(id).addEventListener('change', updateSourceFields);
    });
    document.getElementById('tabBuilderBtn').addEventListener('click', () => switchTab('builder'));
    document.getElementById('tabListBtn').addEventListener('click', () => switchTab('list'));
    document.getElementById('saveDraftBtn').addEventListener('click', () => saveExam({ publishAfter: false }));
    document.getElementById('publishBtn').addEventListener('click', () => saveExam({ publishAfter: true }));
    document.getElementById('renumberBtn').addEventListener('click', renumberQuestions);
    document.getElementById('resetBtn').addEventListener('click', resetBuilder);
    document.getElementById('refreshListBtn').addEventListener('click', loadExamList);
    document.getElementById('deleteQuestionBtn').addEventListener('click', deleteSelectedQuestion);
    document.getElementById('toggleAnswerBtn').addEventListener('click', () => {
      state.showAnswerPreview = !state.showAnswerPreview;
      document.getElementById('toggleAnswerBtn').textContent = state.showAnswerPreview ? '隱藏答案頁' : '顯示答案頁';
      loadCurrentPage();
    });

    document.getElementById('blankUploadInput').addEventListener('change', event => {
      handlePageUpload('blank', event.target.files);
      event.target.value = '';
    });
    document.getElementById('answerUploadInput').addEventListener('change', event => {
      handlePageUpload('answer', event.target.files);
      event.target.value = '';
    });

    [
      'questionNumberInput',
      'questionPageInput',
      'questionPointsInput',
      'questionPromptTypeInput',
      'questionAnswerInput',
      'boxXInput',
      'boxYInput',
      'boxWidthInput',
      'boxHeightInput'
    ].forEach(id => {
      document.getElementById(id).addEventListener('input', applyQuestionForm);
      document.getElementById(id).addEventListener('change', applyQuestionForm);
    });

    updateSourceFields();
    populateQuestionPageOptions();
    renderQuestionForm();
    renderQuestionTable();
    loadExamList();
  }

  init();
})();
