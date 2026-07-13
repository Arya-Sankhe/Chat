let dependenciesPromise;

function loadDependencies() {
  if (!dependenciesPromise) {
    dependenciesPromise = Promise.all([
      import(/* @vite-ignore */ "https://esm.sh/@tiptap/core@3.27.3"),
      import(/* @vite-ignore */ "https://esm.sh/@tiptap/starter-kit@3.27.3"),
      import(/* @vite-ignore */ "https://esm.sh/@tiptap/extension-table@3.27.3"),
      import(/* @vite-ignore */ "https://esm.sh/@tiptap/markdown@3.27.3"),
      import(/* @vite-ignore */ "https://esm.sh/@tiptap/extension-mathematics@3.27.3")
    ]).then(([core, starter, table, markdown, mathematics]) => ({
      Editor: core.Editor,
      StarterKit: starter.StarterKit,
      TableKit: table.TableKit,
      Markdown: markdown.Markdown,
      Mathematics: mathematics.Mathematics,
      migrateMathStrings: mathematics.migrateMathStrings
    }));
  }
  return dependenciesPromise;
}

function editorMarkup() {
  return `
    <div class="document-editor-shell">
      <div class="document-editor-toolbar" role="toolbar" aria-label="Document formatting">
        <button type="button" data-editor-command="undo" title="Undo" aria-label="Undo">&#8592;</button>
        <button type="button" data-editor-command="redo" title="Redo" aria-label="Redo">&#8594;</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="h1" title="Heading 1">H1</button>
        <button type="button" data-editor-command="h2" title="Heading 2">H2</button>
        <button type="button" data-editor-command="h3" title="Heading 3">H3</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="bold" title="Bold"><strong>B</strong></button>
        <button type="button" data-editor-command="italic" title="Italic"><em>I</em></button>
        <button type="button" data-editor-command="strike" title="Strikethrough"><s>S</s></button>
        <button type="button" data-editor-command="code" title="Inline code">&lt;/&gt;</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="bulletList" title="Bullet list" aria-label="Bullet list">&#8226; list</button>
        <button type="button" data-editor-command="orderedList" title="Numbered list" aria-label="Numbered list">1. list</button>
        <button type="button" data-editor-command="blockquote" title="Quote" aria-label="Quote">&#8220;</button>
        <button type="button" data-editor-command="table" title="Insert table">Table +</button>
        <button type="button" data-editor-command="formula" title="Insert formula"><em>f</em>x</button>
      </div>
      <div class="document-table-toolbar hidden" data-table-toolbar role="toolbar" aria-label="Table editing">
        <button type="button" data-editor-command="columnBefore" title="Insert column before">Column &#8592;</button>
        <button type="button" data-editor-command="columnAfter" title="Insert column after">Column &#8594;</button>
        <button type="button" data-editor-command="deleteColumn" title="Delete column">Delete column</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="rowBefore" title="Insert row before">Row &#8593;</button>
        <button type="button" data-editor-command="rowAfter" title="Insert row after">Row &#8595;</button>
        <button type="button" data-editor-command="deleteRow" title="Delete row">Delete row</button>
        <button type="button" data-editor-command="toggleHeader" title="Toggle header row">Header</button>
        <button type="button" class="danger" data-editor-command="deleteTable" title="Delete table">Delete table</button>
      </div>
      <div class="document-editor-scroll">
        <div class="document-editor-paper"><div data-document-editor></div></div>
      </div>
    </div>`;
}

export async function mountDocumentEditor({ container, markdown, onChange }) {
  const deps = await loadDependencies();
  container.innerHTML = editorMarkup();
  const editor = new deps.Editor({
    element: container.querySelector("[data-document-editor]"),
    extensions: [
      deps.StarterKit,
      deps.TableKit.configure({ table: { resizable: true } }),
      deps.Markdown,
      deps.Mathematics.configure({ katexOptions: { throwOnError: false } })
    ],
    content: markdown || "",
    contentType: "markdown",
    autofocus: false,
    editorProps: {
      attributes: { class: "document-editor-content", spellcheck: "true" }
    },
    onUpdate: ({ editor: current }) => onChange?.(current.getMarkdown())
  });

  const toolbar = container.querySelector(".document-editor-toolbar");
  const tableToolbar = container.querySelector("[data-table-toolbar]");
  const activeCommands = {
    h1: () => editor.isActive("heading", { level: 1 }),
    h2: () => editor.isActive("heading", { level: 2 }),
    h3: () => editor.isActive("heading", { level: 3 }),
    bold: () => editor.isActive("bold"),
    italic: () => editor.isActive("italic"),
    strike: () => editor.isActive("strike"),
    code: () => editor.isActive("code"),
    bulletList: () => editor.isActive("bulletList"),
    orderedList: () => editor.isActive("orderedList"),
    blockquote: () => editor.isActive("blockquote")
  };

  function syncToolbar() {
    if (editor.isDestroyed) return;
    const inTable = ["table", "tableRow", "tableCell", "tableHeader"].some((name) => editor.isActive(name));
    tableToolbar.classList.toggle("hidden", !inTable);
    for (const button of toolbar.querySelectorAll("[data-editor-command]")) {
      const active = activeCommands[button.dataset.editorCommand]?.() || false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    toolbar.querySelector('[data-editor-command="undo"]').disabled = !editor.can().chain().focus().undo().run();
    toolbar.querySelector('[data-editor-command="redo"]').disabled = !editor.can().chain().focus().redo().run();
  }

  function run(command) {
    const chain = editor.chain().focus();
    const commands = {
      undo: () => chain.undo().run(),
      redo: () => chain.redo().run(),
      h1: () => chain.toggleHeading({ level: 1 }).run(),
      h2: () => chain.toggleHeading({ level: 2 }).run(),
      h3: () => chain.toggleHeading({ level: 3 }).run(),
      bold: () => chain.toggleBold().run(),
      italic: () => chain.toggleItalic().run(),
      strike: () => chain.toggleStrike().run(),
      code: () => chain.toggleCode().run(),
      bulletList: () => chain.toggleBulletList().run(),
      orderedList: () => chain.toggleOrderedList().run(),
      blockquote: () => chain.toggleBlockquote().run(),
      table: () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      columnBefore: () => chain.addColumnBefore().run(),
      columnAfter: () => chain.addColumnAfter().run(),
      deleteColumn: () => chain.deleteColumn().run(),
      rowBefore: () => chain.addRowBefore().run(),
      rowAfter: () => chain.addRowAfter().run(),
      deleteRow: () => chain.deleteRow().run(),
      toggleHeader: () => chain.toggleHeaderRow().run(),
      deleteTable: () => chain.deleteTable().run(),
      formula: () => {
        const latex = window.prompt("Enter a LaTeX formula");
        return latex?.trim() ? chain.insertBlockMath({ latex: latex.trim() }).run() : false;
      }
    };
    commands[command]?.();
    syncToolbar();
  }

  container.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-editor-command]")) event.preventDefault();
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-editor-command]");
    if (button && !button.disabled) run(button.dataset.editorCommand);
  });
  editor.on("selectionUpdate", syncToolbar);
  editor.on("transaction", syncToolbar);
  deps.migrateMathStrings(editor);
  syncToolbar();

  return {
    getMarkdown: () => editor.getMarkdown(),
    destroy: () => editor.destroy()
  };
}
