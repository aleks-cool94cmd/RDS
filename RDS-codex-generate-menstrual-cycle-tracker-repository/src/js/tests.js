function ovulationDay(cycleLength) {
  return cycleLength - 14;
}

function detectDelay(today, predictedNextPeriod, threshold = 3) {
  const day = 24 * 60 * 60 * 1000;
  const t = new Date(`${today}T00:00:00`).getTime();
  const p = new Date(`${predictedNextPeriod}T00:00:00`).getTime();
  return t > p + threshold * day;
}

function assert(name, condition) {
  if (!condition) {
    console.error(`✗ ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${name}`);
}

assert('Формула овуляции корректна', ovulationDay(28) === 14);
assert('Задержка не обнаружена до порога', detectDelay('2026-01-10', '2026-01-08', 3) === false);
assert('Задержка обнаруживается после порога', detectDelay('2026-01-12', '2026-01-08', 3) === true);
