import assert from "node:assert/strict";
import test from "node:test";
import {
  compactModelDisplayName,
  formatModelMeta,
  getCodeSource,
  inferModelBadges,
  modelBrandLogoUrl,
  normalizeModelList,
  renderContent,
  resetCodeSourceStore,
  resolveDefaultCompareModels
} from "../public/js/render.js";

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
  assert.equal(compactModelDisplayName("Google: Gemma 4 31B"), "Gemma 4 31B");
  assert.equal(compactModelDisplayName("MoonshotAI: Kimi K2.5"), "Kimi K2.5");
  assert.equal(compactModelDisplayName("deepseek-v3.2"), "deepseek-v3.2");
});

test("normalizeModelList drops gemma models from the selector list", () => {
  const models = normalizeModelList({
    data: [
      { id: "deepseek-v3.2", name: "DeepSeek: DeepSeek V3.2" },
      { id: "google/gemma-2-9b", name: "Google: Gemma 2 9B" },
      { id: "greg", name: "Crof: Greg" }
    ]
  });
  assert.equal(models.length, 2);
  assert.deepEqual(models.map((model) => model.id), ["deepseek-v3.2", "greg"]);
  assert.equal(models[1].name, "Greg");
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
