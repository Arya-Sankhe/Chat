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

const svg = (content) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;

const icons = {
  undo: svg('<path d="M9 7 4 12l5 5"/><path d="M4 12h9a7 7 0 0 1 7 7"/>'),
  redo: svg('<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a7 7 0 0 0-7 7"/>'),
  code: svg('<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>'),
  bullet: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>'),
  ordered: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1v3M3.5 14h2l-2 3h2"/>'),
  quote: svg('<path d="M7 10h4v4H7V9a4 4 0 0 1 4-4M15 10h4v4h-4V9a4 4 0 0 1 4-4"/>'),
  table: svg('<rect x="3" y="4" width="14" height="16" rx="1.5"/><path d="M3 9h14M8 4v16"/><path d="M20 12v6M17 15h6"/>'),
  columnBefore: svg('<rect x="9" y="4" width="5" height="16" rx="1"/><path d="M5 8v8M2 12h6M4 10l-2 2 2 2"/>'),
  columnAfter: svg('<rect x="4" y="4" width="5" height="16" rx="1"/><path d="M14 8v8M11 12h6M15 10l2 2-2 2"/>'),
  deleteColumn: svg('<rect x="4" y="4" width="5" height="16" rx="1"/><path d="m14 9 6 6M20 9l-6 6"/>'),
  rowBefore: svg('<rect x="4" y="10" width="16" height="5" rx="1"/><path d="M8 5h8M12 2v6M10 4l2-2 2 2"/>'),
  rowAfter: svg('<rect x="4" y="5" width="16" height="5" rx="1"/><path d="M8 15h8M12 12v8M10 18l2 2 2-2"/>'),
  deleteRow: svg('<rect x="4" y="4" width="16" height="5" rx="1"/><path d="m9 14 6 6M15 14l-6 6"/>'),
  deleteTable: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M4 4l16 16"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>')
};

export function protectCurrencyDollars(markdown = "") {
  return String(markdown).replace(/(^|[^\\])\$(?=\d)/g, (_match, prefix) => `${prefix}\\$`);
}

function editorMarkup() {
  return `
    <div class="document-editor-shell">
      <div class="document-editor-toolbar" role="toolbar" aria-label="Document formatting">
        <button type="button" data-editor-command="undo" title="Undo" aria-label="Undo">${icons.undo}</button>
        <button type="button" data-editor-command="redo" title="Redo" aria-label="Redo">${icons.redo}</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="h1" title="Heading 1">H1</button>
        <button type="button" data-editor-command="h2" title="Heading 2">H2</button>
        <button type="button" data-editor-command="h3" title="Heading 3">H3</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="bold" title="Bold"><strong>B</strong></button>
        <button type="button" data-editor-command="italic" title="Italic"><em>I</em></button>
        <button type="button" data-editor-command="strike" title="Strikethrough"><s>S</s></button>
        <button type="button" data-editor-command="code" title="Inline code" aria-label="Inline code">${icons.code}</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="bulletList" title="Bullet list" aria-label="Bullet list">${icons.bullet}</button>
        <button type="button" data-editor-command="orderedList" title="Numbered list" aria-label="Numbered list">${icons.ordered}</button>
        <button type="button" data-editor-command="blockquote" title="Quote" aria-label="Quote">${icons.quote}</button>
        <button type="button" data-editor-command="table" title="Insert table" aria-label="Insert table">${icons.table}</button>
        <button type="button" data-editor-command="formula" title="Insert formula" aria-label="Insert formula"><span class="formula-icon"><em>f</em>x</span></button>
      </div>
      <div class="document-table-toolbar hidden" data-table-toolbar role="toolbar" aria-label="Table editing">
        <button type="button" data-editor-command="columnBefore" title="Insert column before" aria-label="Insert column before">${icons.columnBefore}</button>
        <button type="button" data-editor-command="columnAfter" title="Insert column after" aria-label="Insert column after">${icons.columnAfter}</button>
        <button type="button" data-editor-command="deleteColumn" title="Delete column" aria-label="Delete column">${icons.deleteColumn}</button>
        <span class="document-editor-divider" aria-hidden="true"></span>
        <button type="button" data-editor-command="rowBefore" title="Insert row before" aria-label="Insert row before">${icons.rowBefore}</button>
        <button type="button" data-editor-command="rowAfter" title="Insert row after" aria-label="Insert row after">${icons.rowAfter}</button>
        <button type="button" data-editor-command="deleteRow" title="Delete row" aria-label="Delete row">${icons.deleteRow}</button>
        <button type="button" data-editor-command="toggleHeader" title="Toggle header row" aria-label="Toggle header row"><strong>H</strong></button>
        <button type="button" class="danger" data-editor-command="deleteTable" title="Delete table" aria-label="Delete table">${icons.deleteTable}</button>
      </div>
      <div class="document-formula-popover hidden" data-formula-popover>
        <div class="document-formula-preview" data-formula-preview>Formula preview</div>
        <div class="document-formula-input-row">
          <input type="text" data-formula-input aria-label="LaTeX formula" placeholder="\\frac{a}{b}" autocomplete="off" spellcheck="false">
          <button type="button" data-formula-insert aria-label="Insert formula" title="Insert formula">${icons.check}</button>
        </div>
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
    content: protectCurrencyDollars(markdown),
    contentType: "markdown",
    autofocus: false,
    editorProps: {
      attributes: { class: "document-editor-content", spellcheck: "true" }
    },
    onUpdate: ({ editor: current }) => onChange?.(current.getMarkdown())
  });

  const shell = container.querySelector(".document-editor-shell");
  const toolbar = container.querySelector(".document-editor-toolbar");
  const tableToolbar = container.querySelector("[data-table-toolbar]");
  const formulaPopover = container.querySelector("[data-formula-popover]");
  const formulaInput = container.querySelector("[data-formula-input]");
  const formulaPreview = container.querySelector("[data-formula-preview]");
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

  function selectedTableCell() {
    const resolved = editor.view.domAtPos(editor.state.selection.from).node;
    const element = resolved.nodeType === Node.ELEMENT_NODE ? resolved : resolved.parentElement;
    return element?.closest?.("td, th") || null;
  }

  function positionTableToolbar(targetCell = null) {
    const cell = targetCell || selectedTableCell();
    if (!cell || tableToolbar.classList.contains("hidden")) return;
    const shellRect = shell.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const left = Math.max(10, Math.min(cellRect.left - shellRect.left, shell.clientWidth - tableToolbar.offsetWidth - 10));
    let top = cellRect.top - shellRect.top - tableToolbar.offsetHeight - 8;
    if (top < toolbar.offsetHeight + 6) top = cellRect.bottom - shellRect.top + 8;
    tableToolbar.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function syncToolbar() {
    if (editor.isDestroyed) return;
    const inTable = ["table", "tableRow", "tableCell", "tableHeader"].some((name) => editor.isActive(name));
    tableToolbar.classList.toggle("hidden", !inTable);
    if (inTable) requestAnimationFrame(positionTableToolbar);
    for (const button of toolbar.querySelectorAll("[data-editor-command]")) {
      const active = activeCommands[button.dataset.editorCommand]?.() || false;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    toolbar.querySelector('[data-editor-command="undo"]').disabled = !editor.can().chain().focus().undo().run();
    toolbar.querySelector('[data-editor-command="redo"]').disabled = !editor.can().chain().focus().redo().run();
  }

  function renderFormulaPreview() {
    const latex = formulaInput.value.trim();
    if (!latex) {
      formulaPreview.textContent = "Formula preview";
      return;
    }
    if (globalThis.katex?.render) {
      globalThis.katex.render(latex, formulaPreview, { displayMode: true, throwOnError: false });
    } else {
      formulaPreview.textContent = latex;
    }
  }

  function closeFormulaPopover() {
    formulaPopover.classList.add("hidden");
    formulaInput.value = "";
    formulaPreview.textContent = "Formula preview";
  }

  function openFormulaPopover() {
    const shellRect = shell.getBoundingClientRect();
    const caret = editor.view.coordsAtPos(editor.state.selection.from);
    formulaPopover.classList.remove("hidden");
    const left = Math.max(12, Math.min(caret.left - shellRect.left, shell.clientWidth - formulaPopover.offsetWidth - 12));
    let top = caret.bottom - shellRect.top + 10;
    if (top + formulaPopover.offsetHeight > shellRect.height - 12) top = caret.top - shellRect.top - formulaPopover.offsetHeight - 10;
    formulaPopover.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(Math.max(toolbar.offsetHeight + 8, top))}px, 0)`;
    formulaInput.focus();
  }

  function insertFormula() {
    const latex = formulaInput.value.trim();
    if (!latex) return;
    editor.chain().focus().insertBlockMath({ latex }).run();
    closeFormulaPopover();
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
      deleteTable: () => chain.deleteTable().run()
    };
    commands[command]?.();
    syncToolbar();
  }

  container.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-editor-command], [data-formula-insert]")) event.preventDefault();
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-editor-command]");
    if (button && !button.disabled) {
      if (button.dataset.editorCommand === "formula") openFormulaPopover();
      else run(button.dataset.editorCommand);
      return;
    }
    if (event.target.closest("[data-formula-insert]")) {
      insertFormula();
      return;
    }
    const tableCell = event.target.closest("td, th");
    if (tableCell) {
      tableToolbar.classList.remove("hidden");
      requestAnimationFrame(() => positionTableToolbar(tableCell));
    }
    if (!event.target.closest("[data-formula-popover]")) closeFormulaPopover();
  });
  formulaInput.addEventListener("input", renderFormulaPreview);
  formulaInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      insertFormula();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFormulaPopover();
      editor.commands.focus();
    }
  });
  container.addEventListener("scroll", positionTableToolbar, { passive: true });
  window.addEventListener("resize", positionTableToolbar);
  editor.on("selectionUpdate", syncToolbar);
  editor.on("transaction", syncToolbar);
  deps.migrateMathStrings(editor);
  syncToolbar();

  return {
    getMarkdown: () => editor.getMarkdown(),
    destroy: () => {
      window.removeEventListener("resize", positionTableToolbar);
      editor.destroy();
    }
  };
}
