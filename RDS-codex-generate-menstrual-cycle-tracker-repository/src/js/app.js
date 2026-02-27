/* global I18N_RU */
(() => {
  const STORAGE_KEY = 'cycle-tracker-v4';
  const DAY = 24 * 60 * 60 * 1000;
  const BUILTIN_GROQ_API_KEY = '';
  const API_PREFIX = '/api';
  const t = I18N_RU;
  const pad2 = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => formatDate(new Date());
  const normalizeEmailValue = (value) => String(value || '').trim().toLowerCase();

  // Правила на основе средних значений женского цикла:
  // цикл обычно 21–35 дней, среднее 28; длительность менструации 3–8 дней, среднее 5.
  const CYCLE_RULES = {
    MIN_CYCLE_LENGTH: 21,
    MAX_CYCLE_LENGTH: 35,
    DEFAULT_CYCLE_LENGTH: 28,
    MIN_PERIOD_LENGTH: 3,
    MAX_PERIOD_LENGTH: 8,
    DEFAULT_PERIOD_LENGTH: 5,
    OVULATION_OFFSET: 14
  };

  const initialData = loadData();
  const state = {
    selectedDate: todayStr(),
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    tab: 'calendar',
    onboardingStep: 0,
    onboardingAnswers: {},
    data: initialData,
    selfData: initialData,
    partnerMode: false,
    partnerOwnerName: ''
  };
  const pendingPhaseRecommendationRequests = new Set();
  let tapSelectTimer = null;
  let lastTapDate = '';
  let lastTapTs = 0;
  let suppressClickUntil = 0;

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function createDataTemplate() {
    return {
      cycles: [],
      days: {},
      settings: {
        theme: 'auto',
        notifications: false,
        delayThreshold: 3,
        rules: {
          avgCycleLength: CYCLE_RULES.DEFAULT_CYCLE_LENGTH,
          avgPeriodLength: CYCLE_RULES.DEFAULT_PERIOD_LENGTH,
          allowedCycleRange: [CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH]
        }
      },
      profile: { name: '', email: '', flowType: '', goal: '', onboardingCompleted: false },
      auth: { email: '', password: '' },
      session: { loggedIn: false, authToken: '', userId: '' },
      pushSubscription: null,
      remindLaterUntil: null
    };
  }

  function normalizeStoredData(rawData) {
    const data = rawData && typeof rawData === 'object' ? rawData : {};
    const normalized = createDataTemplate();

    normalized.cycles = Array.isArray(data.cycles) ? data.cycles : [];
    normalized.days = data.days && typeof data.days === 'object' ? data.days : {};

    if (data.settings && typeof data.settings === 'object') {
      normalized.settings = {
        ...normalized.settings,
        ...data.settings,
        rules: {
          ...normalized.settings.rules,
          ...(data.settings.rules && typeof data.settings.rules === 'object' ? data.settings.rules : {})
        }
      };
    }
    normalized.settings.theme = normalized.settings.theme || 'auto';
    normalized.settings.notifications = Boolean(normalized.settings.notifications);
    normalized.settings.delayThreshold = Number(normalized.settings.delayThreshold) || 3;
    normalized.settings.rules.avgCycleLength = clamp(
      normalized.settings.rules.avgCycleLength,
      CYCLE_RULES.MIN_CYCLE_LENGTH,
      CYCLE_RULES.MAX_CYCLE_LENGTH,
      CYCLE_RULES.DEFAULT_CYCLE_LENGTH
    );
    normalized.settings.rules.avgPeriodLength = clamp(
      normalized.settings.rules.avgPeriodLength,
      CYCLE_RULES.MIN_PERIOD_LENGTH,
      CYCLE_RULES.MAX_PERIOD_LENGTH,
      CYCLE_RULES.DEFAULT_PERIOD_LENGTH
    );
    normalized.settings.rules.allowedCycleRange = [CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH];

    if (data.profile && typeof data.profile === 'object') {
      normalized.profile = { ...normalized.profile, ...data.profile };
    }
    normalized.profile.name = normalized.profile.name || '';
    normalized.profile.email = normalizeEmailValue(normalized.profile.email);
    normalized.profile.flowType = normalized.profile.flowType || '';
    normalized.profile.goal = normalized.profile.goal || '';
    normalized.profile.onboardingCompleted = Boolean(normalized.profile.onboardingCompleted);

    if (data.auth && typeof data.auth === 'object') {
      normalized.auth = { ...normalized.auth, ...data.auth };
    }
    normalized.auth.email = normalizeEmailValue(normalized.auth.email || normalized.profile.email);
    normalized.auth.password = normalized.auth.password || '';

    if (data.session && typeof data.session === 'object') {
      normalized.session = { ...normalized.session, ...data.session };
    }
    normalized.session.loggedIn = Boolean(normalized.session.loggedIn);
    normalized.session.authToken = typeof normalized.session.authToken === 'string' ? normalized.session.authToken : '';
    normalized.session.userId = typeof normalized.session.userId === 'string' ? normalized.session.userId : '';

    normalized.pushSubscription = data.pushSubscription || null;
    normalized.remindLaterUntil = data.remindLaterUntil || null;

    return normalized;
  }

  function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return normalizeStoredData(JSON.parse(stored));
      } catch (_) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    return createDataTemplate();
  }

  let remoteSyncTimer = null;
  let remoteSyncInFlight = false;

  function apiUrl(pathname) {
    return `${API_PREFIX}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }

  async function apiRequest(pathname, { method = 'GET', body = null, token = '' } = {}) {
    const headers = {};
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(apiUrl(pathname), {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined
    });
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : null;

    if (!isJson || !payload || payload.ok !== true || !res.ok) {
      const err = new Error(
        payload?.error
          || (!isJson ? 'Сервер вернул некорректный ответ. Проверьте, что API запущен.' : 'Ошибка сервера')
      );
      err.status = res.status;
      err.code = payload?.code || (!isJson ? 'INVALID_RESPONSE' : 'REQUEST_FAILED');
      throw err;
    }
    return payload;
  }

  function dataForRemoteSave() {
    const snapshot = normalizeStoredData(JSON.parse(JSON.stringify(state.data)));
    snapshot.session = { loggedIn: false, authToken: '', userId: '' };
    snapshot.auth = { email: normalizeEmailValue(snapshot.profile?.email), password: '' };
    return snapshot;
  }

  function shouldSyncRemote() {
    return Boolean(
      !state.partnerMode
      && state.data.session?.loggedIn
      && state.data.session?.authToken
      && normalizeEmailValue(state.data.profile?.email)
    );
  }

  async function syncRemoteData() {
    if (remoteSyncInFlight || !shouldSyncRemote()) return;
    remoteSyncInFlight = true;
    try {
      await apiRequest('/user/data', {
        method: 'PUT',
        token: state.data.session.authToken,
        body: { data: dataForRemoteSave() }
      });
    } catch (_) {
      // Keep local work even if server sync is temporarily unavailable.
    } finally {
      remoteSyncInFlight = false;
    }
  }

  function queueRemoteSync() {
    if (!shouldSyncRemote()) return;
    if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
    remoteSyncTimer = setTimeout(() => {
      remoteSyncTimer = null;
      syncRemoteData();
    }, 650);
  }

  function saveData() {
    if (state.partnerMode) return;
    state.selfData = state.data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    queueRemoteSync();
  }

  function setAppVisibility(show) {
    document.getElementById('appRoot').hidden = !show;
    document.getElementById('mainTabbar').hidden = !show;
  }

  function setAuthVisibility(show) {
    const gate = document.getElementById('authGate');
    if (gate) gate.hidden = !show;
  }

  function setOnboardingVisibility(show) {
    const onboarding = document.getElementById('onboarding');
    if (onboarding) onboarding.hidden = !show;
  }

  function setAuthStatus(text, isError = false) {
    const status = document.getElementById('authStatus');
    if (!status) return;
    status.textContent = text || '';
    status.style.color = isError ? '#fb7185' : '';
  }

  function applyTheme(isDark) {
    document.documentElement.classList.toggle('dark', isDark);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', isDark ? '#0d1a31' : '#f4f6fb');
    const label = isDark ? '☀️ Светлая тема' : '🌙 Тёмная тема';
    ['themeToggleSettings', 'themeToggleAuth'].forEach((id) => {
      const toggle = document.getElementById(id);
      if (!toggle) return;
      toggle.textContent = label;
      toggle.setAttribute('aria-pressed', String(isDark));
    });
    localStorage.setItem('cycleflow_theme', isDark ? 'dark' : 'light');
  }

  function initTheme() {
    const saved = localStorage.getItem('cycleflow_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : prefersDark);
  }

  function triggerOnboardingHeartPulse() {
    const heart = document.getElementById('headerHeart');
    if (!heart) return;
    heart.classList.add('pulse');
    setTimeout(() => heart.classList.remove('pulse'), 300);
  }

  let progressAnimationFrame = null;
  let progressCurrentValue = 0;
  let ringAnimationFrame = null;
  let ringProgressCurrentValue = 0;
  let ringNumberAnimationFrame = null;
  let ringNumberCurrentValue = 0;

  function animateRingNumber(targetValue) {
    const el = document.getElementById('ringMain');
    if (!el) return;
    const target = Math.max(0, Number(targetValue) || 0);
    if (ringNumberAnimationFrame) cancelAnimationFrame(ringNumberAnimationFrame);
    const from = ringNumberCurrentValue || Number(el.textContent) || target;
    const start = performance.now();
    const duration = 520;
    const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (target - from) * ease(t));
      el.textContent = String(next);
      if (t < 1) ringNumberAnimationFrame = requestAnimationFrame(tick);
      else {
        ringNumberCurrentValue = target;
        ringNumberAnimationFrame = null;
      }
    };

    ringNumberAnimationFrame = requestAnimationFrame(tick);
  }

  function animateRingProgress(targetPercent) {
    const ring = document.getElementById('cycleRing');
    if (!ring) return;
    const target = Math.max(0, Math.min(100, Number(targetPercent) || 0));
    if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame);
    const startValue = ringProgressCurrentValue;
    const start = performance.now();
    const duration = 640;

    const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const next = startValue + (target - startValue) * ease(t);
      ring.style.setProperty('--ring-progress', `${next.toFixed(2)}%`);
      if (t < 1) {
        ringAnimationFrame = requestAnimationFrame(tick);
      } else {
        ringProgressCurrentValue = target;
        ringAnimationFrame = null;
      }
    };

    ringAnimationFrame = requestAnimationFrame(tick);
  }


  function animateProgressNumber(target, element) {
    if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame);
    const start = progressCurrentValue;
    const duration = 520;
    const startedAt = performance.now();

    const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    const tick = (now) => {
      const p = Math.min((now - startedAt) / duration, 1);
      const value = Math.round(start + (target - start) * ease(p));
      element.textContent = `${value}%`;
      progressCurrentValue = value;
      if (p < 1) progressAnimationFrame = requestAnimationFrame(tick);
      else progressAnimationFrame = null;
    };

    progressAnimationFrame = requestAnimationFrame(tick);
  }

  function setOnboardingProgress() {
    const circle = document.getElementById('progressCircle');
    const percent = document.getElementById('progressPercent');
    const card = document.getElementById('card');
    if (!circle || !percent) return;

    const total = t.onboarding.questions.length;
    const progressStep = state.onboardingStep + 1;
    const ratio = (progressStep - 1) / (total - 1 || 1);
    const pct = Math.round(ratio * 100);
    const r = 44;
    const circumference = 2 * Math.PI * r;

    circle.style.strokeDasharray = circumference.toFixed(2);
    circle.style.strokeDashoffset = (circumference * (1 - ratio)).toFixed(2);
    animateProgressNumber(pct, percent);
    if (card) requestAnimationFrame(() => card.classList.add('show'));
  }

  function parseDate(v) {
    const parts = String(v || '').split('-').map((n) => Number(n));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return new Date(NaN);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }
  function dateKey(v) {
    const parts = String(v || '').split('-').map((n) => Number(n));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return Number.NaN;
    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY);
  }
  function formatDisplayDate(v) { return parseDate(v).toLocaleDateString('ru-RU'); }
  function formatInsightDate(v) {
    const d = parseDate(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace(/\./g, '').trim();
  }
  function shiftBy(v, days) {
    const key = dateKey(v);
    if (Number.isNaN(key)) return v;
    const shifted = new Date((key + days) * DAY);
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
  }
  function daysDiff(from, to) {
    const fromKey = dateKey(from);
    const toKey = dateKey(to);
    if (Number.isNaN(fromKey) || Number.isNaN(toKey)) return 0;
    return toKey - fromKey;
  }
  function normalizeEmail(value) {
    return normalizeEmailValue(value);
  }
  function toBase64Url(value) {
    return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function fromBase64Url(value) {
    const base = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base.length % 4;
    return pad ? `${base}${'='.repeat(4 - pad)}` : base;
  }
  function encodeSharePayload(payload) {
    try {
      return toBase64Url(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
    } catch (_) {
      return '';
    }
  }
  function normalizeSharePayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') return null;
    if (rawPayload.v === 2) {
      const compactCycles = Array.isArray(rawPayload.c) ? rawPayload.c : [];
      const cycles = compactCycles
        .map((row, idx) => {
          if (!Array.isArray(row) || !row[0]) return null;
          const startDate = row[0];
          const endDate = row[1] || startDate;
          const inferredLength = Math.max(1, daysDiff(startDate, endDate) + 1);
          return {
            id: `shared-${idx}-${startDate}`,
            startDate,
            endDate,
            length: clamp(
              Number.isFinite(Number(row[2])) ? Number(row[2]) : inferredLength,
              CYCLE_RULES.MIN_CYCLE_LENGTH,
              CYCLE_RULES.MAX_CYCLE_LENGTH,
              CYCLE_RULES.DEFAULT_CYCLE_LENGTH
            ),
            confirmed: true
          };
        })
        .filter(Boolean);

      const compactDays = rawPayload.d && typeof rawPayload.d === 'object' ? rawPayload.d : {};
      const days = {};
      Object.entries(compactDays).forEach(([dateStr, row]) => {
        if (!Array.isArray(row)) return;
        const rawIntensity = row[0];
        const intensity = rawIntensity === '' || rawIntensity === null || rawIntensity === undefined
          ? ''
          : clamp(rawIntensity, 0, 10, 0);
        days[dateStr] = {
          phase: 'follicular',
          intensity,
          mood: typeof row[1] === 'string' ? row[1] : '',
          symptoms: typeof row[2] === 'string'
            ? row[2].split('|').map((item) => item.trim()).filter(Boolean)
            : [],
          note: typeof row[3] === 'string' ? row[3] : '',
          intimacy: Boolean(row[4])
        };
      });

      return {
        version: 2,
        sharedAt: rawPayload.a || todayStr(),
        profile: { name: rawPayload.n || 'Партнёр' },
        settings: {
          delayThreshold: Number(rawPayload.t) || 3,
          rules: {
            avgCycleLength: clamp(
              Array.isArray(rawPayload.r) ? rawPayload.r[0] : undefined,
              CYCLE_RULES.MIN_CYCLE_LENGTH,
              CYCLE_RULES.MAX_CYCLE_LENGTH,
              CYCLE_RULES.DEFAULT_CYCLE_LENGTH
            ),
            avgPeriodLength: clamp(
              Array.isArray(rawPayload.r) ? rawPayload.r[1] : undefined,
              CYCLE_RULES.MIN_PERIOD_LENGTH,
              CYCLE_RULES.MAX_PERIOD_LENGTH,
              CYCLE_RULES.DEFAULT_PERIOD_LENGTH
            ),
            allowedCycleRange: [CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH]
          }
        },
        cycles,
        days
      };
    }

    if (rawPayload.version && rawPayload.settings && rawPayload.cycles && rawPayload.days) {
      return rawPayload;
    }
    return null;
  }
  function decodeSharePayload(token) {
    if (!token) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(fromBase64Url(token)))));
      const normalized = normalizeSharePayload(parsed);
      if (normalized) return normalized;
    } catch (_) { /* continue fallback */ }
    try {
      const parsedLegacy = JSON.parse(decodeURIComponent(escape(atob(token))));
      return normalizeSharePayload(parsedLegacy);
    } catch (_) { /* ignore */ }
    return null;
  }
  function extractPartnerToken(raw) {
    if (!raw) return '';
    const value = raw.trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const fromSearch = url.searchParams.get('p') || url.searchParams.get('partner');
        if (fromSearch) return fromSearch;
        const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('p')
          || new URLSearchParams(url.hash.replace(/^#/, '')).get('partner');
        return fromHash || '';
      } catch (_) {
        return '';
      }
    }
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }
  function formatPartnerLinkPreview(link) {
    try {
      const url = new URL(link);
      const token = url.searchParams.get('p') || url.searchParams.get('partner') || '';
      if (!token || token.length < 24) return link;
      return `${url.origin}${url.pathname}?p=${token.slice(0, 10)}...${token.slice(-8)}`;
    } catch (_) {
      return link;
    }
  }
  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // continue with fallback
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'true');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(area);
      return copied;
    } catch (_) {
      return false;
    }
  }

  function openAuthGate(statusText = '') {
    state.partnerMode = false;
    state.partnerOwnerName = '';
    state.data = state.selfData;
    state.tab = 'calendar';
    const loginPanel = document.getElementById('loginEntry');
    const loginEmailInput = document.getElementById('loginEmailInput');
    const loginPasswordInput = document.getElementById('loginPasswordInput');
    const partnerPanel = document.getElementById('partnerEntry');
    const partnerInput = document.getElementById('partnerLinkInput');
    if (loginPanel) loginPanel.hidden = true;
    if (loginEmailInput) loginEmailInput.value = '';
    if (loginPasswordInput) loginPasswordInput.value = '';
    if (partnerPanel) partnerPanel.hidden = true;
    if (partnerInput) partnerInput.value = '';
    setAppVisibility(false);
    setOnboardingVisibility(false);
    setAuthVisibility(true);
    setAuthStatus(statusText);
  }

  function enterMainApp() {
    setAuthVisibility(false);
    setOnboardingVisibility(false);
    setAppVisibility(true);
    renderTabs();
    renderMain();
  }

  function createPartnerLink() {
    if (!state.data.profile.onboardingCompleted) return null;
    const today = todayStr();
    const minDate = shiftBy(today, -120);
    const maxDate = shiftBy(today, 120);
    const sharedDays = {};
    Object.entries(state.data.days || {}).forEach(([dateStr, day]) => {
      if (dateStr < minDate || dateStr > maxDate) return;
      const symptoms = Array.isArray(day.symptoms) ? day.symptoms.map((item) => String(item).trim()).filter(Boolean) : [];
      const note = typeof day.note === 'string' ? day.note.trim() : '';
      const mood = day.mood || '';
      const intensity = day.intensity === '' || day.intensity === null || day.intensity === undefined
        ? ''
        : clamp(day.intensity, 0, 10, 0);
      const intimacy = Boolean(day.intimacy);
      const hasMeaningfulData = intimacy || intensity !== '' || mood || symptoms.length || note;
      if (!hasMeaningfulData) return;
      sharedDays[dateStr] = [intensity, mood, symptoms.join('|'), note, intimacy ? 1 : 0];
    });
    const rules = state.data.settings?.rules || {};
    const payload = {
      v: 2,
      a: today,
      n: state.data.profile.name || 'Партнёр',
      t: Number(state.data.settings?.delayThreshold) || 3,
      r: [
        clamp(rules.avgCycleLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH),
        clamp(rules.avgPeriodLength, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH)
      ],
      c: sortedCycles().slice(-12).map((cycle) => [
        cycle.startDate,
        cycle.endDate || cycle.startDate,
        clamp(cycle.length, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH)
      ]),
      d: sharedDays
    };
    const token = encodeSharePayload(payload);
    if (!token) return null;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('p', token);
    return url.toString();
  }

  function buildPartnerData(payload) {
    const rules = payload.settings?.rules || {};
    return {
      cycles: Array.isArray(payload.cycles) ? payload.cycles : [],
      days: payload.days && typeof payload.days === 'object' ? payload.days : {},
      settings: {
        theme: state.selfData.settings.theme,
        notifications: false,
        delayThreshold: Number(payload.settings?.delayThreshold) || 3,
        rules: {
          avgCycleLength: clamp(
            rules.avgCycleLength,
            CYCLE_RULES.MIN_CYCLE_LENGTH,
            CYCLE_RULES.MAX_CYCLE_LENGTH,
            CYCLE_RULES.DEFAULT_CYCLE_LENGTH
          ),
          avgPeriodLength: clamp(
            rules.avgPeriodLength,
            CYCLE_RULES.MIN_PERIOD_LENGTH,
            CYCLE_RULES.MAX_PERIOD_LENGTH,
            CYCLE_RULES.DEFAULT_PERIOD_LENGTH
          ),
          allowedCycleRange: [CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH]
        }
      },
      profile: {
        name: payload.profile?.name || 'Партнёр',
        email: '',
        flowType: '',
        goal: '',
        onboardingCompleted: true
      },
      session: { loggedIn: false, authToken: '', userId: '' },
      pushSubscription: null,
      remindLaterUntil: null
    };
  }

  function enterPartnerMode(payload, { fromUrl = false } = {}) {
    if (!payload || typeof payload !== 'object') return false;
    state.partnerMode = true;
    state.partnerOwnerName = payload.profile?.name || 'Партнёр';
    state.data = buildPartnerData(payload);
    state.selectedDate = todayStr();
    state.tab = 'calendar';
    if (fromUrl) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('p');
      cleanUrl.searchParams.delete('partner');
      if (cleanUrl.hash) {
        const hashParams = new URLSearchParams(cleanUrl.hash.replace(/^#/, ''));
        hashParams.delete('p');
        hashParams.delete('partner');
        cleanUrl.hash = hashParams.toString() ? `#${hashParams.toString()}` : '';
      }
      window.history.replaceState({}, '', cleanUrl.toString());
    }
    enterMainApp();
    return true;
  }
  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    return hash;
  }

  function stableIndexFromDate(dateStr, length) {
    if (!length) return 0;
    return hashString(dateStr) % length;
  }

  function cleanAiText(text) {
    if (!text) return null;
    return text.replace(/\s+/g, ' ').trim();
  }

  function parseSymptomsInput(raw) {
    return String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setSymptomsInput(values) {
    const input = document.getElementById('symptoms');
    if (!input) return;
    input.value = (values || []).join(', ');
  }

  function syncSymptomChipsFromInput() {
    const selected = new Set(parseSymptomsInput(document.getElementById('symptoms')?.value || ''));
    document.querySelectorAll('#symptomQuick .chip[data-symptom]').forEach((chip) => {
      const name = chip.dataset.symptom || '';
      chip.classList.toggle('active', selected.has(name));
      chip.setAttribute('aria-pressed', selected.has(name) ? 'true' : 'false');
    });
  }

  function toggleSymptomSelection(symptom) {
    if (!symptom) return;
    const values = parseSymptomsInput(document.getElementById('symptoms')?.value || '');
    const next = new Set(values);
    if (next.has(symptom)) next.delete(symptom);
    else next.add(symptom);
    setSymptomsInput([...next]);
    syncSymptomChipsFromInput();
  }

  function updateIntensityUi(value) {
    const output = document.getElementById('intensityValue');
    if (!output) return;
    const normalized = clamp(value, 0, 10, 0);
    output.textContent = String(normalized);
  }

  function dayHasJournalData(day) {
    if (!day || typeof day !== 'object') return false;
    const note = typeof day.note === 'string' ? day.note.trim() : '';
    const mood = typeof day.mood === 'string' ? day.mood.trim() : '';
    const symptoms = Array.isArray(day.symptoms)
      ? day.symptoms.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const hasIntensity = day.intensity !== '' && day.intensity !== null && day.intensity !== undefined;
    return Boolean(note || mood || symptoms.length || hasIntensity || day.intimacy);
  }

  function makeMetaChip(text, tone = '') {
    const chip = document.createElement('span');
    chip.className = `care-meta-chip${tone ? ` ${tone}` : ''}`;
    chip.textContent = text;
    return chip;
  }

  function removeCareEntry(dateStr) {
    if (state.partnerMode) return;
    const entry = state.data.days?.[dateStr];
    if (!entry) return;
    const confirmed = window.confirm(`Удалить запись за ${formatDisplayDate(dateStr)}?`);
    if (!confirmed) return;
    delete state.data.days[dateStr];
    saveData();
    renderMain();
  }

  function buildCareEntry(dateStr, day) {
    const item = document.createElement('article');
    item.className = 'care-entry';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.title = 'Открыть дату в календаре';

    const head = document.createElement('div');
    head.className = 'care-entry-head';
    const date = document.createElement('strong');
    date.textContent = formatDisplayDate(dateStr);

    const right = document.createElement('div');
    right.className = 'care-entry-right';

    const phaseBadge = document.createElement('span');
    phaseBadge.className = `care-phase phase-${day.phase || 'follicular'}`;
    phaseBadge.textContent = t.phases[day.phase]?.name || 'День цикла';
    right.appendChild(phaseBadge);

    if (!state.partnerMode) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'care-delete';
      removeBtn.setAttribute('aria-label', `Удалить запись за ${formatDisplayDate(dateStr)}`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeCareEntry(dateStr);
      });
      right.appendChild(removeBtn);
    }

    head.append(date, right);

    const meta = document.createElement('div');
    meta.className = 'care-meta';
    if (day.mood) meta.appendChild(makeMetaChip(`Настроение: ${day.mood}`));
    if (day.intensity !== '' && day.intensity !== null && day.intensity !== undefined) {
      meta.appendChild(makeMetaChip(`Интенсивность: ${clamp(day.intensity, 0, 10, 0)}/10`));
    }
    if (day.intimacy) meta.appendChild(makeMetaChip('День близости', 'love'));
    const symptoms = Array.isArray(day.symptoms)
      ? day.symptoms.map((item) => String(item).trim()).filter(Boolean)
      : [];
    symptoms.slice(0, 5).forEach((symptom) => meta.appendChild(makeMetaChip(symptom, 'symptom')));

    item.appendChild(head);
    if (meta.childNodes.length) item.appendChild(meta);
    if (typeof day.note === 'string' && day.note.trim()) {
      const note = document.createElement('p');
      note.className = 'care-note';
      note.textContent = day.note.trim();
      item.appendChild(note);
    }

    item.addEventListener('click', () => {
      state.selectedDate = dateStr;
      state.tab = 'calendar';
      renderTabs();
      renderMain();
    });
    item.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      state.selectedDate = dateStr;
      state.tab = 'calendar';
      renderTabs();
      renderMain();
    });

    return item;
  }

  function appendCareGroup(host, title, entries) {
    if (!entries.length) return;
    const section = document.createElement('section');
    section.className = 'care-group';

    const heading = document.createElement('h5');
    heading.className = 'care-group-title';
    heading.textContent = title;
    const count = document.createElement('small');
    count.className = 'care-group-count';
    count.textContent = `${entries.length}`;
    heading.appendChild(count);
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'care-group-list';
    const fragment = document.createDocumentFragment();
    entries.forEach(([dateStr, day]) => {
      fragment.appendChild(buildCareEntry(dateStr, day));
    });
    list.appendChild(fragment);
    section.appendChild(list);
    host.appendChild(section);
  }

  function renderCareEntries() {
    const host = document.getElementById('careEntries');
    if (!host) return;
    host.innerHTML = '';

    const entries = Object.entries(state.data.days || {})
      .filter(([, day]) => dayHasJournalData(day))
      .sort(([a], [b]) => dateKey(a) - dateKey(b));

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'care-empty';
      empty.textContent = state.partnerMode
        ? 'Пока нет переданных записей для чтения.'
        : 'Пока нет сохранённых записей. Заполните день, и он появится здесь.';
      host.appendChild(empty);
      return;
    }

    const today = todayStr();
    const actualAndFuture = [];
    const past = [];
    entries.forEach((entry) => {
      if (entry[0] >= today) actualAndFuture.push(entry);
      else past.push(entry);
    });

    actualAndFuture.sort(([a], [b]) => dateKey(a) - dateKey(b));
    past.sort(([a], [b]) => dateKey(b) - dateKey(a));

    const visibleActual = actualAndFuture.slice(0, 18);
    const visiblePast = past.slice(0, 30);

    appendCareGroup(host, 'Актуальные и будущие даты', visibleActual);
    appendCareGroup(host, 'Прошедшие даты', visiblePast);

    if (past.length > visiblePast.length) {
      const note = document.createElement('div');
      note.className = 'care-empty';
      note.textContent = `Показаны последние ${visiblePast.length} прошедших записей из ${past.length}.`;
      host.appendChild(note);
    }
  }

  function recommendationSignature(dateStr, day, prediction) {
    const cycleDay = prediction ? prediction.cycleDay : 'none';
    const fertile = isFertileDate(dateStr, prediction) ? 'fertile' : 'regular';
    const intensity = day.intensity === '' ? 'none' : String(day.intensity);
    const mood = day.mood || 'none';
    return `${dateStr}|${day.phase}|${cycleDay}|${fertile}|${intensity}|${mood}`;
  }

  function sortedCycles() {
    return (state.data.cycles || [])
      .filter((c) => c && c.startDate)
      .slice()
      .sort((a, b) => dateKey(a.startDate) - dateKey(b.startDate));
  }

  function getPeriodLength() {
    const cycles = sortedCycles();
    const observed = cycles
      .map((c) => {
        if (!c.startDate || !c.endDate) return null;
        return daysDiff(c.startDate, c.endDate) + 1;
      })
      .filter((len) => Number.isFinite(len) && len > 0)
      .map((len) => clamp(len, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH));
    if (observed.length) {
      const avgObserved = Math.round(observed.reduce((acc, n) => acc + n, 0) / observed.length);
      return clamp(avgObserved, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH);
    }
    const period = state.data.settings?.rules?.avgPeriodLength || state.onboardingAnswers.periodLength;
    return clamp(period, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH);
  }

  function getCycleLength() {
    const cycles = sortedCycles();
    if (!cycles.length) return CYCLE_RULES.DEFAULT_CYCLE_LENGTH;

    const recorded = cycles
      .map((c) => Number(c.length))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => clamp(n, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH));

    const inferred = [];
    for (let i = 1; i < cycles.length; i += 1) {
      const len = daysDiff(cycles[i - 1].startDate, cycles[i].startDate);
      if (!Number.isFinite(len) || len <= 0) continue;
      inferred.push(clamp(len, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH));
    }

    const source = recorded.length ? recorded : inferred;
    if (!source.length) return CYCLE_RULES.DEFAULT_CYCLE_LENGTH;
    const avg = Math.round(source.reduce((acc, n) => acc + n, 0) / source.length);
    return clamp(avg, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
  }

  function cycleStartForDate(dateStr, prediction) {
    const cycles = sortedCycles();
    const last = cycles[cycles.length - 1];
    if (!last || !prediction) return null;
    const daysFromBase = daysDiff(last.startDate, dateStr);
    const cycleOffset = Math.floor(daysFromBase / prediction.cycleLength);
    return shiftBy(last.startDate, cycleOffset * prediction.cycleLength);
  }

  function fertilityWindowForDate(dateStr, prediction) {
    const cycleStart = cycleStartForDate(dateStr, prediction);
    if (!cycleStart) return null;
    const ovulationDate = shiftBy(cycleStart, prediction.cycleLength - CYCLE_RULES.OVULATION_OFFSET);
    return {
      ovulationDate,
      ovulationStart: shiftBy(ovulationDate, -2),
      ovulationEnd: shiftBy(ovulationDate, 2)
    };
  }

  function getPrediction() {
    const cycles = sortedCycles();
    const last = cycles[cycles.length - 1];
    if (!last) return null;
    const cycleLength = getCycleLength();
    const basePrediction = { cycleLength };
    const cycleStart = cycleStartForDate(state.selectedDate, basePrediction) || last.startDate;
    const cycleDay = daysDiff(cycleStart, state.selectedDate) + 1;
    const window = fertilityWindowForDate(state.selectedDate, basePrediction);
    return {
      cycleLength,
      cycleDay,
      predictedNextPeriod: shiftBy(cycleStart, cycleLength),
      ovulationDate: window ? window.ovulationDate : shiftBy(cycleStart, cycleLength - CYCLE_RULES.OVULATION_OFFSET),
      ovulationStart: window ? window.ovulationStart : shiftBy(cycleStart, cycleLength - CYCLE_RULES.OVULATION_OFFSET - 2),
      ovulationEnd: window ? window.ovulationEnd : shiftBy(cycleStart, cycleLength - CYCLE_RULES.OVULATION_OFFSET + 2)
    };
  }

  function phaseForDate(dateStr) {
    const prediction = getPrediction();
    if (!prediction) return 'follicular';
    const cycles = sortedCycles();
    const base = cycles[cycles.length - 1].startDate;
    const daysFrom = daysDiff(base, dateStr);
    const cycleDay = ((daysFrom % prediction.cycleLength) + prediction.cycleLength) % prediction.cycleLength;
    if (cycleDay < getPeriodLength()) return 'menstrual';
    if (cycleDay < prediction.cycleLength - 16) return 'follicular';
    if (cycleDay <= prediction.cycleLength - 12) return 'ovulation';
    return 'luteal';
  }

  function ensureDay(dateStr) {
    const computedPhase = phaseForDate(dateStr);
    if (!state.data.days[dateStr]) {
      state.data.days[dateStr] = { phase: computedPhase, intensity: '', symptoms: [], mood: '', note: '', intimacy: false };
      return state.data.days[dateStr];
    }
    state.data.days[dateStr].phase = computedPhase;
    if (typeof state.data.days[dateStr].intimacy !== 'boolean') state.data.days[dateStr].intimacy = false;
    return state.data.days[dateStr];
  }

  function playLoveBurst(sourceEl) {
    if (!sourceEl) return;
    const rect = sourceEl.getBoundingClientRect();
    const burst = document.createElement('span');
    burst.className = 'love-burst';
    burst.style.left = `${rect.left + rect.width / 2}px`;
    burst.style.top = `${rect.top + rect.height / 2}px`;
    burst.innerHTML = '<i>❤️</i><i>❤️</i><i>❤️</i><i>❤️</i>';
    document.body.appendChild(burst);
    requestAnimationFrame(() => burst.classList.add('show'));
    setTimeout(() => burst.remove(), 760);
  }

  function toggleIntimacy(dateStr, sourceEl = null) {
    const day = ensureDay(dateStr);
    day.intimacy = !day.intimacy;
    if (sourceEl) {
      sourceEl.classList.remove('intimacy-pop');
      void sourceEl.offsetWidth;
      sourceEl.classList.add('intimacy-pop');
      playLoveBurst(sourceEl);
    }
    saveData();
    if (sourceEl) {
      setTimeout(() => renderMain(), 320);
      return;
    }
    renderMain();
  }

  function isFertileDate(dateStr, prediction) {
    const window = fertilityWindowForDate(dateStr, prediction);
    return Boolean(window && dateStr >= window.ovulationStart && dateStr <= window.ovulationEnd);
  }

  function fertilityProbability(phase, fertileToday) {
    if (fertileToday) return { label: 'Высокая', tone: 'high' };
    if (phase === 'follicular') return { label: 'Средняя', tone: 'medium' };
    return { label: 'Низкая', tone: 'low' };
  }

  function phaseCard(day, prediction) {
    const p = t.phases[day.phase];
    const fertileWindow = fertilityWindowForDate(state.selectedDate, prediction);
    const fertileToday = Boolean(
      fertileWindow
      && state.selectedDate >= fertileWindow.ovulationStart
      && state.selectedDate <= fertileWindow.ovulationEnd
    );
    const probability = prediction ? fertilityProbability(day.phase, fertileToday) : { label: '—', tone: 'low' };
    const signature = recommendationSignature(state.selectedDate, day, prediction);
    const partnerFertileFallback = 'Сегодня фертильное окно: поддержите спокойную атмосферу, без давления и спешки, и уделите время близости в комфортном ритме. Подойдут вода, лёгкий белковый ужин, овощи и тёплый напиток для мягкой поддержки самочувствия.';
    const partnerDefaultFallback = 'Будьте рядом мягко и уважительно: помогите снизить нагрузку, предложите отдых и тёплую заботу. Спокойный тон, внимание к её ощущениям и бытовая помощь сегодня особенно ценны.';
    const recommendation = day.aiRecommendation && day.aiRecommendationSignature === signature
      ? day.aiRecommendation
      : (state.partnerMode
        ? (fertileToday ? partnerFertileFallback : partnerDefaultFallback)
        : (reliefTipForDay(day, state.selectedDate) || t.labels.phaseTips[day.phase]));
    const recommendationTitle = state.partnerMode ? 'Рекомендация для партнёра' : 'Рекомендация';

    return `
      <article class="phase-panel phase-${day.phase}">
        <header class="phase-panel-top">
          <div class="phase-dot-wrap" aria-hidden="true"><span>${p.icon}</span></div>
          <div class="phase-meta">
            <h3>${p.name}</h3>
            <p>${p.state}</p>
          </div>
          <div class="phase-probability">
            <small>Вероятность</small>
            <span class="phase-badge phase-badge-${probability.tone}">${probability.label}</span>
          </div>
        </header>
        <div class="phase-panel-divider" aria-hidden="true"></div>

        ${fertileToday && fertileWindow ? `
          <div class="fertility-range">
            <div class="fertility-metric fertility-window">
              <small>Диапазон</small>
              <strong class="fertility-date">
                <span class="fertility-line">${formatDisplayDate(fertileWindow.ovulationStart)}</span>
                <span class="fertility-line">${formatDisplayDate(fertileWindow.ovulationEnd)}</span>
              </strong>
            </div>
            <div class="fertility-metric fertility-peak-wrap">
              <small>Пик</small>
              <strong class="fertility-peak-date">${formatDisplayDate(fertileWindow.ovulationDate)}</strong>
            </div>
            <span class="fertility-spark" aria-hidden="true">✦</span>
          </div>
        ` : ''}

        <section class="phase-recommendation ${fertileToday ? 'has-baby' : ''}">
          <div class="phase-recommendation-head">
            <span class="recommendation-icon" aria-hidden="true">💬</span>
            <h4>${recommendationTitle}</h4>
          </div>
          <p class="phase-recommendation-copy">
            ${fertileToday ? '<span class="phase-baby-float" aria-hidden="true">👶</span>' : ''}
            <span class="phase-recommendation-text">${recommendation}</span>
          </p>
        </section>

        <small class="phase-updated">Обновлено: ${formatDisplayDate(state.selectedDate)}</small>
      </article>
    `;
  }

  function companionText(day) {
    const hard = Number(day.intensity || 0) >= 7 || ['Тревожно', 'Раздражительно', 'Грустно'].includes(day.mood);
    return hard ? `${t.labels.hardDay} ${t.labels.phaseTips[day.phase]}` : t.labels.phaseTips[day.phase];
  }

  function reliefTipForDay(day, dateStr = state.selectedDate) {
    const tips = t.labels.reliefTips || [];
    if (!tips.length) return '';
    if (day.phase === 'menstrual') return tips[stableIndexFromDate(dateStr, tips.length)];
    return tips[0];
  }

  async function generateAiSuggestion(mode, context = {}) {
    const windowKey = typeof window.CYCLEFLOW_GROQ_KEY === 'string' ? window.CYCLEFLOW_GROQ_KEY.trim() : '';
    const key = windowKey || BUILTIN_GROQ_API_KEY;
    if (!key) return null;
    const dateStr = context.dateStr || state.selectedDate;
    const day = context.day || ensureDay(dateStr);
    const prediction = context.prediction || getPrediction();
    const phaseName = t.phases[day.phase]?.name || day.phase;
    const cycleDay = prediction ? prediction.cycleDay : 'не определён';
    const fertileToday = isFertileDate(dateStr, prediction);
    const fertile = fertileToday ? 'да' : 'нет';
    const intensity = day.intensity === '' ? 'не указана' : String(day.intensity);
    const mood = day.mood || 'не указано';
    const symptoms = day.symptoms && day.symptoms.length ? day.symptoms.join(', ') : 'не указаны';
    const note = day.note ? day.note.slice(0, 120) : 'нет';
    const dayContext = `Контекст: дата ${formatDisplayDate(dateStr)}; фаза ${phaseName}; день цикла ${cycleDay}; фертильное окно сегодня: ${fertile}; настроение: ${mood}; интенсивность: ${intensity}; симптомы: ${symptoms}; заметка: ${note}.`;
    let prompt = '';

    if (mode === 'comfort') {
      if (state.partnerMode && fertileToday) {
        prompt = 'Сегодня фертильный день. Дай мужчине 1-2 коротких предложения, как поддержать девушку перед зачатием: мягко, без давления, с уважением к её самочувствию.';
      } else if (state.partnerMode) {
        prompt = 'Дай мужчине 1-2 коротких предложения, как мягко эмоционально поддержать девушку сегодня.';
      } else {
        prompt = 'Дай нежную поддержку на сегодня в 1-2 коротких предложениях.';
      }
    } else if (mode === 'routine') {
      if (state.partnerMode && fertileToday) {
        prompt = 'Сегодня фертильный день. Предложи мужчине 1-2 коротких практичных действия для поддержки девушки и планирования близости в комфортном ритме.';
      } else if (state.partnerMode) {
        prompt = 'Предложи мужчине 1-2 коротких ритуала заботы, которые он может организовать для девушки сегодня.';
      } else {
        prompt = 'Предложи мягкий и полезный ритуал на сегодня в 1-2 коротких предложениях.';
      }
    } else {
      if (state.partnerMode) {
        if (fertileToday) {
          prompt = 'Сформулируй краткую рекомендацию мужчине-партнёру именно для фертильного дня. Дай бережные советы по поддержке девушки и мягкому планированию зачатия без давления; добавь 1-2 идеи, что купить из еды или напитков для её комфорта.';
        } else {
          prompt = 'Сформулируй краткую рекомендацию мужчине-партнёру для карточки приложения. Подскажи, как лучше поддержать девушку сегодня с учётом фазы и самочувствия, и добавь 1-2 идеи, что купить из еды или напитков для заботы.';
        }
      } else {
        const extra = day.phase === 'menstrual'
          ? 'Сделай акцент на полезном ритуале во время месячных: тепло, отдых, вода, мягкое дыхание или лёгкая прогулка.'
          : 'Дай практичную и бережную подсказку, что делать сегодня.';
        prompt = `Сформулируй краткую рекомендацию дня для карточки приложения. ${extra}`;
      }
    }

    const audienceRule = state.partnerMode
      ? 'Обращайся к мужчине-партнёру, говори уважительно и тепло, с фокусом на заботу о девушке.'
      : 'Обращайся к девушке мягко и бережно.';
    const medicalStyleRule = state.partnerMode && fertileToday
      ? 'Стиль: как у очень опытного врача по репродуктивному здоровью (30+ лет практики): спокойно, точно, бережно, без запугивания.'
      : '';
    const systemPrompt = `Ты русскоязычный помощник женского календаря. ${audienceRule} ${medicalStyleRule} Пиши строго грамотно: без орфографических, синтаксических и пунктуационных ошибок. Стиль как у преподавателя русского языка со стажем 30 лет: ясный, мягкий, заботливый. Не ставь диагнозы, не назначай лекарства и не пугай. Ответ: 1-2 коротких предложения, без списков, без канцеляризмов.`;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          temperature: 0.4,
          max_tokens: 140,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${dayContext} ${prompt}` }
          ]
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return cleanAiText(data?.choices?.[0]?.message?.content);
    } catch (_) {
      return null;
    }
  }

  async function requestPhaseRecommendation(day, prediction) {
    const dateStr = state.selectedDate;
    const signature = recommendationSignature(dateStr, day, prediction);
    if (day.aiRecommendation && day.aiRecommendationSignature === signature) return;
    const requestKey = `${dateStr}|${signature}`;
    if (pendingPhaseRecommendationRequests.has(requestKey)) return;
    pendingPhaseRecommendationRequests.add(requestKey);

    try {
      const aiText = await generateAiSuggestion('phaseRecommendation', { day, prediction, dateStr });
      if (!aiText) return;
      const targetDay = ensureDay(dateStr);
      targetDay.aiRecommendation = aiText;
      targetDay.aiRecommendationSignature = signature;
      if (state.selectedDate === dateStr) {
        const recommendationTextEl = document.querySelector('#phaseCard .phase-recommendation .phase-recommendation-text');
        if (recommendationTextEl) recommendationTextEl.textContent = aiText;
      }
      saveData();
    } finally {
      pendingPhaseRecommendationRequests.delete(requestKey);
    }
  }

  function renderHeader(prediction) {
    document.getElementById('appTitle').textContent = t.appTitle;
    document.getElementById('appSubtitle').textContent = state.partnerMode
      ? `Партнёрский просмотр: ${state.partnerOwnerName}`
      : `Привет, ${state.data.profile.name || 'девушка'} ✨`;
    document.getElementById('emailPreview').textContent = state.partnerMode
      ? 'Режим партнёра: доступ только для просмотра.'
      : (state.data.profile.email ? `Почта для уведомлений: ${state.data.profile.email}` : 'Почта ещё не указана');
    const profileModeHint = document.getElementById('profileModeHint');
    if (profileModeHint) {
      profileModeHint.textContent = state.partnerMode
        ? 'Редактирование данных недоступно в партнёрском режиме.'
        : 'Управляйте аккаунтом и делитесь данными с партнёром по ссылке.';
    }
    if (!prediction) {
      document.getElementById('prediction').textContent = 'Заполните анкету, чтобы получить точный прогноз';
      return;
    }
    document.getElementById('prediction').textContent = `Следующая менструация: ${formatDisplayDate(prediction.predictedNextPeriod)}`;
    animateRingNumber(prediction.cycleDay);
    document.getElementById('ringSub').textContent = 'день цикла';
    const ring = document.getElementById('cycleRing');
    const ringPercent = Math.round((prediction.cycleDay / prediction.cycleLength) * 100);
    ring.classList.remove('ring-pulse');
    void ring.offsetWidth;
    ring.classList.add('ring-pulse');
    setTimeout(() => ring.classList.remove('ring-pulse'), 520);
    animateRingProgress(ringPercent);
    const anchorDate = state.selectedDate || todayStr();
    document.getElementById('periodCountdown').textContent = `${daysDiff(anchorDate, prediction.predictedNextPeriod)} дн`;
    document.getElementById('ovulationCountdown').textContent = `${daysDiff(anchorDate, prediction.ovulationDate)} дн`;
    document.getElementById('selectedDateLabel').textContent = formatInsightDate(state.selectedDate);
  }

  function renderCalendar(prediction) {
    const month = state.currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    document.getElementById('monthLabel').textContent = month;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    const start = new Date(state.currentMonth);
    const firstDay = (start.getDay() + 6) % 7;
    start.setDate(1 - firstDay);

    for (let i = 0; i < 42; i += 1) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + i);
      const dateStr = formatDate(cur);
      const day = ensureDay(dateStr);
      const btn = document.createElement('button');
      btn.className = `day-cell phase-${day.phase}`;
      const dayNumber = document.createElement('span');
      dayNumber.className = 'day-number';
      dayNumber.textContent = String(cur.getDate());
      btn.appendChild(dayNumber);
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      if (dateStr === todayStr()) btn.classList.add('is-today');
      if (cur.getMonth() !== state.currentMonth.getMonth()) btn.classList.add('is-outside');
      if (day.phase === 'menstrual') btn.classList.add('period');
      if (isFertileDate(dateStr, prediction)) {
        btn.classList.add('ovulation', 'fertile-day');
        btn.title = 'День вероятного зачатия';
        const fertilityMark = document.createElement('span');
        fertilityMark.className = 'fertility-mark';
        fertilityMark.setAttribute('aria-hidden', 'true');
        fertilityMark.textContent = '👶';
        btn.appendChild(fertilityMark);
      }
      if (day.intimacy) {
        btn.classList.add('intimate-day');
        const loveMark = document.createElement('span');
        loveMark.className = 'love-mark';
        loveMark.setAttribute('aria-hidden', 'true');
        loveMark.textContent = '❤';
        btn.appendChild(loveMark);
        btn.title = btn.title ? `${btn.title}; отмечен день близости` : 'Отмечен день близости';
      }
      btn.addEventListener('click', () => {
        if (Date.now() < suppressClickUntil) return;
        state.selectedDate = dateStr;
        renderMain();
      });
      btn.addEventListener('dblclick', (e) => {
        if (state.partnerMode) return;
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntil = Date.now() + 380;
        if (tapSelectTimer) {
          clearTimeout(tapSelectTimer);
          tapSelectTimer = null;
        }
        lastTapDate = '';
        lastTapTs = 0;
        toggleIntimacy(dateStr, btn);
      });
      btn.addEventListener('touchend', (e) => {
        if (state.partnerMode) return;
        const now = Date.now();
        suppressClickUntil = now + 360;
        if (lastTapDate === dateStr && now - lastTapTs < 320) {
          e.preventDefault();
          e.stopPropagation();
          if (tapSelectTimer) {
            clearTimeout(tapSelectTimer);
            tapSelectTimer = null;
          }
          lastTapDate = '';
          lastTapTs = 0;
          toggleIntimacy(dateStr, btn);
          return;
        }
        lastTapDate = dateStr;
        lastTapTs = now;
        if (tapSelectTimer) clearTimeout(tapSelectTimer);
        tapSelectTimer = setTimeout(() => {
          tapSelectTimer = null;
          if (lastTapDate === dateStr) {
            state.selectedDate = dateStr;
            renderMain();
          }
        }, 260);
      }, { passive: false });
      grid.appendChild(btn);
    }
  }

  function renderMain() {
    const prediction = getPrediction();
    const day = ensureDay(state.selectedDate);
    renderHeader(prediction);
    renderCalendar(prediction);
    document.getElementById('phaseCard').innerHTML = phaseCard(day, prediction);
    requestPhaseRecommendation(day, prediction);
    document.getElementById('companionText').textContent = companionText(day);
    const aiStatus = document.getElementById('aiStatus');
    if (aiStatus) aiStatus.textContent = 'Поддержка дня обновляется автоматически.';

    const careHint = document.getElementById('careHint');
    if (careHint) {
      careHint.textContent = state.partnerMode
        ? 'В партнёрском режиме доступен только просмотр данных без редактирования.'
        : 'Выберите дату в календаре (включая будущие) и заполните состояние дня в 2–3 шага.';
    }
    const openSheetBtn = document.getElementById('openSheet');
    if (openSheetBtn && !state.partnerMode) {
      openSheetBtn.textContent = state.selectedDate === todayStr()
        ? 'Заполнить за сегодня'
        : `Заполнить: ${formatDisplayDate(state.selectedDate)}`;
    }
    renderCareEntries();

    const panel = document.getElementById('delayPanel');
    panel.hidden = true;
    if (prediction) {
      const delayedDays = daysDiff(prediction.predictedNextPeriod, todayStr());
      const remindLaterPassed = !state.data.remindLaterUntil || daysDiff(state.data.remindLaterUntil, todayStr()) > 0;
      const show = delayedDays > Number(state.data.settings.delayThreshold) && remindLaterPassed;
      panel.hidden = !show;
      panel.querySelector('h3').textContent = t.labels.delayDetected;
      panel.querySelector('.delay-text').textContent = t.labels.delayText;
      panel.querySelector('.delay-reasons').textContent = t.labels.possibleReasons;
    }

    applyAccessModeUi();
    document.body.dataset.phase = day.phase;
    saveData();
  }

  function renderTabs(previousTab = null) {
    const tabOrder = ['calendar', 'insights', 'care', 'settings'];
    const prevIndex = tabOrder.indexOf(previousTab || state.tab);
    const nextIndex = tabOrder.indexOf(state.tab);
    const enteringClass = nextIndex < prevIndex ? 'tab-animate-backward' : 'tab-animate-forward';

    document.querySelectorAll('.nav-item').forEach((btn) => {
      const isActive = btn.dataset.tab === state.tab;
      btn.classList.toggle('active', isActive);
      if (isActive) {
        btn.classList.remove('nav-pop');
        void btn.offsetWidth;
        btn.classList.add('nav-pop');
        setTimeout(() => btn.classList.remove('nav-pop'), 420);
      }
    });

    document.querySelectorAll('.tab-content').forEach((panel) => {
      const isActive = panel.id === `tab-${state.tab}`;
      panel.classList.remove('tab-animate-forward', 'tab-animate-backward');
      panel.classList.toggle('active', isActive);
      if (isActive) {
        panel.classList.add(enteringClass);
      }
    });
  }

  function applyAccessModeUi() {
    const readOnly = state.partnerMode;
    const openSheetBtn = document.getElementById('openSheet');
    const markStartBtn = document.getElementById('markStart');
    const remindLaterBtn = document.getElementById('remindLater');
    const exportBtn = document.getElementById('exportData');
    const deleteBtn = document.getElementById('deleteData');
    const createLinkBtn = document.getElementById('createPartnerLink');
    const logoutBtn = document.getElementById('logoutBtn');
    const exitPartnerBtn = document.getElementById('exitPartnerMode');
    const notificationsBtn = document.getElementById('enableNotifications');

    if (openSheetBtn) openSheetBtn.hidden = readOnly;
    if (markStartBtn) markStartBtn.hidden = readOnly;
    if (remindLaterBtn) remindLaterBtn.hidden = readOnly;
    if (exportBtn) exportBtn.hidden = readOnly;
    if (deleteBtn) deleteBtn.hidden = readOnly;
    if (notificationsBtn) notificationsBtn.hidden = readOnly;
    if (createLinkBtn) createLinkBtn.hidden = readOnly;
    if (logoutBtn) logoutBtn.hidden = readOnly;
    if (exitPartnerBtn) exitPartnerBtn.hidden = !readOnly;
  }

  function openSheet() {
    if (state.partnerMode) return;
    const day = ensureDay(state.selectedDate);
    document.getElementById('periodStart').value = '';
    document.getElementById('periodEnd').value = '';
    const normalizedIntensity = day.intensity === '' ? 0 : clamp(day.intensity, 0, 10, 0);
    document.getElementById('intensity').value = String(normalizedIntensity);
    updateIntensityUi(normalizedIntensity);
    document.getElementById('mood').innerHTML = `<option value="">Выберите</option>${t.labels.moods.map((m) => `<option value="${m}">${m}</option>`).join('')}`;
    document.getElementById('mood').value = day.mood;
    setSymptomsInput(day.symptoms);
    syncSymptomChipsFromInput();
    document.getElementById('note').value = day.note;
    document.getElementById('daySheet').hidden = false;
  }

  function saveDay(e) {
    e.preventDefault();
    if (state.partnerMode) return;
    const day = ensureDay(state.selectedDate);
    const pStart = document.getElementById('periodStart').value;
    const pEnd = document.getElementById('periodEnd').value;
    day.intensity = clamp(document.getElementById('intensity').value, 0, 10, 0);
    day.mood = document.getElementById('mood').value;
    day.symptoms = parseSymptomsInput(document.getElementById('symptoms').value);
    day.note = document.getElementById('note').value;
    day.phase = phaseForDate(state.selectedDate);

    if (pStart && pEnd) {
      const prev = state.data.cycles[state.data.cycles.length - 1];
      const fallbackCycle = state.data.settings.rules.avgCycleLength || CYCLE_RULES.DEFAULT_CYCLE_LENGTH;
      const rawLength = prev ? daysDiff(prev.startDate, pStart) : fallbackCycle;
      const length = clamp(rawLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
      state.data.cycles.push({ id: crypto.randomUUID(), startDate: pStart, endDate: pEnd, length, confirmed: true });
    }

    document.getElementById('daySheet').hidden = true;
    renderMain();
  }

  function markStart() {
    if (state.partnerMode) return;
    const start = todayStr();
    const end = shiftBy(start, getPeriodLength() - 1);
    const prev = state.data.cycles[state.data.cycles.length - 1];
    const rawLength = prev ? daysDiff(prev.startDate, start) : getCycleLength();
    const length = clamp(rawLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
    state.data.cycles.push({ id: crypto.randomUUID(), startDate: start, endDate: end, length, confirmed: true });
    state.data.remindLaterUntil = null;
    renderMain();
  }

  function exportJson() {
    if (state.partnerMode) return;
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cycleflow-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function enableNotifications() {
    if (state.partnerMode) return;
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const prediction = getPrediction();
    state.data.settings.notifications = true;
    if (prediction) {
      setTimeout(() => new Notification('CycleFlow', { body: `Менструация ожидается ${prediction.predictedNextPeriod}` }), 900);
      setTimeout(() => new Notification('CycleFlow', { body: `Окно овуляции ${prediction.ovulationStart}—${prediction.ovulationEnd}` }), 1400);
    }
    saveData();
  }

  function dateInputTemplate() {
    return `
      <div class="date-input-wrap">
        <label class="date-field">
          <input id="onboardingInput" type="date" class="pretty-date" />
          <button id="openDatePicker" type="button" class="date-picker-btn" aria-label="Открыть календарь">🗓️</button>
        </label>
        <small class="date-help">Формат: ДД.ММ.ГГГГ</small>
        <div id="glassDatePicker" class="glass-date-picker" hidden>
          <div class="gdp-head">
            <button type="button" id="gdpPrev" class="ghost">‹</button>
            <strong id="gdpLabel"></strong>
            <button type="button" id="gdpNext" class="ghost">›</button>
          </div>
          <div class="gdp-week"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
          <div id="gdpGrid" class="gdp-grid"></div>
        </div>
      </div>
    `;
  }

  function setupGlassDatePicker() {
    const input = document.getElementById('onboardingInput');
    const trigger = document.getElementById('openDatePicker');
    const picker = document.getElementById('glassDatePicker');
    const label = document.getElementById('gdpLabel');
    const grid = document.getElementById('gdpGrid');
    const prev = document.getElementById('gdpPrev');
    const next = document.getElementById('gdpNext');

    const selected = input.value ? parseDate(input.value) : new Date();
    let view = new Date(selected.getFullYear(), selected.getMonth(), 1);

    const draw = () => {
      label.textContent = view.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      grid.innerHTML = '';
      const start = new Date(view);
      const firstDay = (start.getDay() + 6) % 7;
      start.setDate(1 - firstDay);
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = formatDate(d);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gdp-day';
        b.textContent = String(d.getDate());
        if (d.getMonth() !== view.getMonth()) b.classList.add('outside');
        if (iso === input.value) b.classList.add('selected');
        if (iso === todayStr()) b.classList.add('today');
        b.addEventListener('click', () => {
          input.value = iso;
          picker.hidden = true;
        });
        grid.appendChild(b);
      }
    };

    trigger.addEventListener('click', () => {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) draw();
    });
    prev.addEventListener('click', () => { view.setMonth(view.getMonth() - 1); draw(); });
    next.addEventListener('click', () => { view.setMonth(view.getMonth() + 1); draw(); });
  }

  function renderQuestion() {
    const list = t.onboarding.questions;
    const q = list[state.onboardingStep];
    const body = document.getElementById('questionBody');
    document.getElementById('questionStep').textContent = `${state.onboardingStep + 1}/${list.length}.`;
    document.getElementById('questionTitle').textContent = q.title;
    setOnboardingProgress();

    if (q.type === 'select') {
      body.innerHTML = `<select id="onboardingInput">${q.options.map((x) => `<option value="${x}">${x}</option>`).join('')}</select>`;
    } else if (q.type === 'date') {
      body.innerHTML = dateInputTemplate();
    } else {
      body.innerHTML = `<input id="onboardingInput" type="${q.type}" placeholder="${q.placeholder || ''}" ${q.min ? `min="${q.min}"` : ''} ${q.max ? `max="${q.max}"` : ''} />`;
    }

    const onboardingInput = document.getElementById('onboardingInput');
    const current = state.onboardingAnswers[q.key];
    if (current) onboardingInput.value = current;
    onboardingInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      nextQuestion();
    });
    if (q.type === 'date') setupGlassDatePicker();
    document.getElementById('prevQuestion').style.visibility = state.onboardingStep === 0 ? 'hidden' : 'visible';
    document.getElementById('nextQuestion').textContent = state.onboardingStep === list.length - 1 ? 'Завершить' : 'Далее';
  }

  function normalizeAnswer(q, value) {
    if (q.key === 'cycleLength') {
      return String(clamp(value, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH));
    }
    if (q.key === 'periodLength') {
      return String(clamp(value, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH));
    }
    return value;
  }

  async function nextQuestion() {
    const q = t.onboarding.questions[state.onboardingStep];
    const raw = document.getElementById('onboardingInput').value.trim();
    if (!raw) return;
    const value = normalizeAnswer(q, raw);
    state.onboardingAnswers[q.key] = value;
    if (state.onboardingStep < t.onboarding.questions.length - 1) {
      state.onboardingStep += 1;
      renderQuestion();
      triggerOnboardingHeartPulse();
      return;
    }
    const nextBtn = document.getElementById('nextQuestion');
    const prevBtn = document.getElementById('prevQuestion');
    const initialLabel = nextBtn.textContent;
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.textContent = 'Сохраняем...';
    try {
      await completeOnboarding();
    } finally {
      nextBtn.disabled = false;
      prevBtn.disabled = false;
      nextBtn.textContent = initialLabel;
    }
  }

  function openLoginPanelWithEmail(email = '') {
    const loginPanel = document.getElementById('loginEntry');
    const partnerPanel = document.getElementById('partnerEntry');
    const loginEmailInput = document.getElementById('loginEmailInput');
    if (partnerPanel) partnerPanel.hidden = true;
    if (loginPanel) loginPanel.hidden = false;
    if (loginEmailInput && email) loginEmailInput.value = email;
    const passwordInput = document.getElementById('loginPasswordInput');
    if (passwordInput) passwordInput.focus();
  }

  async function completeOnboarding() {
    const a = state.onboardingAnswers;
    const cycleLength = clamp(a.cycleLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
    const periodLength = clamp(a.periodLength, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH);
    const startDate = a.lastStartDate || todayStr();
    const authEmail = normalizeEmail(a.email);
    const authPassword = (a.password || '').trim();
    if (authPassword.length < 4) {
      setAuthStatus('Пароль должен содержать минимум 4 символа.', true);
      return;
    }

    state.data.profile = {
      name: a.name,
      email: authEmail,
      flowType: a.flowType,
      goal: a.goal,
      onboardingCompleted: true
    };
    state.data.auth = {
      email: authEmail,
      password: authPassword
    };
    state.data.session = { loggedIn: false, authToken: '', userId: '' };

    state.data.settings.rules = {
      avgCycleLength: cycleLength,
      avgPeriodLength: periodLength,
      allowedCycleRange: [CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH]
    };

    state.data.cycles = [{
      id: crypto.randomUUID(),
      startDate,
      endDate: shiftBy(startDate, periodLength - 1),
      length: cycleLength,
      confirmed: true
    }];
    state.data = normalizeStoredData(state.data);

    try {
      const registerResult = await apiRequest('/auth/register', {
        method: 'POST',
        body: {
          email: authEmail,
          password: authPassword,
          name: a.name,
          data: dataForRemoteSave()
        }
      });

      const synced = normalizeStoredData(registerResult?.data || state.data);
      synced.profile.name = registerResult?.user?.name || a.name;
      synced.profile.email = authEmail;
      synced.profile.onboardingCompleted = true;
      synced.auth = { email: authEmail, password: authPassword };
      synced.session = {
        loggedIn: true,
        authToken: registerResult?.token || '',
        userId: registerResult?.user?.id || ''
      };
      state.data = synced;
      state.selfData = synced;
      state.selectedDate = todayStr();
      saveData();
      setAuthStatus('');
      enterMainApp();
    } catch (err) {
      setOnboardingVisibility(false);
      setAppVisibility(false);
      setAuthVisibility(true);
      if (err.code === 'EMAIL_EXISTS') {
        setAuthStatus('Этот аккаунт уже существует. Выполните вход.', true);
        openLoginPanelWithEmail(authEmail);
        return;
      }
      setAuthStatus(err.message || 'Не удалось завершить регистрацию. Проверьте соединение и попробуйте снова.', true);
    }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === state.tab) return;
        const prevTab = state.tab;
        state.tab = btn.dataset.tab;
        renderTabs(prevTab);
      });
    });

    document.getElementById('prevMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); renderMain(); });
    document.getElementById('nextMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); renderMain(); });
    document.getElementById('openSheet').addEventListener('click', openSheet);
    document.getElementById('closeSheet').addEventListener('click', () => { document.getElementById('daySheet').hidden = true; });
    document.getElementById('dayForm').addEventListener('submit', saveDay);
    document.getElementById('intensity').addEventListener('input', (e) => {
      updateIntensityUi(e.target.value);
    });
    document.getElementById('symptoms').addEventListener('input', syncSymptomChipsFromInput);
    document.querySelectorAll('#symptomQuick .chip[data-symptom]').forEach((chip) => {
      chip.addEventListener('click', () => {
        toggleSymptomSelection(chip.dataset.symptom || '');
      });
    });
    document.getElementById('markStart').addEventListener('click', markStart);
    document.getElementById('remindLater').addEventListener('click', () => { state.data.remindLaterUntil = shiftBy(todayStr(), 2); renderMain(); });
    document.getElementById('exportData').addEventListener('click', exportJson);
    document.getElementById('enableNotifications').addEventListener('click', enableNotifications);
    document.getElementById('deleteData').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    document.getElementById('authRegisterBtn').addEventListener('click', () => {
      const loginPanel = document.getElementById('loginEntry');
      const partnerPanel = document.getElementById('partnerEntry');
      if (loginPanel) loginPanel.hidden = true;
      if (partnerPanel) partnerPanel.hidden = true;
      setAuthVisibility(false);
      setOnboardingVisibility(true);
      setAppVisibility(false);
      setAuthStatus('');
      state.onboardingStep = 0;
      state.onboardingAnswers = {};
      renderQuestion();
    });

    document.getElementById('authLoginBtn').addEventListener('click', () => {
      const loginPanel = document.getElementById('loginEntry');
      const partnerPanel = document.getElementById('partnerEntry');
      if (!loginPanel) return;
      if (partnerPanel) partnerPanel.hidden = true;
      loginPanel.hidden = !loginPanel.hidden;
      if (!loginPanel.hidden) {
        const loginEmailInput = document.getElementById('loginEmailInput');
        const savedEmail = normalizeEmail(state.selfData.auth?.email || state.selfData.profile?.email || '');
        if (loginEmailInput && savedEmail) loginEmailInput.value = savedEmail;
        document.getElementById('loginPasswordInput').focus();
      }
      setAuthStatus('');
    });

    document.getElementById('loginEntry').addEventListener('submit', async (e) => {
      e.preventDefault();
      const loginEmail = normalizeEmail(document.getElementById('loginEmailInput').value);
      const loginPassword = document.getElementById('loginPasswordInput').value.trim();
      if (!loginEmail || !loginPassword) {
        setAuthStatus('Введите почту и пароль.', true);
        return;
      }
      const submitBtn = document.querySelector('#loginEntry button[type="submit"]');
      const initialLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Входим...';
      }
      try {
        const loginResult = await apiRequest('/auth/login', {
          method: 'POST',
          body: { email: loginEmail, password: loginPassword }
        });
        const merged = normalizeStoredData(loginResult?.data || createDataTemplate());
        merged.profile.name = loginResult?.user?.name || merged.profile.name || 'Пользователь';
        merged.profile.email = loginEmail;
        merged.profile.onboardingCompleted = true;
        merged.auth = { email: loginEmail, password: loginPassword };
        merged.session = {
          loggedIn: true,
          authToken: loginResult?.token || '',
          userId: loginResult?.user?.id || ''
        };

        state.partnerMode = false;
        state.partnerOwnerName = '';
        state.data = merged;
        state.selfData = merged;
        saveData();
        setAuthStatus('');
        enterMainApp();
      } catch (err) {
        setAuthStatus(err.message || 'Не удалось выполнить вход. Проверьте почту и пароль.', true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = initialLabel;
        }
      }
    });

    document.getElementById('authPartnerBtn').addEventListener('click', () => {
      const panel = document.getElementById('partnerEntry');
      const loginPanel = document.getElementById('loginEntry');
      if (loginPanel) loginPanel.hidden = true;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) document.getElementById('partnerLinkInput').focus();
    });

    document.getElementById('openPartnerLinkBtn').addEventListener('click', () => {
      const raw = document.getElementById('partnerLinkInput').value;
      const token = extractPartnerToken(raw);
      if (!token) {
        setAuthStatus('Вставьте корректную партнерскую ссылку.', true);
        return;
      }
      const payload = decodeSharePayload(token);
      if (!payload) {
        setAuthStatus('Ссылка повреждена или устарела.', true);
        return;
      }
      setAuthStatus('');
      enterPartnerMode(payload);
    });

    document.getElementById('createPartnerLink').addEventListener('click', async () => {
      if (state.partnerMode) return;
      const link = createPartnerLink();
      if (!link) return;
      const output = document.getElementById('partnerLinkOutput');
      const createLinkBtn = document.getElementById('createPartnerLink');
      output.hidden = false;
      output.dataset.fullLink = link;
      output.value = formatPartnerLinkPreview(link);
      output.title = 'Нажмите, чтобы скопировать ссылку.';
      const copied = await copyToClipboard(link);
      if (createLinkBtn) {
        const initialLabel = 'Создать партнёрскую ссылку';
        createLinkBtn.textContent = copied ? 'Ссылка скопирована' : 'Ссылка готова';
        setTimeout(() => { createLinkBtn.textContent = initialLabel; }, 1300);
      }
    });

    document.getElementById('partnerLinkOutput').addEventListener('click', async () => {
      const output = document.getElementById('partnerLinkOutput');
      const link = output.dataset.fullLink || output.value;
      if (!link) return;
      const copied = await copyToClipboard(link);
      if (copied) {
        output.focus();
        output.select();
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      state.data.session = { loggedIn: false, authToken: '', userId: '' };
      saveData();
      openAuthGate('Вы вышли из аккаунта.');
    });

    document.getElementById('exitPartnerMode').addEventListener('click', () => {
      openAuthGate('Режим партнёра завершён.');
    });

    document.getElementById('comfortBtn').addEventListener('click', async () => {
      const aiText = await generateAiSuggestion('comfort');
      if (aiText) {
        document.getElementById('companionText').textContent = aiText;
        return;
      }
      const day = ensureDay(state.selectedDate);
      const pool = t.labels.comfortIdeas || [t.labels.hardDay];
      const fallback = pool[Math.floor(Math.random() * pool.length)];
      if (!state.partnerMode) day.note = `${day.note ? `${day.note}\n` : ''}${fallback}`;
      document.getElementById('companionText').textContent = `${fallback} ${t.labels.phaseTips[day.phase]}`;
      if (!state.partnerMode) renderMain();
    });

    document.getElementById('routineBtn').addEventListener('click', async () => {
      const aiText = await generateAiSuggestion('routine');
      if (aiText) {
        document.getElementById('companionText').textContent = aiText;
        return;
      }
      const tips = t.labels.rituals || [];
      const relief = t.labels.reliefTips || [];
      const mixed = [...tips, ...relief];
      document.getElementById('companionText').textContent = mixed[Math.floor(Math.random() * mixed.length)];
    });

    let touchX = 0;
    document.getElementById('calendarGrid').addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].screenX; });
    document.getElementById('calendarGrid').addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].screenX - touchX;
      if (delta > 35) state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      if (delta < -35) state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      renderMain();
    });

    document.getElementById('prevQuestion').addEventListener('click', () => {
      if (state.onboardingStep > 0) state.onboardingStep -= 1;
      renderQuestion();
      triggerOnboardingHeartPulse();
    });

    document.getElementById('onboardingForm').addEventListener('submit', (e) => {
      e.preventDefault();
      nextQuestion();
    });

    document.getElementById('nextQuestion').addEventListener('click', nextQuestion);
    const themeToggle = document.getElementById('themeToggleSettings');
    if (themeToggle) themeToggle.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('dark')));
    const authThemeToggle = document.getElementById('themeToggleAuth');
    if (authThemeToggle) authThemeToggle.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('dark')));
  }

  async function restoreSessionFromServer() {
    const cached = normalizeStoredData(state.selfData);
    const token = cached.session?.authToken || '';
    if (!cached.session?.loggedIn || !token) return { ok: false, reason: 'MISSING_SESSION' };

    try {
      const payload = await apiRequest('/user/data', { token });
      const merged = normalizeStoredData(payload?.data || cached);
      merged.profile.name = merged.profile.name || cached.profile.name || 'Пользователь';
      merged.profile.email = normalizeEmailValue(
        merged.profile.email || cached.profile.email || cached.auth?.email
      );
      merged.profile.onboardingCompleted = true;
      merged.auth = {
        email: merged.profile.email,
        password: cached.auth?.password || ''
      };
      merged.session = {
        loggedIn: true,
        authToken: token,
        userId: merged.session?.userId || cached.session?.userId || ''
      };
      state.selfData = merged;
      state.data = merged;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return { ok: true, source: 'remote' };
    } catch (err) {
      const authError = err?.status === 401
        || err?.code === 'UNAUTHORIZED'
        || err?.code === 'INVALID_TOKEN'
        || err?.code === 'USER_NOT_FOUND';

      if (authError) {
        const cleared = normalizeStoredData(cached);
        cleared.session = { loggedIn: false, authToken: '', userId: '' };
        state.selfData = cleared;
        state.data = cleared;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleared));
        return { ok: false, reason: 'AUTH_INVALID' };
      }

      // Offline or temporary backend issue: keep last local snapshot.
      state.selfData = cached;
      state.data = cached;
      return { ok: true, source: 'cache' };
    }
  }

  async function bootstrapApp() {
    const startupUrl = new URL(window.location.href);
    const startupHashParams = new URLSearchParams(startupUrl.hash.replace(/^#/, ''));
    const partnerToken = startupUrl.searchParams.get('p')
      || startupUrl.searchParams.get('partner')
      || startupHashParams.get('p')
      || startupHashParams.get('partner');
    if (partnerToken) {
      const payload = decodeSharePayload(partnerToken);
      if (payload && enterPartnerMode(payload, { fromUrl: true })) {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
        return;
      }
    }

    if (!state.selfData.profile.onboardingCompleted) {
      openAuthGate('Нажмите «Регистрация», чтобы начать.');
    } else {
      const restored = await restoreSessionFromServer();
      if (restored.ok && state.selfData.session?.loggedIn && state.selfData.session?.authToken) {
        state.data = state.selfData;
        enterMainApp();
      } else {
        openAuthGate('Войдите в аккаунт или откройте партнерскую ссылку.');
      }
    }

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
  }

  initTheme();
  bindEvents();
  bootstrapApp().catch(() => {
    openAuthGate('Не удалось восстановить сессию. Войдите в аккаунт снова.');
  });
})();
