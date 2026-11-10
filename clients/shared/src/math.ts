export interface MathSlot {
  token: string;
  latex: string;
  display: boolean;
}

function protectCodeSpans(text: string) {
  const slots: Array<{ token: string; raw: string }> = [];
  let id = 0;
  let s = String(text ?? "").replace(/```[\s\S]*?```/g, (raw) => {
    const token = `KLUICODEHOLD${id}END`;
    slots.push({ token, raw });
    id++;
    return token;
  });
  s = s.replace(/`[^`\n]+`/g, (raw) => {
    const token = `KLUICODEHOLD${id}END`;
    slots.push({ token, raw });
    id++;
    return token;
  });
  return { text: s, slots };
}

function restoreCodeSpans(text: string, slots: Array<{ token: string; raw: string }>) {
  let s = text;
  for (const { token, raw } of slots) s = s.replaceAll(token, () => raw);
  return s;
}

function isLikelySingleDollarMath(tex: string) {
  const t = String(tex ?? "").trim();
  if (!t || t.length > 240) return false;

  // A captured pipe means we swallowed a markdown table separator
  // (e.g. "$/M | Output $") — never math.
  if (t.includes("|")) return false;

  // Unambiguous LaTeX: backslash commands, sub/superscripts, braces, or
  // math unicode symbols. These are real math regardless of any digits,
  // so "$1386 \text{ N}$" and "$x_1 + y$" still render.
  if (/\\[a-zA-Z]+|[_^{}]|[∑∫√∞≈≠≤≥±×÷]/.test(t)) return true;

  // Function calls and parenthesized numeric values: f(1), g(x, y),
  // sin(x), (1.2), (0.8).
  if (/^[a-zA-Z]+(?:\([^)]*\))+$/.test(t)) return true;
  if (/^\([^)]+\)$/.test(t) && /[\d.]/.test(t)) return true;

  // Currency / numeric prose: any remaining span that contains a digit but
  // no strong math signal is treated as plain text. This is what keeps
  // prices like $0.140, $1,600, $5, and "$0.140 = **$0.084**" from being
  // hijacked into math and eating the surrounding bold/table markup.
  if (/\d/.test(t)) return false;

  // Digit-free spans: short variables (x, n, ab) and simple algebraic
  // expressions (a = b, x + y) with no currency risk.
  if (/^[a-zA-Z]{1,3}$/.test(t)) return true;
  if (/^[a-zA-Z](?:\s*[=<>+\-*/^]\s*[a-zA-Z]+)+$/.test(t)) return true;

  return false;
}

/** Takes math out of markdown, leaving tokens to swap back after rendering. */
export function extractMath(text: string): { text: string; slots: MathSlot[] } {
  const slots: MathSlot[] = [];
  let id = 0;

  function hold(latex: string, display: boolean) {
    const token = `KLUIMATHHOLD${id}END`;
    slots.push({ token, latex, display });
    id++;
    return token;
  }

  const code = protectCodeSpans(text);
  let s = code.text;

  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex: string) => hold(tex.trim(), true));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => hold(tex.trim(), true));
  s = s.replace(/\\\((.*?)\\\)/g, (_, tex: string) => hold(tex.trim(), false));
  s = s.replace(/(^|[^\\\w$])\$(?!\$)([^\n$]+?)\$(?!\$)/g, (raw, before: string, tex: string) => {
    if (!isLikelySingleDollarMath(tex)) return raw;
    return `${before}${hold(tex.trim(), false)}`;
  });

  s = restoreCodeSpans(s, code.slots);

  return { text: s, slots };
}

