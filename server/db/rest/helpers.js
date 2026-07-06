export function single(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
