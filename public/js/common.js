// === API Helpers ===
const API_BASE = window.location.origin;

async function apiCall(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const defaultOptions = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin'
  };
  const merged = { ...defaultOptions, ...options };
  merged.headers = { ...defaultOptions.headers, ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object') {
    merged.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, merged);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

// === Teacher Passcode Gate ===
async function getTeacherAuthStatus() {
  return apiCall('/api/teacher-auth/status');
}

async function verifyTeacherPasscode(passcode) {
  return apiCall('/api/teacher-auth/verify', {
    method: 'POST',
    body: { passcode }
  });
}

async function logoutTeacherAccess() {
  return apiCall('/api/teacher-auth/logout', {
    method: 'POST',
    body: {}
  });
}

async function ensureTeacherAccess(options = {}) {
  const redirectTo = options.redirectTo ?? 'index.html';
  const status = await getTeacherAuthStatus();
  if (!status.enabled || status.authenticated) return true;

  while (true) {
    const passcode = window.prompt('請輸入教師 passcode');
    if (passcode === null) {
      if (redirectTo) window.location.href = redirectTo;
      return false;
    }

    const trimmed = passcode.trim();
    if (!trimmed) {
      window.alert('請先輸入教師 passcode。');
      continue;
    }

    try {
      await verifyTeacherPasscode(trimmed);
      return true;
    } catch (_) {
      window.alert('教師 passcode 錯誤，請再試一次。');
    }
  }
}

// === Toast Notifications ===
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// === File to Base64 ===
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove the data:image/...;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// === Setup Upload Zone ===
function setupUploadZone(zoneEl, inputEl, onFile) {
  zoneEl.addEventListener('click', () => inputEl.click());

  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneEl.classList.add('dragover');
  });

  zoneEl.addEventListener('dragleave', () => {
    zoneEl.classList.remove('dragover');
  });

  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) onFile(files);
  });

  inputEl.addEventListener('change', () => {
    if (inputEl.files.length > 0) onFile(inputEl.files);
  });
}

// === Teacher Name Persistence ===
function getTeacherName() {
  return localStorage.getItem('teacher_name') || '';
}

function setTeacherName(name) {
  localStorage.setItem('teacher_name', name);
}
