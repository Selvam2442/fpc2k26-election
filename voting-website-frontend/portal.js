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
  clearStaff() {
    ['staffToken', 'staffId', 'staffName'].forEach(key => {
      localStorage.removeItem(key); sessionStorage.removeItem(key);
    });
  },
  studentToken() { return this.read('studentToken') || this.read('voterToken'); },
  staffToken() { return this.read('staffToken'); },
  adminToken() { return localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken'); },
  async request(path, options = {}, role = '') {
    const headers = new Headers(options.headers || {});
    const token = role === 'admin' ? this.adminToken() : role === 'student' ? this.studentToken() : role === 'staff' ? this.staffToken() : '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    if (response.status === 401 && role === 'student') { this.clearStudent(); window.location.href = 'index.html'; }
    if (response.status === 401 && role === 'staff') { this.clearStaff(); window.location.href = 'index.html'; }
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
  logoutStaff() { this.clearStaff(); window.location.href = 'index.html'; },
  logoutAdmin() { localStorage.removeItem('adminToken'); sessionStorage.removeItem('adminToken'); window.location.href = 'index.html'; },
  async installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelectorAll('[data-install-app]').forEach(button => button.classList.add('hidden'));
  },
  notificationSupportAvailable() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  applicationServerKey(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(base64);
    return Uint8Array.from(bytes, character => character.charCodeAt(0));
  },
  notificationRole() {
    return this.staffToken() ? 'staff' : 'student';
  },
  async refreshAnnouncementNotificationButtons() {
    const buttons = document.querySelectorAll('[data-announcement-notifications]');
    if (!buttons.length) return;
    if (!this.notificationSupportAvailable()) {
      buttons.forEach(button => button.classList.add('hidden'));
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const roleMatches = localStorage.getItem('notificationSubscriptionRole') === this.notificationRole();
    buttons.forEach(button => {
      button.classList.remove('hidden');
      button.setAttribute('aria-pressed', String(Boolean(subscription && roleMatches)));
      button.innerHTML = subscription && roleMatches
        ? '<i class="fa-solid fa-bell"></i><span>Alerts on</span>'
        : '<i class="fa-regular fa-bell"></i><span>Enable alerts</span>';
    });
  },
  async toggleAnnouncementNotifications(button) {
    if (!this.notificationSupportAvailable()) return;
    button.disabled = true;
    try {
      const role = this.notificationRole();
      const registration = await navigator.serviceWorker.ready;
      let existing = await registration.pushManager.getSubscription();
      const existingRole = localStorage.getItem('notificationSubscriptionRole');
      if (existing && existingRole === role) {
        await this.request(`/api/${role}/push/subscriptions`, {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: existing.endpoint })
        }, role);
        await existing.unsubscribe();
        localStorage.removeItem('notificationSubscriptionRole');
      } else {
        if (existing) {
          await existing.unsubscribe();
          localStorage.removeItem('notificationSubscriptionRole');
          existing = null;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Allow notifications in your browser to receive campus alerts.');
        const keyResponse = await this.request(`/api/${role}/push/public-key`, {}, role);
        const keyData = await keyResponse.json();
        if (!keyResponse.ok || !keyData.publicKey) throw new Error(keyData.message || 'Notifications are unavailable.');
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.applicationServerKey(keyData.publicKey)
        });
        const response = await this.request(`/api/${role}/push/subscriptions`, {
          method: 'POST',
          body: JSON.stringify({ subscription: subscription.toJSON() })
        }, role);
        if (!response.ok) {
          await subscription.unsubscribe();
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Could not enable notifications.');
        }
        localStorage.setItem('notificationSubscriptionRole', role);
      }
      await this.refreshAnnouncementNotificationButtons();
    } catch (error) {
      window.alert(error.message || 'Could not update notification settings.');
    } finally {
      button.disabled = false;
    }
  },
  roleTourSteps(role, name) {
    const firstName = String(name || role).trim().split(/\s+/)[0];
    if (role === 'student') return [
      { icon: 'fa-hand-sparkles', title: `Welcome, ${firstName}`, body: 'This is your verified student space. Your profile comes directly from the live college register.', target: '.college-hero' },
      { icon: 'fa-bullhorn', title: 'Never miss an update', body: 'Official notices for all students or your class appear here.', target: '#announcements' },
      { icon: 'fa-calendar-week', title: 'Your class timetable', body: 'The timetable is personalized from your class record and highlights the current period.', target: '#timetable' },
      { icon: 'fa-check-to-slot', title: 'Vote securely', body: 'Open Campus voting when the election is live. Each verified student can submit only one ballot.', target: 'a[href="students.html"]' },
      { icon: 'fa-bell', title: 'Enable official alerts', body: 'Allow notifications to receive trusted Kamaraj College announcements even when the app is closed.', target: '[data-announcement-notifications]', action: 'notifications' }
    ];
    if (role === 'staff') return [
      { icon: 'fa-hand-sparkles', title: `Welcome, ${firstName}`, body: 'This staff portal is personalized from the live staff register and keeps student-only tools separate.', target: '.staff-hero' },
      { icon: 'fa-bullhorn', title: 'Staff announcements', body: 'See college-wide and staff-only notices in one official feed.', target: '#announcements' },
      { icon: 'fa-chart-pie', title: 'Election participation', body: 'When administration approves staff voting, cast your secure ballot here. Until completion, you will see progress but not candidate totals.', target: '#election' },
      { icon: 'fa-bell', title: 'Enable official alerts', body: 'Allow notifications to receive trusted staff announcements even when the app is closed.', target: '[data-announcement-notifications]', action: 'notifications' }
    ];
    return [
      { icon: 'fa-shield-halved', title: 'Welcome, Administrator', body: 'This protected control centre manages official portal data and communication.', target: '#overview' },
      { icon: 'fa-users', title: 'Live directories', body: 'Student and staff identities remain connected to their separate official spreadsheets.', target: '[data-view="students"]' },
      { icon: 'fa-paper-plane', title: 'Publish by audience', body: 'Send notices to students, staff, everyone, or selected student classes.', target: '[data-view="announcements"]' },
      { icon: 'fa-check-to-slot', title: 'Election controls', body: 'Open or pause voting, manage candidates, and review participation securely.', target: '[data-view="election"]' }
    ];
  },
  showAdvancedRoleTour(role, name, force = false) {
    const storageKey = `kc-fpc-tour-${role}-v3`;
    if (!force && localStorage.getItem(storageKey) === 'complete') return;
    this._activeTourClose?.();
    document.querySelector('.app-tour-layer')?.remove();
    const steps = this.roleTourSteps(role, name);
    const adminViews = ['overview', 'students', 'announcements', 'election'];
    let index = 0;
    let target = null;
    let positionTimer = 0;
    let closed = false;
    const previouslyFocused = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'app-tour-layer';
    layer.innerHTML = '<div class="app-tour-shade"></div><div class="app-tour-spotlight" aria-hidden="true"></div><section class="app-tour-card" role="dialog" aria-modal="true" aria-live="polite" aria-label="Portal guided tour"></section>';
    document.body.appendChild(layer);
    document.body.classList.add('tour-is-active');
    const card = layer.querySelector('.app-tour-card');
    const spotlight = layer.querySelector('.app-tour-spotlight');
    const findTarget = step => {
      if (role === 'admin') {
        const view = adminViews[index];
        document.querySelector(`[data-view="${view}"]`)?.click();
        return document.querySelector(`#${view} .section-head, #${view} .election-switch-card, #${view}`);
      }
      return document.querySelector(step.target);
    };
    const place = () => {
      if (closed || !layer.isConnected) return;
      if (!target?.isConnected) {
        spotlight.classList.remove('visible');
        card.removeAttribute('style');
        card.classList.add('tour-card-centred');
        return;
      }
      card.classList.remove('tour-card-centred');
      const rect = target.getBoundingClientRect();
      const padding = innerWidth < 700 ? 6 : 10;
      const left = Math.max(8, rect.left - padding);
      const top = Math.max(8, rect.top - padding);
      spotlight.style.left = `${left}px`;
      spotlight.style.top = `${top}px`;
      spotlight.style.width = `${Math.max(24, Math.min(innerWidth - left - 8, rect.width + padding * 2))}px`;
      spotlight.style.height = `${Math.max(24, Math.min(innerHeight - top - 8, rect.height + padding * 2))}px`;
      spotlight.style.borderRadius = `${Math.min(28, Math.max(12, parseFloat(getComputedStyle(target).borderRadius) || 16))}px`;
      spotlight.classList.add('visible');
      card.style.left = card.style.right = card.style.top = card.style.bottom = 'auto';
      if (innerWidth <= 700) {
        card.style.left = '14px';
        card.style.bottom = 'calc(78px + env(safe-area-inset-bottom))';
        return;
      }
      const cardRect = card.getBoundingClientRect();
      const gap = 24;
      let cardLeft;
      let cardTop;
      if (innerWidth - rect.right >= cardRect.width + gap) {
        cardLeft = rect.right + gap;
        cardTop = rect.top + (rect.height - cardRect.height) / 2;
      } else if (rect.left >= cardRect.width + gap) {
        cardLeft = rect.left - cardRect.width - gap;
        cardTop = rect.top + (rect.height - cardRect.height) / 2;
      } else if (innerHeight - rect.bottom >= cardRect.height + gap) {
        cardLeft = rect.left + (rect.width - cardRect.width) / 2;
        cardTop = rect.bottom + gap;
      } else {
        cardLeft = rect.left + (rect.width - cardRect.width) / 2;
        cardTop = rect.top - cardRect.height - gap;
      }
      card.style.left = `${Math.min(Math.max(14, cardLeft), innerWidth - cardRect.width - 14)}px`;
      card.style.top = `${Math.min(Math.max(14, cardTop), innerHeight - cardRect.height - 14)}px`;
    };
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(positionTimer);
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
      removeEventListener('keydown', handleKey);
      document.body.classList.remove('tour-is-active');
      localStorage.setItem(storageKey, 'complete');
      if (this._activeTourClose === close) this._activeTourClose = null;
      layer.classList.add('tour-leaving');
      if (previouslyFocused?.focus) previouslyFocused.focus({ preventScroll: true });
      setTimeout(() => layer.remove(), 220);
    };
    this._activeTourClose = close;
    const move = direction => {
      const next = index + direction;
      if (next < 0 || next >= steps.length) return close();
      index = next;
      render(direction);
    };
    const handleKey = event => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    };
    const render = (direction = 1) => {
      const step = steps[index];
      target = findTarget(step);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      card.classList.remove('tour-card-enter', 'tour-card-enter-back', 'tour-card-nudge');
      card.innerHTML = `<button class="tour-close" type="button" aria-label="Close tour"><i class="fa-solid fa-xmark"></i></button><div class="tour-progress" aria-label="Tour progress">${steps.map((_, i) => `<span class="${i <= index ? 'active' : ''}"><i style="width:${i === index ? '100' : '0'}%"></i></span>`).join('')}</div><div class="tour-step-row"><div class="tour-icon"><i class="fa-solid ${step.icon}"></i></div><span class="tour-step-number">${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}</span></div><span class="eyebrow">Guided portal tour</span><h2>${this.escape(step.title)}</h2><p>${this.escape(step.body)}</p>${step.action === 'notifications' ? '<button class="btn btn-primary btn-block tour-notification-action"><i class="fa-solid fa-bell"></i> Enable official alerts</button>' : ''}<div class="tour-hint"><i class="fa-solid fa-keyboard"></i> Arrow keys also move through the tour</div><div class="tour-actions"><button class="btn btn-secondary tour-back">${index ? '<i class="fa-solid fa-arrow-left"></i> Back' : 'Skip tour'}</button><button class="btn btn-primary tour-next">${index === steps.length - 1 ? 'Finish <i class="fa-solid fa-check"></i>' : 'Next <i class="fa-solid fa-arrow-right"></i>'}</button></div>`;
      void card.offsetWidth;
      card.classList.add(direction < 0 ? 'tour-card-enter-back' : 'tour-card-enter');
      card.querySelector('.tour-close').onclick = close;
      card.querySelector('.tour-back').onclick = () => move(-1);
      card.querySelector('.tour-next').onclick = () => move(1);
      card.querySelector('.tour-next').focus({ preventScroll: true });
      clearTimeout(positionTimer);
      requestAnimationFrame(place);
      positionTimer = setTimeout(place, 480);
      const notificationAction = card.querySelector('.tour-notification-action');
      if (notificationAction) notificationAction.onclick = async () => {
        if (!this.notificationSupportAvailable()) {
          notificationAction.innerHTML = '<i class="fa-solid fa-circle-info"></i> Notifications are not supported here';
          notificationAction.disabled = true;
          return;
        }
        const topButton = document.querySelector('[data-announcement-notifications]');
        if (topButton) await this.toggleAnnouncementNotifications(topButton);
        notificationAction.innerHTML = Notification.permission === 'granted'
          ? '<i class="fa-solid fa-circle-check"></i> Official alerts enabled'
          : '<i class="fa-solid fa-bell"></i> Enable official alerts';
        place();
      };
    };
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    addEventListener('keydown', handleKey);
    layer.querySelector('.app-tour-shade').onclick = () => {
      card.classList.remove('tour-card-nudge');
      void card.offsetWidth;
      card.classList.add('tour-card-nudge');
    };
    render();
  },
  showRoleTour(role, name, force = false) {
    return this.showAdvancedRoleTour(role, name, force);
    const storageKey = `kc-fpc-tour-${role}-v2`;
    if (!force && localStorage.getItem(storageKey) === 'complete') return;
    document.querySelector('.app-tour-layer')?.remove();
    const steps = this.roleTourSteps(role, name);
    let index = 0;
    const layer = document.createElement('div');
    layer.className = 'app-tour-layer';
    layer.innerHTML = '<div class="app-tour-shade"></div><section class="app-tour-card" role="dialog" aria-modal="true" aria-live="polite"></section>';
    document.body.appendChild(layer);
    const card = layer.querySelector('.app-tour-card');
    const close = () => {
      document.querySelector('.tour-focus')?.classList.remove('tour-focus');
      localStorage.setItem(storageKey, 'complete');
      layer.remove();
    };
    const render = () => {
      document.querySelector('.tour-focus')?.classList.remove('tour-focus');
      const step = steps[index];
      const target = document.querySelector(step.target);
      if (target) {
        target.classList.add('tour-focus');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      card.innerHTML = `<div class="tour-progress">${steps.map((_, i) => `<span class="${i <= index ? 'active' : ''}"></span>`).join('')}</div><div class="tour-icon"><i class="fa-solid ${step.icon}"></i></div><span class="eyebrow">Quick tour · ${index + 1} of ${steps.length}</span><h2>${this.escape(step.title)}</h2><p>${this.escape(step.body)}</p>${step.action === 'notifications' ? '<button class="btn btn-primary btn-block tour-notification-action"><i class="fa-solid fa-bell"></i> Enable official alerts</button>' : ''}<div class="tour-actions"><button class="btn btn-secondary tour-skip">${index ? 'Back' : 'Skip tour'}</button><button class="btn btn-primary tour-next">${index === steps.length - 1 ? 'Finish' : 'Next'}</button></div>`;
      card.querySelector('.tour-skip').onclick = () => {
        if (index) { index -= 1; render(); } else close();
      };
      card.querySelector('.tour-next').onclick = () => {
        if (index === steps.length - 1) close();
        else { index += 1; render(); }
      };
      const notificationAction = card.querySelector('.tour-notification-action');
      if (notificationAction) notificationAction.onclick = async () => {
        if (!this.notificationSupportAvailable()) {
          notificationAction.innerHTML = '<i class="fa-solid fa-circle-info"></i> Notifications are not supported here';
          notificationAction.disabled = true;
          return;
        }
        const topButton = document.querySelector('[data-announcement-notifications]');
        if (topButton) await this.toggleAnnouncementNotifications(topButton);
        notificationAction.innerHTML = Notification.permission === 'granted'
          ? '<i class="fa-solid fa-circle-check"></i> Official alerts enabled'
          : '<i class="fa-solid fa-bell"></i> Enable official alerts';
      };
    };
    render();
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
    navigator.serviceWorker.register('./sw.js')
      .then(() => Portal.refreshAnnouncementNotificationButtons())
      .catch(() => {});
  });
}
