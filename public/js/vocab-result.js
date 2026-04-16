(function () {
  const params = new URLSearchParams(window.location.search);
  const submissionId = Number(params.get('id') || 0);

  function escHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function getAttemptModeLabel(mode) {
    if (mode === 'retest') return '錯題再考';
    if (mode === 'final') return '最後驗收';
    return '首次作答';
  }

  function getStatusState(submission) {
    const wrongCount = Array.isArray(submission.wrong_question_ids) ? submission.wrong_question_ids.length : 0;

    if (submission.attempt_mode === 'retest') {
      if (wrongCount > 0) {
        return {
          badgeText: '仍有錯題',
          badgeClass: 'fail',
          note: `這一輪還有 ${wrongCount} 題錯誤，先複習再重考這些題目。`,
          primaryAction: {
            href: `vocab-review.html?submission=${submission.id}`,
            text: '先複習錯題'
          }
        };
      }

      return {
        badgeText: '錯題清空',
        badgeClass: 'pass',
        note: '這一輪錯題已經全部改正，接著進入整張考卷的最後驗收。',
        primaryAction: {
          href: `vocab-exam.html?id=${submission.exam_id}&mode=final&source=${submission.id}`,
          text: '進入最後驗收'
        }
      };
    }

    if (submission.attempt_mode === 'final') {
      if (submission.passed) {
        return {
          badgeText: '驗收通過',
          badgeClass: 'pass',
          note: '整張考卷已達到通過門檻，這輪學習流程完成。'
        };
      }

      return {
        badgeText: '驗收未通過',
        badgeClass: 'fail',
        note: wrongCount > 0
          ? `最後驗收還有 ${wrongCount} 題錯誤，先複習這些題目再回來驗收。`
          : '最後驗收尚未達標，請再做一次整份考卷。',
        primaryAction: wrongCount > 0
          ? {
              href: `vocab-review.html?submission=${submission.id}`,
              text: '先複習錯題'
            }
          : {
              href: `vocab-exam.html?id=${submission.exam_id}&mode=final&source=${submission.id}`,
              text: '再做一次最後驗收'
            }
      };
    }

    if (!submission.passed && wrongCount > 0) {
      return {
        badgeText: '需要複習',
        badgeClass: 'fail',
        note: `先複習這次答錯的 ${wrongCount} 題，再進入錯題再考。`,
        primaryAction: {
          href: `vocab-review.html?submission=${submission.id}`,
          text: '先複習錯題'
        }
      };
    }

    return {
      badgeText: submission.passed ? '通過' : '未通過',
      badgeClass: submission.passed ? 'pass' : 'fail',
      note: submission.passed ? '這份考卷已通過。' : '可以回到考卷列表，重新作答。'
    };
  }

  function renderResult(submission) {
    document.getElementById('scoreDisplay').textContent = `${submission.percentage} / 100`;
    document.getElementById('rawScoreDisplay').textContent = `本輪題分 ${submission.total_score} / ${submission.total_possible}`;
    document.getElementById('resultTitle').textContent = submission.title;
    document.getElementById('resultMeta').innerHTML = [
      submission.student_name,
      `第 ${submission.attempt_no} 次`,
      getAttemptModeLabel(submission.attempt_mode),
      `答對率 ${submission.percentage}%`,
      `通過門檻 ${submission.pass_score}%`
    ].map(text => `<span>${escHtml(text)}</span>`).join('');

    const statusState = getStatusState(submission);
    const passBadge = document.getElementById('passBadge');
    passBadge.textContent = statusState.badgeText;
    passBadge.className = `vocab-badge ${statusState.badgeClass}`;

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
    if (statusState.primaryAction) {
      const actionLink = document.createElement('a');
      actionLink.className = 'vocab-btn primary';
      actionLink.href = statusState.primaryAction.href;
      actionLink.textContent = statusState.primaryAction.text;
      actions.appendChild(actionLink);
    }

    const note = document.getElementById('resultNextStepNote');
    if (statusState.note) {
      note.textContent = statusState.note;
      note.classList.remove('vocab-hidden');
    } else {
      note.textContent = '';
      note.classList.add('vocab-hidden');
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
