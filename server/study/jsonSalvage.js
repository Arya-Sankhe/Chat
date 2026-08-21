/**
 * Brace/string-aware salvage of complete JSON objects from truncated model output.
 * No regex — walks characters so strings with braces stay intact.
 */
export function salvageJsonObjects(text) {
  const raw = String(text || "");
  const objects = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && raw[i] !== "{") i += 1;
    if (i >= raw.length) break;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          i += 1;
          break;
        }
      }
    }
    // The outer object is usually the truncated one. Resume just after its
    // opening brace so complete nested card/question objects can be recovered.
    if (end < 0) {
      i = start + 1;
      continue;
    }
    const slice = raw.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) objects.push(parsed);
    } catch {
      // Skip malformed complete-looking spans.
    }
  }
  return objects;
}

export function salvageJsonObject(text) {
  const objects = salvageJsonObjects(text);
  return objects[0] || null;
}
