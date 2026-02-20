const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function parsePageQuery(query) {
  const page = parsePositiveInt(query.page, 1);
  const size = Math.min(parsePositiveInt(query.size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const skip = (page - 1) * size;

  return { page, size, skip, take: size };
}

export function createPageResult({ items, page, size, total }) {
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / size)) : undefined;
  return {
    items,
    page,
    size,
    total: total ?? undefined,
    totalPages
  };
}
