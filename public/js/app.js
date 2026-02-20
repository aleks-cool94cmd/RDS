/* global I18N_RU */
(() => {
  const STORAGE_KEY = 'cycle-tracker-v4';
  const DAY = 24 * 60 * 60 * 1000;
  const t = I18N_RU;
  const todayStr = () => new Date().toISOString().slice(0, 10);

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

  const state = {
    selectedDate: todayStr(),
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    tab: 'calendar',
    onboardingStep: 0,
    onboardingAnswers: {},
    data: loadData()
  };

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
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
      pushSubscription: null,
      remindLaterUntil: null
    };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function setAppVisibility(show) {
    document.getElementById('appRoot').hidden = !show;
    document.getElementById('mainTabbar').hidden = !show;
  }

  function applyTheme(isDark) {
    const toggle = document.getElementById('themeToggleSettings');
    document.documentElement.classList.toggle('dark', isDark);
    if (toggle) {
      toggle.textContent = isDark ? '☀️ Светлый режим' : '🌙 Тёмный режим';
      toggle.setAttribute('aria-pressed', String(isDark));
    }
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
    percent.textContent = `${pct}%`;
    if (card) requestAnimationFrame(() => card.classList.add('show'));
  }

  function parseDate(v) { return new Date(`${v}T00:00:00`); }
  function formatDate(d) { return d.toISOString().slice(0, 10); }
  function shiftBy(v, days) { const d = parseDate(v); d.setDate(d.getDate() + days); return formatDate(d); }
  function daysDiff(from, to) { return Math.ceil((parseDate(to) - parseDate(from)) / DAY); }

  function getPeriodLength() {
    const period = state.data.settings?.rules?.avgPeriodLength || state.onboardingAnswers.periodLength;
    return clamp(period, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH);
  }

  function getCycleLength() {
    const last = state.data.cycles.slice(-3);
    if (!last.length) return CYCLE_RULES.DEFAULT_CYCLE_LENGTH;
    const avg = Math.round(last.reduce((acc, c) => acc + clamp(c.length, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH), 0) / last.length);
    return clamp(avg, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
  }

  function getPrediction() {
    const last = state.data.cycles[state.data.cycles.length - 1];
    if (!last) return null;
    const cycleLength = getCycleLength();
    const ovulationDay = cycleLength - CYCLE_RULES.OVULATION_OFFSET;
    const predictedNextPeriod = shiftBy(last.startDate, cycleLength);
    const ovulationDate = shiftBy(last.startDate, ovulationDay);
    const cycleDayRaw = Math.floor((parseDate(state.selectedDate) - parseDate(last.startDate)) / DAY) + 1;
    return {
      cycleLength,
      cycleDay: ((cycleDayRaw - 1) % cycleLength + cycleLength) % cycleLength + 1,
      predictedNextPeriod,
      ovulationDate,
      ovulationStart: shiftBy(ovulationDate, -2),
      ovulationEnd: shiftBy(ovulationDate, 2)
    };
  }

  function phaseForDate(dateStr) {
    const prediction = getPrediction();
    if (!prediction) return 'follicular';
    const base = state.data.cycles[state.data.cycles.length - 1].startDate;
    const daysFrom = Math.floor((parseDate(dateStr) - parseDate(base)) / DAY);
    const cycleDay = ((daysFrom % prediction.cycleLength) + prediction.cycleLength) % prediction.cycleLength;
    if (cycleDay < getPeriodLength()) return 'menstrual';
    if (cycleDay < prediction.cycleLength - 16) return 'follicular';
    if (cycleDay <= prediction.cycleLength - 12) return 'ovulation';
    return 'luteal';
  }

  function ensureDay(dateStr) {
    if (!state.data.days[dateStr]) {
      state.data.days[dateStr] = { phase: phaseForDate(dateStr), intensity: '', symptoms: [], mood: '', note: '' };
    }
    return state.data.days[dateStr];
  }

  function phaseCard(day) {
    const p = t.phases[day.phase];
    return `<div><div>${p.icon}</div><h3>${p.name}</h3><p>${p.state}</p><small>${state.selectedDate}</small></div>`;
  }

  function companionText(day) {
    const hard = Number(day.intensity || 0) >= 7 || ['Тревожно', 'Раздражительно', 'Грустно'].includes(day.mood);
    return hard ? `${t.labels.hardDay} ${t.labels.phaseTips[day.phase]}` : t.labels.phaseTips[day.phase];
  }

  function renderHeader(prediction) {
    document.getElementById('appTitle').textContent = t.appTitle;
    document.getElementById('appSubtitle').textContent = `Привет, ${state.data.profile.name || 'девушка'} ✨`;
    document.getElementById('emailPreview').textContent = state.data.profile.email ? `Почта для уведомлений: ${state.data.profile.email}` : 'Почта ещё не указана';
    if (!prediction) {
      document.getElementById('prediction').textContent = 'Заполните анкету, чтобы получить точный прогноз';
      return;
    }
    document.getElementById('prediction').textContent = `Следующая менструация: ${prediction.predictedNextPeriod}`;
    document.getElementById('ringMain').textContent = prediction.cycleDay;
    document.getElementById('ringSub').textContent = `из ${prediction.cycleLength}`;
    document.getElementById('cycleRing').style.setProperty('--ring-progress', `${Math.round((prediction.cycleDay / prediction.cycleLength) * 100)}%`);
    document.getElementById('periodCountdown').textContent = `${daysDiff(todayStr(), prediction.predictedNextPeriod)} дн`;
    document.getElementById('ovulationCountdown').textContent = `${daysDiff(todayStr(), prediction.ovulationDate)} дн`;
    document.getElementById('selectedDateLabel').textContent = state.selectedDate;
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
      const cur = new Date(start.getTime() + i * DAY);
      const dateStr = formatDate(cur);
      const day = ensureDay(dateStr);
      const btn = document.createElement('button');
      btn.className = `day-cell phase-${day.phase}`;
      btn.textContent = String(cur.getDate());
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      if (dateStr === todayStr()) btn.classList.add('is-today');
      if (cur.getMonth() !== state.currentMonth.getMonth()) btn.classList.add('is-outside');
      if (day.phase === 'menstrual') btn.classList.add('period');
      if (prediction && dateStr >= prediction.ovulationStart && dateStr <= prediction.ovulationEnd) btn.classList.add('ovulation');
      btn.addEventListener('click', () => {
        state.selectedDate = dateStr;
        renderMain();
      });
      grid.appendChild(btn);
    }
  }

  function renderMain() {
    const prediction = getPrediction();
    const day = ensureDay(state.selectedDate);
    renderHeader(prediction);
    renderCalendar(prediction);
    document.getElementById('phaseCard').innerHTML = phaseCard(day);
    document.getElementById('companionText').textContent = companionText(day);

    const history = document.getElementById('cyclesHistory');
    history.innerHTML = '';
    state.data.cycles.slice().reverse().forEach((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.startDate} — ${c.endDate} • ${c.length} дн`;
      history.appendChild(li);
    });

    const panel = document.getElementById('delayPanel');
    panel.hidden = true;
    if (prediction) {
      const due = parseDate(prediction.predictedNextPeriod);
      const show = parseDate(todayStr()) > new Date(due.getTime() + Number(state.data.settings.delayThreshold) * DAY)
        && (!state.data.remindLaterUntil || parseDate(todayStr()) > parseDate(state.data.remindLaterUntil));
      panel.hidden = !show;
      panel.querySelector('h3').textContent = t.labels.delayDetected;
      panel.querySelector('.delay-text').textContent = t.labels.delayText;
      panel.querySelector('.delay-reasons').textContent = t.labels.possibleReasons;
    }

    document.body.dataset.phase = day.phase;
    saveData();
  }

  function renderTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
    document.querySelectorAll('.tab-content').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${state.tab}`);
    });
  }

  function openSheet() {
    const day = ensureDay(state.selectedDate);
    document.getElementById('periodStart').value = '';
    document.getElementById('periodEnd').value = '';
    document.getElementById('intensity').value = day.intensity;
    document.getElementById('mood').innerHTML = `<option value="">Выберите</option>${t.labels.moods.map((m) => `<option value="${m}">${m}</option>`).join('')}`;
    document.getElementById('mood').value = day.mood;
    document.getElementById('symptoms').value = day.symptoms.join(', ');
    document.getElementById('note').value = day.note;
    document.getElementById('daySheet').hidden = false;
  }

  function saveDay(e) {
    e.preventDefault();
    const day = ensureDay(state.selectedDate);
    const pStart = document.getElementById('periodStart').value;
    const pEnd = document.getElementById('periodEnd').value;
    day.intensity = clamp(document.getElementById('intensity').value, 0, 10, 0);
    day.mood = document.getElementById('mood').value;
    day.symptoms = document.getElementById('symptoms').value.split(',').map((x) => x.trim()).filter(Boolean);
    day.note = document.getElementById('note').value;
    day.phase = phaseForDate(state.selectedDate);

    if (pStart && pEnd) {
      const prev = state.data.cycles[state.data.cycles.length - 1];
      const fallbackCycle = state.data.settings.rules.avgCycleLength || CYCLE_RULES.DEFAULT_CYCLE_LENGTH;
      const rawLength = prev ? Math.round((parseDate(pStart) - parseDate(prev.startDate)) / DAY) : fallbackCycle;
      const length = clamp(rawLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
      state.data.cycles.push({ id: crypto.randomUUID(), startDate: pStart, endDate: pEnd, length, confirmed: true });
    }

    document.getElementById('daySheet').hidden = true;
    renderMain();
  }

  function markStart() {
    const start = todayStr();
    const end = shiftBy(start, getPeriodLength() - 1);
    const prev = state.data.cycles[state.data.cycles.length - 1];
    const rawLength = prev ? Math.round((parseDate(start) - parseDate(prev.startDate)) / DAY) : getCycleLength();
    const length = clamp(rawLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
    state.data.cycles.push({ id: crypto.randomUUID(), startDate: start, endDate: end, length, confirmed: true });
    state.data.remindLaterUntil = null;
    renderMain();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cycleflow-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function enableNotifications() {
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
        const d = new Date(start.getTime() + i * DAY);
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

    const current = state.onboardingAnswers[q.key];
    if (current) document.getElementById('onboardingInput').value = current;
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

  function nextQuestion() {
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
    completeOnboarding();
  }

  function completeOnboarding() {
    const a = state.onboardingAnswers;
    const cycleLength = clamp(a.cycleLength, CYCLE_RULES.MIN_CYCLE_LENGTH, CYCLE_RULES.MAX_CYCLE_LENGTH, CYCLE_RULES.DEFAULT_CYCLE_LENGTH);
    const periodLength = clamp(a.periodLength, CYCLE_RULES.MIN_PERIOD_LENGTH, CYCLE_RULES.MAX_PERIOD_LENGTH, CYCLE_RULES.DEFAULT_PERIOD_LENGTH);
    const startDate = a.lastStartDate || todayStr();

    state.data.profile = {
      name: a.name,
      email: a.email,
      flowType: a.flowType,
      goal: a.goal,
      onboardingCompleted: true
    };

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

    document.getElementById('onboarding').hidden = true;
    setAppVisibility(true);
    state.selectedDate = todayStr();
    renderMain();
  }

  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderTabs();
      });
    });

    document.getElementById('prevMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); renderMain(); });
    document.getElementById('nextMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); renderMain(); });
    document.getElementById('openSheet').addEventListener('click', openSheet);
    document.getElementById('closeSheet').addEventListener('click', () => { document.getElementById('daySheet').hidden = true; });
    document.getElementById('dayForm').addEventListener('submit', saveDay);
    document.getElementById('markStart').addEventListener('click', markStart);
    document.getElementById('remindLater').addEventListener('click', () => { state.data.remindLaterUntil = shiftBy(todayStr(), 2); renderMain(); });
    document.getElementById('exportData').addEventListener('click', exportJson);
    document.getElementById('enableNotifications').addEventListener('click', enableNotifications);
    document.getElementById('deleteData').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    document.getElementById('comfortBtn').addEventListener('click', () => {
      const day = ensureDay(state.selectedDate);
      day.note = `${day.note ? `${day.note}\n` : ''}${t.labels.hardDay}`;
      renderMain();
    });

    document.getElementById('routineBtn').addEventListener('click', () => {
      document.getElementById('companionText').textContent = t.labels.rituals[Math.floor(Math.random() * t.labels.rituals.length)];
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

    document.getElementById('nextQuestion').addEventListener('click', nextQuestion);
    const themeToggle = document.getElementById('themeToggleSettings');
    if (themeToggle) themeToggle.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('dark')));
  }

  initTheme();

  if (!state.data.profile.onboardingCompleted) {
    setAppVisibility(false);
    document.getElementById('onboarding').hidden = false;
  } else {
    setAppVisibility(true);
  }

  bindEvents();
  renderTabs();
  if (!state.data.profile.onboardingCompleted) renderQuestion();
  renderMain();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
})();
