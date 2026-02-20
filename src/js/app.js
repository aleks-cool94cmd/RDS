/* global I18N_RU */
(() => {
  const STORAGE_KEY = 'cycle-tracker-v3';
  const DAY = 24 * 60 * 60 * 1000;
  const t = I18N_RU;
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const state = {
    selectedDate: todayStr(),
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    tab: 'calendar',
    onboardingStep: 0,
    onboardingAnswers: {},
    data: loadData()
  };

  function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
    return {
      cycles: [],
      days: {},
      settings: { theme: 'auto', notifications: false, delayThreshold: 3 },
      profile: { name: '', email: '', flowType: '', goal: '', onboardingCompleted: false },
      pushSubscription: null,
      remindLaterUntil: null
    };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function parseDate(v) { return new Date(`${v}T00:00:00`); }
  function formatDate(d) { return d.toISOString().slice(0, 10); }
  function shiftBy(v, days) { const d = parseDate(v); d.setDate(d.getDate() + days); return formatDate(d); }
  function daysDiff(from, to) { return Math.ceil((parseDate(to) - parseDate(from)) / DAY); }

  function getCycleLength() {
    const last = state.data.cycles.slice(-3);
    if (!last.length) return Number(state.onboardingAnswers.cycleLength || 28);
    return Math.round(last.reduce((acc, c) => acc + c.length, 0) / last.length);
  }

  function getPrediction() {
    const last = state.data.cycles[state.data.cycles.length - 1];
    if (!last) return null;
    const cycleLength = getCycleLength();
    const ovulationDay = cycleLength - 14;
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
    if (cycleDay < Number(state.onboardingAnswers.periodLength || 5)) return 'menstrual';
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
      btn.className = 'day-cell';
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
    day.intensity = document.getElementById('intensity').value;
    day.mood = document.getElementById('mood').value;
    day.symptoms = document.getElementById('symptoms').value.split(',').map((x) => x.trim()).filter(Boolean);
    day.note = document.getElementById('note').value;
    day.phase = phaseForDate(state.selectedDate);

    if (pStart && pEnd) {
      const prev = state.data.cycles[state.data.cycles.length - 1];
      const length = prev ? Math.max(20, Math.round((parseDate(pStart) - parseDate(prev.startDate)) / DAY)) : Number(state.onboardingAnswers.cycleLength || 28);
      state.data.cycles.push({ id: crypto.randomUUID(), startDate: pStart, endDate: pEnd, length, confirmed: true });
    }

    document.getElementById('daySheet').hidden = true;
    renderMain();
  }

  function markStart() {
    const start = todayStr();
    const end = shiftBy(start, Number(state.onboardingAnswers.periodLength || 4));
    const prev = state.data.cycles[state.data.cycles.length - 1];
    const length = prev ? Math.max(20, Math.round((parseDate(start) - parseDate(prev.startDate)) / DAY)) : Number(state.onboardingAnswers.cycleLength || 28);
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

  function importJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const parsed = JSON.parse(String(r.result));
      if (parsed.cycles && parsed.days && parsed.settings) {
        state.data = parsed;
        renderMain();
      }
    };
    r.readAsText(file);
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

  function renderQuestion() {
    const list = t.onboarding.questions;
    const q = list[state.onboardingStep];
    const body = document.getElementById('questionBody');
    document.getElementById('questionTitle').textContent = `${state.onboardingStep + 1}/${list.length}. ${q.title}`;
    let html = '';
    if (q.type === 'select') {
      html = `<select id="onboardingInput">${q.options.map((x) => `<option value="${x}">${x}</option>`).join('')}</select>`;
    } else {
      html = `<input id="onboardingInput" type="${q.type}" placeholder="${q.placeholder || ''}" ${q.min ? `min="${q.min}"` : ''} ${q.max ? `max="${q.max}"` : ''} />`;
    }
    body.innerHTML = html;
    const current = state.onboardingAnswers[q.key];
    if (current) document.getElementById('onboardingInput').value = current;
    document.getElementById('prevQuestion').style.visibility = state.onboardingStep === 0 ? 'hidden' : 'visible';
    document.getElementById('nextQuestion').textContent = state.onboardingStep === list.length - 1 ? 'Завершить' : 'Далее';
  }

  function nextQuestion() {
    const q = t.onboarding.questions[state.onboardingStep];
    const value = document.getElementById('onboardingInput').value.trim();
    if (!value) return;
    state.onboardingAnswers[q.key] = value;
    if (state.onboardingStep < t.onboarding.questions.length - 1) {
      state.onboardingStep += 1;
      renderQuestion();
      return;
    }
    completeOnboarding();
  }

  function completeOnboarding() {
    const a = state.onboardingAnswers;
    state.data.profile = {
      name: a.name,
      email: a.email,
      flowType: a.flowType,
      goal: a.goal,
      onboardingCompleted: true
    };
    const cycleLength = Number(a.cycleLength || 28);
    const startDate = a.lastStartDate || todayStr();
    const periodLength = Number(a.periodLength || 5);
    state.data.cycles = [{
      id: crypto.randomUUID(),
      startDate,
      endDate: shiftBy(startDate, periodLength - 1),
      length: cycleLength,
      confirmed: true
    }];
    document.getElementById('onboarding').hidden = true;
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
    document.getElementById('importFile').addEventListener('change', importJson);
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
    });
    document.getElementById('nextQuestion').addEventListener('click', nextQuestion);
  }

  bindEvents();
  renderTabs();
  if (!state.data.profile.onboardingCompleted) {
    document.getElementById('onboarding').hidden = false;
    renderQuestion();
  }
  renderMain();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
})();
