/** className from base classes plus the ones whose condition holds. */
export function cx(base: string, conditional: Record<string, unknown> = {}) {
  const extra = Object.keys(conditional).filter((name) => conditional[name]);
  return extra.length ? `${base} ${extra.join(" ")}` : base;
}
