/* global I18N_RU */
(() => {
  const STORAGE_KEY = 'cycle-tracker-v2';
  const DAY = 24 * 60 * 60 * 1000;
  const t = I18N_RU;
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const state = {
    selectedDate: todayStr(),
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    data: loadData()
  };

  const phaseMeta = {
    menstrual: { className: 'phase-menstrual' },
    follicular: { className: 'phase-follicular' },
    ovulation: { className: 'phase-ovulation' },
    luteal: { className: 'phase-luteal' }
  };

  function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
    const demo = [
      { id: 'c1', startDate: shiftDate(-86), endDate: shiftDate(-81), length: 29, confirmed: true },
      { id: 'c2', startDate: shiftDate(-57), endDate: shiftDate(-52), length: 28, confirmed: true },
      { id: 'c3', startDate: shiftDate(-29), endDate: shiftDate(-24), length: 29, confirmed: true }
    ];
    return {
      cycles: demo,
      days: {},
      settings: { theme: 'auto', notifications: false, delayThreshold: 3 },
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
  function shiftDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return formatDate(d); }

  function calcCycleLength() {
    const cycles = state.data.cycles.slice(-3);
    if (!cycles.length) return 28;
    return Math.round(cycles.reduce((sum, c) => sum + (c.length || 28), 0) / cycles.length);
  }

  function getPrediction() {
    const last = state.data.cycles[state.data.cycles.length - 1];
    if (!last) return null;
    const cycleLength = calcCycleLength();
    const ovulationDay = cycleLength - 14;
    const predictedNextPeriod = shiftBy(last.startDate, cycleLength);
    const ovulationDate = shiftBy(last.startDate, ovulationDay);
    const cycleDay = Math.floor((parseDate(state.selectedDate) - parseDate(last.startDate)) / DAY) + 1;
    return {
      cycleLength,
      cycleDay: ((cycleDay - 1) % cycleLength + cycleLength) % cycleLength + 1,
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
    if (cycleDay < 5) return 'menstrual';
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

  function cycleProgress(prediction) {
    return Math.round((prediction.cycleDay / prediction.cycleLength) * 100);
  }

  function daysDiff(from, to) {
    return Math.ceil((parseDate(to) - parseDate(from)) / DAY);
  }

  function companionText(day) {
    const base = t.labels.phaseTips[day.phase];
    const hardMood = ['Тревожно', 'Раздражительно', 'Грустно'].includes(day.mood);
    const highIntensity = Number(day.intensity || 0) >= 7;
    if (hardMood || highIntensity) return `${t.labels.hardDay} ${base}`;
    return base;
  }

  function render() {
    const prediction = getPrediction();
    renderHeader(prediction);
    renderCalendar(prediction);
    renderPhaseCard();
    renderCompanion();
    renderDelay(prediction);
    renderHistory();
    saveData();
  }

  function renderHeader(prediction) {
    document.getElementById('appTitle').textContent = t.appTitle;
    document.getElementById('appSubtitle').textContent = t.subtitle;
    if (!prediction) return;
    document.getElementById('prediction').textContent = `Следующая менструация: ${prediction.predictedNextPeriod} • Овуляция: ${prediction.ovulationDate}`;
    document.getElementById('periodCountdown').textContent = `${daysDiff(todayStr(), prediction.predictedNextPeriod)} дн`;
    document.getElementById('ovulationCountdown').textContent = `${daysDiff(todayStr(), prediction.ovulationDate)} дн`;
    document.getElementById('ringMain').textContent = prediction.cycleDay;
    document.getElementById('ringSub').textContent = `из ${prediction.cycleLength}`;
    document.getElementById('cycleRing').style.setProperty('--ring-progress', `${cycleProgress(prediction)}%`);
  }

  function renderCalendar(prediction) {
    const month = state.currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    document.getElementById('monthLabel').textContent = month;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const start = new Date(state.currentMonth);
    const first = (start.getDay() + 6) % 7;
    start.setDate(1 - first);

    for (let i = 0; i < 42; i += 1) {
      const cur = new Date(start.getTime() + DAY * i);
      const dateStr = formatDate(cur);
      const day = ensureDay(dateStr);
      const btn = document.createElement('button');
      btn.className = `day-cell ${phaseMeta[day.phase].className}`;
      btn.textContent = String(cur.getDate());
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      if (dateStr === todayStr()) btn.classList.add('is-today');
      if (cur.getMonth() !== state.currentMonth.getMonth()) btn.classList.add('is-outside');
      if (day.note) btn.classList.add('has-note');
      if (day.phase === 'menstrual') btn.classList.add('period');
      if (prediction && dateStr >= prediction.ovulationStart && dateStr <= prediction.ovulationEnd) btn.classList.add('ovulation');
      btn.addEventListener('click', () => { state.selectedDate = dateStr; render(); });
      grid.appendChild(btn);
    }
  }

  function renderPhaseCard() {
    const day = ensureDay(state.selectedDate);
    const phase = t.phases[day.phase];
    const card = document.getElementById('phaseCard');
    card.className = `phase-card ${phaseMeta[day.phase].className}`;
    card.innerHTML = `<div class="phase-icon">${phase.icon}</div><div><h2>${phase.name}</h2><p>${phase.state}</p><small>${state.selectedDate}</small></div>`;
    document.body.dataset.phase = day.phase;
  }

  function renderCompanion() {
    const day = ensureDay(state.selectedDate);
    document.getElementById('companionText').textContent = companionText(day);
  }

  function renderDelay(prediction) {
    const panel = document.getElementById('delayPanel');
    if (!prediction) return;
    const today = parseDate(todayStr());
    const due = parseDate(prediction.predictedNextPeriod);
    const threshold = Number(state.data.settings.delayThreshold || 3);
    const show = today > new Date(due.getTime() + threshold * DAY) && (!state.data.remindLaterUntil || today > parseDate(state.data.remindLaterUntil));
    panel.hidden = !show;
    if (!show) return;
    panel.querySelector('h3').textContent = t.labels.delayDetected;
    panel.querySelector('.delay-text').textContent = t.labels.delayText;
    panel.querySelector('.delay-reasons').textContent = t.labels.possibleReasons;
  }

  function renderHistory() {
    const root = document.getElementById('cyclesHistory');
    root.innerHTML = '';
    state.data.cycles.slice().reverse().forEach((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.startDate} — ${c.endDate} • ${c.length} дней`;
      root.appendChild(li);
    });
  }

  function fillSheet() {
    const day = ensureDay(state.selectedDate);
    document.getElementById('selectedDateLabel').textContent = state.selectedDate;
    document.getElementById('periodStart').value = '';
    document.getElementById('periodEnd').value = '';
    document.getElementById('intensity').value = day.intensity;
    document.getElementById('mood').innerHTML = `<option value="">Выберите</option>${t.labels.moods.map((m) => `<option value="${m}">${m}</option>`).join('')}`;
    document.getElementById('mood').value = day.mood;
    document.getElementById('symptoms').value = day.symptoms.join(', ');
    document.getElementById('note').value = day.note;
  }

  function openSheet() {
    fillSheet();
    document.getElementById('daySheet').hidden = false;
  }

  function closeSheet() {
    document.getElementById('daySheet').hidden = true;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cycle-data-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const parsed = JSON.parse(String(fr.result));
      if (parsed.cycles && parsed.days && parsed.settings) {
        state.data = parsed;
        render();
      }
    };
    fr.readAsText(file);
  }

  function markPeriodStart() {
    const startDate = todayStr();
    const last = state.data.cycles[state.data.cycles.length - 1];
    const length = last ? Math.max(20, Math.round((parseDate(startDate) - parseDate(last.startDate)) / DAY)) : 28;
    state.data.cycles.push({ id: crypto.randomUUID(), startDate, endDate: shiftBy(startDate, 4), length, confirmed: true });
    state.data.remindLaterUntil = null;
    render();
  }

  function saveDayForm(e) {
    e.preventDefault();
    const day = ensureDay(state.selectedDate);
    const pStart = document.getElementById('periodStart').value;
    const pEnd = document.getElementById('periodEnd').value;
    day.intensity = document.getElementById('intensity').value;
    day.mood = document.getElementById('mood').value;
    day.symptoms = document.getElementById('symptoms').value.split(',').map((x) => x.trim()).filter(Boolean);
    day.note = document.getElementById('note').value.trim();
    day.phase = phaseForDate(state.selectedDate);

    if (pStart && pEnd) {
      const prev = state.data.cycles[state.data.cycles.length - 1];
      const length = prev ? Math.max(20, Math.round((parseDate(pStart) - parseDate(prev.startDate)) / DAY)) : 28;
      state.data.cycles.push({ id: crypto.randomUUID(), startDate: pStart, endDate: pEnd, length, confirmed: true });
    }
    closeSheet();
    render();
  }

  async function initNotifications() {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    state.data.settings.notifications = true;
    const prediction = getPrediction();
    if (!prediction) return;
    setTimeout(() => new Notification('CycleFlow', { body: `Менструация ожидается ${prediction.predictedNextPeriod}` }), 900);
    setTimeout(() => new Notification('CycleFlow', { body: `Овуляция: ${prediction.ovulationStart}—${prediction.ovulationEnd}` }), 1300);
    saveData();
  }

  function bindEvents() {
    document.getElementById('prevMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); render(); });
    document.getElementById('nextMonth').addEventListener('click', () => { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); render(); });
    document.getElementById('todayBtn').addEventListener('click', () => { state.selectedDate = todayStr(); state.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); });

    document.getElementById('openSheet').addEventListener('click', openSheet);
    document.getElementById('closeSheet').addEventListener('click', closeSheet);
    document.getElementById('dayForm').addEventListener('submit', saveDayForm);

    document.getElementById('markStart').addEventListener('click', markPeriodStart);
    document.getElementById('remindLater').addEventListener('click', () => { state.data.remindLaterUntil = shiftDate(2); render(); });
    document.getElementById('exportData').addEventListener('click', exportJson);
    document.getElementById('importFile').addEventListener('change', importJson);
    document.getElementById('enableNotifications').addEventListener('click', initNotifications);
    document.getElementById('deleteData').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      state.data = loadData();
      closeSheet();
      render();
    });

    document.getElementById('comfortBtn').addEventListener('click', () => {
      const day = ensureDay(state.selectedDate);
      day.note = `${day.note ? `${day.note}\n` : ''}${t.labels.hardDay}`;
      renderCompanion();
      saveData();
    });

    document.getElementById('routineBtn').addEventListener('click', () => {
      const ritual = t.labels.rituals[Math.floor(Math.random() * t.labels.rituals.length)];
      document.getElementById('companionText').textContent = ritual;
    });

    let startX = 0;
    const wrap = document.getElementById('calendarWrap');
    wrap.addEventListener('touchstart', (e) => { startX = e.changedTouches[0].screenX; });
    wrap.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].screenX - startX;
      if (dx > 50) state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      if (dx < -50) state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      render();
    });

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
  }

  bindEvents();
  render();
})();
