export function single(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * One value inside PostgREST's list and logic grammar (`in.(...)`, `or=(...)`). Commas,
 * parentheses, quotes and spaces are syntax there, so such a value is double-quoted and can
 * never add a list item or a filter branch; it is compared as plain text.
 */
export function pgValue(value) {
  const text = String(value);
  return /^[A-Za-z0-9_:.+-]+$/.test(text) ? text : `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

export function pgIn(values) {
  return `in.(${values.map(pgValue).join(",")})`;
}
