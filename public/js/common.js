// === API Helpers ===
const API_BASE = window.location.origin;

async function apiCall(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const defaultOptions = {
    headers: { 'Content-Type': 'application/json' }
  };
  const merged = { ...defaultOptions, ...options };
  if (options.body && typeof options.body === 'object') {
    merged.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, merged);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
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
