(function () {
  const params = new URLSearchParams(window.location.search);
  const submissionId = Number(params.get('id') || 0);

  function escHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function renderResult(submission) {
    document.getElementById('scoreDisplay').textContent = `${submission.total_score} / ${submission.total_possible}`;
    document.getElementById('resultTitle').textContent = submission.title;
    document.getElementById('resultMeta').innerHTML = [
      submission.student_name,
      `第 ${submission.attempt_no} 次`,
      `${submission.percentage}%`,
      `通過門檻 ${submission.pass_score}`
    ].map(text => `<span>${escHtml(text)}</span>`).join('');

    const passBadge = document.getElementById('passBadge');
    passBadge.textContent = submission.passed ? '通過' : '未通過';
    passBadge.className = `vocab-badge ${submission.passed ? 'pass' : 'fail'}`;

    const tbody = document.getElementById('gradedAnswerBody');
    const answers = submission.graded_answers || [];
    tbody.innerHTML = answers.map(answer => `
      <tr>
        <td>${answer.question_number}</td>
        <td>${answer.correct ? 'O' : 'X'}</td>
        <td>${escHtml(answer.detected_text || '(blank)')}</td>
        <td>${escHtml(answer.correct_answer || '')}</td>
        <td>${answer.score} / ${answer.points}</td>
      </tr>
    `).join('');

    const actions = document.getElementById('resultActions');
    actions.innerHTML = '<a class="vocab-btn secondary" href="vocab-exam.html">回到考卷列表</a>';

    if (!submission.passed && Array.isArray(submission.wrong_question_ids) && submission.wrong_question_ids.length) {
      const retestLink = document.createElement('a');
      retestLink.className = 'vocab-btn primary';
      retestLink.href = `vocab-retest.html?submission=${submission.id}`;
      retestLink.textContent = '開始錯題重考';
      actions.appendChild(retestLink);
    }
  }

  async function init() {
    if (!submissionId) {
      showToast('缺少 submission id', 'error');
      return;
    }

    try {
      const submission = await apiCall(`/api/vocab/submissions/${submissionId}`);
      renderResult(submission);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  init();
})();
