import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVisualizeFrameMessage,
  compactModelDisplayName,
  formatModelMeta,
  getCodeSource,
  inferModelBadges,
  modelBrandLogoUrl,
  normalizeModelList,
  renderContent,
  renderPlainText,
  resetCodeSourceStore,
  resolveDefaultCompareModels,
  stripRedundantSourcesFooter
} from "../public/js/render.js";

test("renderContent turns a completed visualize fence into an offline sandbox", () => {
  delete globalThis.marked;
  resetCodeSourceStore();
  const source = "<!doctype html><html><head></head><body><button>Explore</button><script>document.body.dataset.ready='1'</script></body></html>";
  const html = renderContent(`Built for the chat.\n\n\`\`\`visualize\n${source}\n\`\`\``);
  const id = html.match(/data-visualize-id="(v\d+)"/)?.[1];
  assert.ok(id);
  assert.equal(getCodeSource(id), undefined);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /connect-src &#039;none&#039;/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(html, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /data-visualize-expand/);
  assert.doesNotMatch(html, /Copy code|data-code-id="v/);
  assert.match(html, /klui:visualize:expanded/);
});

test("renderContent turns an incomplete visualize fence into a blurred build state", () => {
  delete globalThis.marked;
  const html = renderContent("```visualize\n<script>parent.document.body.remove()</script>");
  assert.doesNotMatch(html, /<iframe|data-visualize-id/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /visualize-building/);
  assert.match(html, /Taking shape/);
  assert.doesNotMatch(html, /data-code-id|Copy code/);
});

test("renderContent keeps a completed visualization blurred until its turn is final", () => {
  delete globalThis.marked;
  const html = renderContent("```visualize\n<!doctype html><html><body>Still validating</body></html>\n```", { holdVisualize: true });
  assert.match(html, /visualize-building/);
  assert.doesNotMatch(html, /<iframe|data-visualize-id/);
});

test("visualize srcdoc strips hostile policy, base, and refresh tags", () => {
  delete globalThis.marked;
  resetCodeSourceStore();
  const source = '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=/settings"><meta http-equiv="Content-Security-Policy" content="script-src https://evil.example"></head><body>Safe</body></html>';
  const html = renderContent(`\`\`\`visualize\n${source}\n\`\`\``);
  assert.match(html, /base-uri about:/);
  assert.match(html, /&lt;base href=&quot;about:srcdoc&quot;&gt;/);
  assert.doesNotMatch(html, /evil\.example|url=\/settings/);
});

test("renderContent refuses oversized visualize documents", () => {
  delete globalThis.marked;
  resetCodeSourceStore();
  const html = renderContent(`\`\`\`visualize\n<div>${"x".repeat(121 * 1024)}</div>\n\`\`\``);
  assert.match(html, /Visualization unavailable/);
  assert.match(html, /exceeded the 120 KiB limit/);
  assert.doesNotMatch(html, /<iframe|srcdoc=/);
});

test("visualize resize messages require the matching iframe window and clamp height", () => {
  const sourceWindow = {};
  const classes = new Set();
  const frame = {
    dataset: { visualizeId: "v4" },
    contentWindow: sourceWindow,
    style: {},
    closest() { return { classList: { add(value) { classes.add(value); } } }; }
  };
  const root = { querySelectorAll() { return [frame]; } };
  assert.equal(applyVisualizeFrameMessage({ data: { type: "klui:visualize:resize", id: "v4", height: 9000 }, source: {} }, root), false);
  assert.equal(applyVisualizeFrameMessage({ data: { type: "klui:visualize:resize", id: "v4", height: 9000 }, source: sourceWindow }, root), true);
  assert.equal(frame.style.height, "640px");
  assert.ok(classes.has("is-ready"));
});

test("visualize runtime errors stay inside the matching card", () => {
  const sourceWindow = {};
  const classes = new Set();
  const error = { textContent: "", hidden: true };
  const card = {
    classList: { add(value) { classes.add(value); } },
    querySelector() { return error; }
  };
  const frame = {
    dataset: { visualizeId: "v7" },
    contentWindow: sourceWindow,
    closest() { return card; }
  };
  const root = { querySelectorAll() { return [frame]; } };
  assert.equal(applyVisualizeFrameMessage({ data: { type: "klui:visualize:error", id: "v7", message: "Bad syntax" }, source: sourceWindow }, root), true);
  assert.equal(error.textContent, "Bad syntax");
  assert.equal(error.hidden, false);
  assert.ok(classes.has("has-error"));
});

test("renderPlainText preserves pasted text without Markdown formatting", () => {
  const pasted = "## Heading\n```js\nconst key = '<secret>';\n```\n**bold**";
  const html = renderPlainText(pasted);
  assert.equal(html, "## Heading\n```js\nconst key = &#039;&lt;secret&gt;&#039;;\n```\n**bold**");
  assert.doesNotMatch(html, /<pre|<code|<h2|<strong/);
});

test("stripRedundantSourcesFooter leaves citations to the Sources pill", () => {
  const citations = [{ url: "https://example.com/a" }];
  assert.equal(
    stripRedundantSourcesFooter("Answer.\n\nSources: [A](https://example.com/a), [B](https://example.com/b)", citations),
    "Answer."
  );
  assert.equal(stripRedundantSourcesFooter("Answer.\n\nSources: primary data", citations), "Answer.\n\nSources: primary data");
  assert.equal(stripRedundantSourcesFooter("Answer.\n\nSources: [A](https://example.com/a)"), "Answer.\n\nSources: [A](https://example.com/a)");
});

test("resolveDefaultCompareModels picks the standard compare lineup", () => {
  const models = normalizeModelList({
    data: [
      { id: "moonshot/kimi-k2.6", name: "Moonshot: Kimi K2.6" },
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek: DeepSeek V4 Pro" },
      { id: "zhipu/glm-5.1", name: "Zhipu: GLM 5.1" },
      { id: "xiaomi/mimo-v2.5-pro", name: "Xiaomi: MiMo V2.5 Pro" },
      { id: "deepseek/deepseek-v3.2", name: "DeepSeek: DeepSeek V3.2" }
    ]
  });

  assert.deepEqual(resolveDefaultCompareModels(models), [
    "moonshot/kimi-k2.6",
    "deepseek/deepseek-v4-pro",
    "zhipu/glm-5.1",
    "xiaomi/mimo-v2.5-pro"
  ]);
});

test("resolveDefaultCompareModels also works when model ids carry the version", () => {
  const models = normalizeModelList({
    data: [
      { id: "moonshot/kimi-k2.6" },
      { id: "deepseek/deepseek-v4-pro" },
      { id: "zhipu/glm-5.1" },
      { id: "xiaomi/mimo-v2.5-pro" }
    ]
  });

  assert.deepEqual(resolveDefaultCompareModels(models), [
    "moonshot/kimi-k2.6",
    "deepseek/deepseek-v4-pro",
    "zhipu/glm-5.1",
    "xiaomi/mimo-v2.5-pro"
  ]);
});

test("normalizeModelList accepts OpenAI-compatible model list payloads", () => {
  const models = normalizeModelList({
    object: "list",
    data: [
      {
        id: "deepseek-v3.2",
        context_length: 163840,
        max_completion_tokens: 163840,
        name: "DeepSeek: DeepSeek V3.2",
        pricing: { prompt: "0.00000028", completion: "0.00000038" },
        quantization: "Q4_0",
        speed: 50
      }
    ]
  });

  assert.equal(models[0].id, "deepseek-v3.2");
  assert.equal(models[0].rawName, "DeepSeek: DeepSeek V3.2");
  assert.equal(models[0].name, "DeepSeek V3.2");
});

test("compactModelDisplayName keeps text after first colon only", () => {
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek:DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V3.2"), "DeepSeek V3.2");
  assert.equal(compactModelDisplayName("Google: Gemini 2.5 Flash"), "Gemini 2.5 Flash");
  assert.equal(compactModelDisplayName("MoonshotAI: Kimi K2.5"), "Kimi K2.5");
  assert.equal(compactModelDisplayName("deepseek-v3.2"), "deepseek-v3.2");
});

test("inferModelBadges marks greg as reasoning and vision-capable", () => {
  assert.deepEqual(inferModelBadges({ id: "greg", name: "Greg" }), ["vision", "reasoning"]);
  assert.deepEqual(inferModelBadges({
    id: "vendor/plain-model",
    name: "Plain Model",
    architecture: { input_modalities: ["text", "image"] }
  }), ["vision"]);
  assert.deepEqual(inferModelBadges({
    id: "vendor/text-to-image-only",
    name: "Painter",
    architecture: { input_modalities: ["text"], output_modalities: ["image"] }
  }), []);
});

test("modelBrandLogoUrl maps known vendors to bundled SVG paths", () => {
  assert.match(modelBrandLogoUrl({ id: "deepseek/deepseek-v3.2", rawName: "DeepSeek: V3.2", name: "V3.2" }), /deepseek%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "qwen/qwen3", rawName: "Qwen 3", name: "Qwen 3" }), /qwen%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "moonshot/kimi", rawName: "Moonshot: Kimi", name: "Kimi" }), /kimi%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "zhipu/glm-4", rawName: "Zhipu GLM-4", name: "GLM-4" }), /zai%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "minimax/m2", rawName: "MiniMax M2", name: "M2" }), /minimax%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "xiaomi/mimo", rawName: "Xiaomi Mimo", name: "Mimo" }), /xiaomimimo%20logo\.svg$/);
  assert.equal(modelBrandLogoUrl({ id: "unknown-vendor/foo", rawName: "Foo", name: "Foo" }), "");
});

test("model metadata helpers expose useful /models fields", () => {
  const model = {
    id: "kimi-k2-thinking-turbo",
    context_length: 262144,
    max_completion_tokens: 8192,
    quantization: "fp8",
    speed: 105
  };

  assert.deepEqual(formatModelMeta(model), ["262,144 ctx", "8,192 out", "fp8", "~105 tok/s"]);
  assert.deepEqual(inferModelBadges(model), ["vision", "reasoning", "turbo"]);
});

test("renderContent wraps markdown tables in a horizontal scroll container", () => {
  globalThis.marked = {
    parse() {
      return `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    },
    use() {}
  };
  delete globalThis.DOMPurify;
  delete globalThis.katex;
  delete globalThis.hljs;

  const html = renderContent("| A | B |\n| - | - |\n| 1 | 2 |");
  assert.match(html, /<div class="table-scroll"><table>/);
  assert.match(html, /<\/table><\/div>/);
});

test("renderContent strips unsafe HTML from marked output", () => {
  globalThis.marked = {
    parse(src) {
      return `<p>${src}</p><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><script>alert(1)</script>`;
    },
    use() {}
  };
  delete globalThis.DOMPurify;
  delete globalThis.katex;
  delete globalThis.hljs;

  const html = renderContent("hello");
  assert.match(html, /<p>hello<\/p>/);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<script/i);
});

test("renderContent renders likely single-dollar math but leaves prices alone", () => {
  globalThis.marked = {
    parse(src) {
      return `<p>${src}</p>`;
    },
    use() {}
  };
  globalThis.katex = {
    renderToString(tex, options) {
      return `<span class="katex" data-display="${String(options.displayMode)}">${tex}</span>`;
    }
  };
  delete globalThis.DOMPurify;
  delete globalThis.hljs;

  assert.match(renderContent("Formula $x_1 + y$."), /<span class="katex" data-display="false">x_1 \+ y<\/span>/);
  assert.match(renderContent("Costs are $5 and $10 today."), /Costs are \$5 and \$10 today\./);
  assert.match(renderContent("The answer is **$1386 \\text{ N}$**."), /<span class="katex" data-display="false">1386 \\text\{ N\}<\/span>/);
  assert.match(renderContent("1. $f(1)$:"), /<span class="katex" data-display="false">f\(1\)<\/span>/);
  assert.match(renderContent("2. $f(1.2)$:"), /<span class="katex" data-display="false">f\(1\.2\)<\/span>/);
  assert.match(renderContent("3. $f(0.8)$:"), /<span class="katex" data-display="false">f\(0\.8\)<\/span>/);
});

test("renderContent leaves currency-heavy markdown intact (no math hijacking)", () => {
  globalThis.marked = {
    parse(src) {
      return `<p>${src}</p>`;
    },
    use() {}
  };
  globalThis.katex = {
    renderToString(tex) {
      return `<span class="katex">${tex}</span>`;
    }
  };
  delete globalThis.DOMPurify;
  delete globalThis.hljs;

  // Table separators next to prices must survive (no math span eats `|`).
  const table = renderContent("| Xiaomi MiMo v2.5 | $0.140 | $0.280 |");
  assert.doesNotMatch(table, /class="katex"/);
  assert.match(table, /\$0\.140/);
  assert.match(table, /\$0\.280/);

  // `$/M` headers must not turn into math.
  const header = renderContent("| Model | Input $/M | Output $/M |");
  assert.doesNotMatch(header, /class="katex"/);
  assert.match(header, /Input \$\/M/);

  // Bold around prices must not be swallowed.
  const bold = renderContent("0.60 × $0.140 = **$0.084**");
  assert.doesNotMatch(bold, /class="katex"/);
  assert.match(bold, /\*\*\$0\.084\*\*/);

  // Larger amounts with thousands separators stay literal.
  const big = renderContent("Qwen charges $1.600/M vs MiMo's $0.28/M.");
  assert.doesNotMatch(big, /class="katex"/);
});

test("renderContent does not extract math inside code spans or fences", () => {
  globalThis.marked = {
    parse(src) {
      return `<p>${src}</p>`;
    },
    use() {}
  };
  globalThis.katex = {
    renderToString(tex) {
      return `<span class="katex">${tex}</span>`;
    }
  };
  delete globalThis.DOMPurify;
  delete globalThis.hljs;

  assert.doesNotMatch(renderContent("Use `$x_1$` literally."), /class="katex"/);
  assert.doesNotMatch(renderContent("```js\nconst price = '$x_1$';\n```"), /class="katex"/);
});

test("renderContent stores large code blocks by id instead of data attributes", () => {
  const source = `<!DOCTYPE html>\n<html>\n<body>\n${"<div>section</div>\n".repeat(5000)}</body>\n</html>`;
  globalThis.marked = {
    parse() {
      return `<pre><code class="language-html">${source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code></pre>`;
    },
    use() {}
  };
  delete globalThis.DOMPurify;
  delete globalThis.katex;
  delete globalThis.hljs;

  resetCodeSourceStore();
  const html = renderContent("```html\nignored\n```");
  const id = html.match(/data-code-id="(c\d+)"/)?.[1];
  assert.ok(id);
  assert.match(html, new RegExp(`data-code-id="${id}"`));
  assert.doesNotMatch(html, /data-copy-code=/);
  assert.ok(getCodeSource(id).length > 80_000);
  assert.equal(getCodeSource(id), source);
});

test("renderContent adds the code copy SVG after sanitizing model content", () => {
  globalThis.marked = {
    parse() {
      return '<pre><code class="language-js">console.log(&quot;ok&quot;);</code></pre>';
    },
    use() {}
  };
  globalThis.DOMPurify = {
    sanitize(html) {
      return html.replace(/<path\b[^>]*\/>/g, "");
    }
  };
  delete globalThis.katex;
  delete globalThis.hljs;

  const html = renderContent("```js\nconsole.log('ok');\n```");
  assert.match(html, /<path d="M5 15H4/);
});

test("renderContent ignores malformed code fence language headers", () => {
  globalThis.marked = {
    parse() {
      return `<pre><code class="language-print(&quot;bad&quot;) aria-label=&quot;Copy code&quot;">print(&quot;ok&quot;)</code></pre>`;
    },
    use() {}
  };
  delete globalThis.DOMPurify;
  delete globalThis.katex;
  delete globalThis.hljs;

  const html = renderContent("```bad\nprint('ok')\n```");
  assert.match(html, /code-block-header/);
  assert.doesNotMatch(html, /code-block-lang">print/);
  assert.doesNotMatch(html, /aria-label=&quot;Copy code&quot;/);
  assert.match(html, /data-code-id="c\d+"/);
});

test("renderContent allows safe br tags without allowing arbitrary HTML", async () => {
  let renderer;
  globalThis.marked = {
    parse() {
      return [
        renderer.html({ raw: "<br>" }),
        renderer.html({ raw: "<img src=x onerror=alert(1)>" })
      ].join("");
    },
    use(options) {
      renderer = options.renderer;
    }
  };
  delete globalThis.DOMPurify;
  delete globalThis.katex;
  delete globalThis.hljs;

  const { renderContent: freshRenderContent } = await import(`../public/js/render.js?br-test=${Date.now()}`);
  const html = freshRenderContent("line<br>line");
  assert.match(html, /^<br>/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<img/i);
});
