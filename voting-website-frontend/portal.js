const API_BASE_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:5000'
  : 'https://fpc2k26-election.onrender.com';

let installPrompt = null;

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
  applyTheme(theme = localStorage.getItem('portalTheme') || localStorage.getItem('studentTheme') || 'light') {
    const dark = theme === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071526' : '#07152e');
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
      button.innerHTML = `<i class="fa-solid fa-${dark ? 'sun' : 'moon'}"></i><span>${dark ? 'Light' : 'Dark'}</span>`;
    });
  },
  toggleTheme() {
    const theme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
    localStorage.setItem('portalTheme', theme);
    localStorage.setItem('studentTheme', theme);
    this.applyTheme(theme);
  },
  prepareVoteFeedback() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this._voteAudioContext ||= new AudioContext();
      if (this._voteAudioContext.state === 'suspended') this._voteAudioContext.resume().catch(() => {});
    } catch (_) {}
  },
  celebrateVote() {
    if (navigator.vibrate) navigator.vibrate([180, 80, 260]);
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = this._voteAudioContext || new AudioContext();
      const play = (frequency, start, duration) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
        gain.gain.setValueAtTime(0.0001, context.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(context.currentTime + start);
        oscillator.stop(context.currentTime + start + duration);
      };
      play(523.25, 0, 0.2); play(659.25, 0.16, 0.22); play(783.99, 0.34, 0.34);
      setTimeout(() => { context.close().catch(() => {}); this._voteAudioContext = null; }, 1000);
    } catch (_) {}
  },
  logoutStudent() { this.clearStudent(); window.location.href = 'index.html'; },
  logoutAdmin() { localStorage.removeItem('adminToken'); sessionStorage.removeItem('adminToken'); window.location.href = 'index.html'; },
  async installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelectorAll('[data-install-app]').forEach(button => button.classList.add('hidden'));
  }
};

window.Portal = Portal;
Portal.applyTheme();

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelectorAll('[data-install-app]').forEach(button => button.classList.remove('hidden'));
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelectorAll('[data-install-app]').forEach(button => button.classList.add('hidden'));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
