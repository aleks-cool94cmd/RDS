/* global I18N_RU */
(() => {
  const STORAGE_KEY = 'cycle-tracker-v1';
  const DAY = 24 * 60 * 60 * 1000;
  const t = I18N_RU;

  const state = {
    selectedDate: formatDate(new Date()),
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    data: loadData()
  };

  const phaseMeta = {
    menstrual: { color: '#9f2f5e', className: 'phase-menstrual' },
    follicular: { color: '#4da2ff', className: 'phase-follicular' },
    ovulation: { color: '#efc443', className: 'phase-ovulation' },
    luteal: { color: '#ffad7a', className: 'phase-luteal' }
  };

  function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);

    const demoCycles = [
      { id: 'c1', startDate: shiftDate(-84), endDate: shiftDate(-79), length: 28, confirmed: true },
      { id: 'c2', startDate: shiftDate(-56), endDate: shiftDate(-51), length: 29, confirmed: true },
      { id: 'c3', startDate: shiftDate(-27), endDate: shiftDate(-22), length: 28, confirmed: true }
    ];

    return {
      cycles: demoCycles,
      days: {},
      settings: { theme: 'auto', notifications: false, delayThreshold: 3 },
      pushSubscription: null,
      remindLaterUntil: null
    };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function shiftDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return formatDate(d);
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function parseDate(value) {
    return new Date(`${value}T00:00:00`);
  }

  function calcCycleLength() {
    const cycles = state.data.cycles.slice(-3);
    if (cycles.length === 0) return 28;
    const avg = cycles.reduce((acc, c) => acc + (c.length || 28), 0) / cycles.length;
    return Math.round(avg);
  }

  function getPrediction() {
    const last = state.data.cycles[state.data.cycles.length - 1];
    if (!last) return null;
    const cycleLength = calcCycleLength();
    const predictedNextPeriod = formatDate(new Date(parseDate(last.startDate).getTime() + cycleLength * DAY));
    const ovulationDay = cycleLength - 14;
    const ovulationDate = formatDate(new Date(parseDate(last.startDate).getTime() + ovulationDay * DAY));
    return { cycleLength, predictedNextPeriod, ovulationDate, ovulationStart: shiftBy(ovulationDate, -2), ovulationEnd: shiftBy(ovulationDate, 2) };
  }

  function shiftBy(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }

  function phaseForDate(dateStr) {
    const prediction = getPrediction();
    if (!prediction) return 'follicular';
    const base = state.data.cycles[state.data.cycles.length - 1]?.startDate;
    const daysFrom = Math.floor((parseDate(dateStr) - parseDate(base)) / DAY);
    const cycleDay = ((daysFrom % prediction.cycleLength) + prediction.cycleLength) % prediction.cycleLength;

    if (cycleDay < 5) return 'menstrual';
    if (cycleDay < prediction.cycleLength - 16) return 'follicular';
    if (cycleDay <= prediction.cycleLength - 12) return 'ovulation';
    return 'luteal';
  }

  function ensureDay(dateStr) {
    if (!state.data.days[dateStr]) {
      state.data.days[dateStr] = {
        phase: phaseForDate(dateStr),
        intensity: '',
        symptoms: [],
        mood: '',
        note: ''
      };
    }
    return state.data.days[dateStr];
  }

  function render() {
    const prediction = getPrediction();
    renderHeader(prediction);
    renderCalendar();
    renderDayCard();
    renderDelayScreen(prediction);
    saveData();
  }

  function renderHeader(prediction) {
    document.getElementById('appTitle').textContent = t.appTitle;
    document.getElementById('appSubtitle').textContent = t.subtitle;
    document.getElementById('prediction').textContent = prediction
      ? `Следующая менструация: ${prediction.predictedNextPeriod} • Овуляция: ${prediction.ovulationDate}`
      : 'Добавьте данные цикла';
  }

  function renderCalendar() {
    const monthLabel = state.currentMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    document.getElementById('monthLabel').textContent = monthLabel;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const start = new Date(state.currentMonth);
    const firstDay = (start.getDay() + 6) % 7;
    start.setDate(1 - firstDay);

    for (let i = 0; i < 42; i += 1) {
      const current = new Date(start.getTime() + i * DAY);
      const dateStr = formatDate(current);
      const day = ensureDay(dateStr);
      const btn = document.createElement('button');
      btn.className = `day-cell ${phaseMeta[day.phase].className}`;
      btn.textContent = current.getDate();
      btn.setAttribute('aria-label', dateStr);
      if (dateStr === formatDate(new Date())) btn.classList.add('is-today');
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      if (current.getMonth() !== state.currentMonth.getMonth()) btn.classList.add('is-outside');
      if (day.note) btn.classList.add('has-note');
      btn.addEventListener('click', () => {
        state.selectedDate = dateStr;
        render();
      });
      grid.appendChild(btn);
    }
  }

  function renderDayCard() {
    const day = ensureDay(state.selectedDate);
    const phase = t.phases[day.phase];
    const card = document.getElementById('phaseCard');
    card.className = `phase-card ${phaseMeta[day.phase].className}`;
    card.innerHTML = `
      <div class="phase-icon">${phase.icon}</div>
      <div>
        <h2>${phase.name}</h2>
        <p>${phase.state}</p>
        <small>${state.selectedDate}</small>
      </div>
    `;
    document.body.dataset.phase = day.phase;

    document.getElementById('selectedDateLabel').textContent = state.selectedDate;
    document.getElementById('intensity').value = day.intensity;
    document.getElementById('mood').innerHTML = `<option value="">Настроение</option>${t.moods.map((m) => `<option value="${m}">${m}</option>`).join('')}`;
    document.getElementById('mood').value = day.mood;
    document.getElementById('symptoms').value = day.symptoms.join(', ');
    document.getElementById('note').value = day.note;
  }

  function renderDelayScreen(prediction) {
    const panel = document.getElementById('delayPanel');
    if (!prediction) return;
    const today = parseDate(formatDate(new Date()));
    const due = parseDate(prediction.predictedNextPeriod);
    const threshold = Number(state.data.settings.delayThreshold || 3);
    const show = today > new Date(due.getTime() + threshold * DAY)
      && (!state.data.remindLaterUntil || today > parseDate(state.data.remindLaterUntil));

    panel.hidden = !show;
    if (show) {
      panel.querySelector('h3').textContent = t.labels.delayDetected;
      panel.querySelector('.delay-text').textContent = t.labels.delayText;
      panel.querySelector('.delay-reasons').textContent = t.labels.possibleReasons;
    }
  }

  function attachEvents() {
    document.getElementById('prevMonth').addEventListener('click', () => {
      state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      render();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
      state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      render();
    });

    let touchStartX = 0;
    const calendar = document.getElementById('calendarWrap');
    calendar.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; });
    calendar.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].screenX - touchStartX;
      if (delta > 40) state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      if (delta < -40) state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      render();
    });

    document.getElementById('dayForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const day = ensureDay(state.selectedDate);
      day.intensity = document.getElementById('intensity').value;
      day.mood = document.getElementById('mood').value;
      day.symptoms = document.getElementById('symptoms').value.split(',').map((x) => x.trim()).filter(Boolean);
      day.note = document.getElementById('note').value.trim();
      day.phase = phaseForDate(state.selectedDate);
      render();
    });

    document.getElementById('markStart').addEventListener('click', () => {
      const startDate = formatDate(new Date());
      const last = state.data.cycles[state.data.cycles.length - 1];
      const length = last ? Math.max(20, Math.floor((parseDate(startDate) - parseDate(last.startDate)) / DAY)) : 28;
      state.data.cycles.push({
        id: crypto.randomUUID(),
        startDate,
        endDate: shiftBy(startDate, 4),
        length,
        confirmed: true
      });
      state.data.remindLaterUntil = null;
      render();
    });

    document.getElementById('remindLater').addEventListener('click', () => {
      state.data.remindLaterUntil = shiftDate(2);
      render();
    });

    document.getElementById('exportData').addEventListener('click', exportJson);
    document.getElementById('importFile').addEventListener('change', importJson);
    document.getElementById('enableNotifications').addEventListener('click', initNotifications);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js');
    }
  }

  async function initNotifications() {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    state.data.settings.notifications = true;

    const prediction = getPrediction();
    if (!prediction) return;
    scheduleLocalNotification('Скоро менструация', `Ожидается ${prediction.predictedNextPeriod}`);
    scheduleLocalNotification('Окно овуляции', `${prediction.ovulationStart} — ${prediction.ovulationEnd}`);
    saveData();

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array('BElQXcQwDemoPublicKeyReplaceIt1234567890')
      });
      state.data.pushSubscription = sub.toJSON();
      saveData();
    }
  }

  function scheduleLocalNotification(title, body) {
    setTimeout(() => {
      new Notification(title, { body });
    }, 1200);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cycle-data-${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = JSON.parse(String(reader.result));
      if (parsed.cycles && parsed.days && parsed.settings) {
        state.data = parsed;
        render();
      }
    };
    reader.readAsText(file);
  }

  function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  attachEvents();
  render();
})();
