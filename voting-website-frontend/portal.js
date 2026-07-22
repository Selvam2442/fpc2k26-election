const API_BASE_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:5000'
  : 'https://fpc2k26-election.onrender.com';

const Portal = {
  read(key) { return localStorage.getItem(key) || sessionStorage.getItem(key); },
  store(key, value, remember = localStorage.getItem('rememberStudent') === 'true') {
    const primary = remember ? localStorage : sessionStorage;
    const secondary = remember ? sessionStorage : localStorage;
    secondary.removeItem(key);
    primary.setItem(key, String(value));
  },
  clearStudent() {
    ['studentToken', 'voterToken', 'rollNumber', 'studentName', 'studentClass', 'hasVoted'].forEach(key => {
      localStorage.removeItem(key); sessionStorage.removeItem(key);
    });
  },
  studentToken() { return this.read('studentToken') || this.read('voterToken'); },
  adminToken() { return localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken'); },
  async request(path, options = {}, role = '') {
    const headers = new Headers(options.headers || {});
    const token = role === 'admin' ? this.adminToken() : role === 'student' ? this.studentToken() : '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    if (response.status === 401 && role === 'student') { this.clearStudent(); window.location.href = 'index.html'; }
    if (response.status === 401 && role === 'admin') { localStorage.removeItem('adminToken'); window.location.href = 'index.html'; }
    return response;
  },
  escape(value) {
    const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML;
  },
  date(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
  },
  logoutStudent() { this.clearStudent(); window.location.href = 'index.html'; },
  logoutAdmin() { localStorage.removeItem('adminToken'); sessionStorage.removeItem('adminToken'); window.location.href = 'index.html'; }
};

window.Portal = Portal;
