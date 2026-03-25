function stableLabelString(labels = {}) {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

function metricKey(name, labels) {
  const serializedLabels = stableLabelString(labels);
  return serializedLabels ? `${name}|${serializedLabels}` : name;
}

const counters = new Map();
const timings = new Map();

function upsertCounter(name, labels = {}, delta = 1) {
  const key = metricKey(name, labels);
  const existing = counters.get(key);
  if (existing) {
    existing.value += delta;
    return existing;
  }

  const created = {
    name,
    labels: Object.fromEntries(
      Object.entries(labels).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
    value: delta
  };
  counters.set(key, created);
  return created;
}

function upsertTiming(name, labels = {}, valueMs) {
  const key = metricKey(name, labels);
  const existing = timings.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += valueMs;
    existing.maxMs = Math.max(existing.maxMs, valueMs);
    existing.minMs = Math.min(existing.minMs, valueMs);
    return existing;
  }

  const created = {
    name,
    labels: Object.fromEntries(
      Object.entries(labels).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
    count: 1,
    totalMs: valueMs,
    maxMs: valueMs,
    minMs: valueMs
  };
  timings.set(key, created);
  return created;
}

export function incrementMetric(name, labels = {}, delta = 1) {
  upsertCounter(name, labels, delta);
}

export function observeMetricDuration(name, valueMs, labels = {}) {
  if (!Number.isFinite(valueMs) || valueMs < 0) {
    return;
  }
  upsertTiming(name, labels, valueMs);
}

export function getMetricSnapshot() {
  const counterList = Array.from(counters.values())
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const timingList = Array.from(timings.values())
    .map((entry) => ({
      ...entry,
      avgMs: Number((entry.totalMs / Math.max(1, entry.count)).toFixed(2)),
      totalMs: Number(entry.totalMs.toFixed(2)),
      maxMs: Number(entry.maxMs.toFixed(2)),
      minMs: Number(entry.minMs.toFixed(2))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    counters: counterList,
    timings: timingList
  };
}

export function resetMetrics() {
  counters.clear();
  timings.clear();
}
