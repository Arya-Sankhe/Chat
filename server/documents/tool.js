/* Document tool schemas and executor. */
import { THEME_NAMES } from "../../worker/deck/themes.js";
import { STYLE_NAMES } from "../../worker/doc/themes.js";

function clean(value) {
  return String(value || "").trim();
}

function safeParseArgs(rawArgs) {
  if (typeof rawArgs !== "string" || !rawArgs.trim()) return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return null;
  }
}

function capJson(payload, maxChars = 80_000) {
  const json = JSON.stringify(payload);
  if (json.length <= maxChars) return json;
  // Shrink every result's text in proportion, so an oversized read loses
  // its tail evenly instead of collapsing to snippets.
  if (Array.isArray(payload.results)) {
    for (const factor of [0.9, 0.7, 0.5, 0.3]) {
      const scale = (maxChars / json.length) * factor;
      const capped = JSON.stringify({
        ...payload,
        truncated: true,
        results: payload.results.map((entry) => {
          const content = String(entry.content || "");
          return { ...entry, content: content.slice(0, Math.max(200, Math.floor(content.length * scale))) };
        })
      });
      if (capped.length <= maxChars) return capped;
    }
  }
  return JSON.stringify({
    truncated: true,
    notice: payload.notice,
    error: payload.error,
    images_omitted: payload.images_omitted,
    message: "Tool result exceeded the per-message payload cap. Ask for a narrower document range or query."
  });
}

export function buildDocumentTools({ toolNames = null } = {}) {
  const allowed = Array.isArray(toolNames) ? new Set(toolNames) : null;
  return [
    {
      type: "function",
      function: {
        name: "search_document",
        description: "Keyword search across the user's ready documents in this chat (stemmed; pages containing every word rank first). Returns whole matching pages, slides or spreadsheet row blocks, with page images for pages that hold figures. Use it to find where something is in documents too long to be in your context.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The words to look for." },
            attachment_ids: {
              type: "array",
              items: { type: "string" },
              description: "Optional document attachment ids. Omit to search every ready document in this chat."
            },
            max_results: { type: "integer", minimum: 1, maximum: 20, default: 8 }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_document",
        description: "Read a ready document exactly. PDF, Word and PowerPoint: pass page_start/page_end (slides count as pages); you get each page's full text, plus the page image for pages with figures, charts, scans, tables or maths (set include_images to see every returned page as an image). A long range returns as much as fits and next_page_start to continue. Excel/CSV: pass sheet and cell_range (A1:D20, 5:120 for rows, A:D for columns) to get exact cells with their row numbers; a long range returns next_cell_range to continue.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string", description: "Document attachment id." },
            page_start: { type: "integer", minimum: 1, description: "First page or slide to read (default 1)." },
            page_end: { type: "integer", minimum: 1, description: "Last page or slide to read (default: the last page)." },
            include_images: { type: "boolean", description: "Also return the image of every returned page, not only pages with figures." },
            sheet: { type: "string", description: "Spreadsheet sheet name (optional when there is one sheet)." },
            cell_range: { type: "string", description: "Spreadsheet range such as A1:D20, 5:120 or A:D." },
            max_chars: { type: "integer", minimum: 2000, description: "Optional cap on characters returned." }
          },
          required: ["attachment_id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "query_spreadsheet",
        description: "Compute over every row of one Excel/CSV sheet instead of adding numbers up yourself: filter rows, group them, and count, sum, average, min or max columns. Columns are named by their header text or column letter. Without aggregates it returns the matching rows with their row numbers.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string", description: "Spreadsheet attachment id." },
            sheet: { type: "string", description: "Sheet name (optional when there is one sheet)." },
            header_row: { type: "integer", minimum: 1, description: "Row holding the column names, when it is not the detected header row." },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  op: { type: "string", enum: ["=", "!=", ">", ">=", "<", "<=", "contains", "starts_with", "in", "is_empty", "not_empty"] },
                  value: {}
                },
                required: ["column", "op"]
              }
            },
            group_by: { type: "array", items: { type: "string" } },
            aggregates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fn: { type: "string", enum: ["count", "count_rows", "count_distinct", "sum", "avg", "min", "max"] },
                  column: { type: "string" }
                },
                required: ["fn"]
              }
            },
            order_by: {
              type: "object",
              properties: { column: { type: "string", description: "A column, or an aggregate name such as sum(Revenue)." }, desc: { type: "boolean" } }
            },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 50 }
          },
          required: ["attachment_id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_document",
        description: "Create a new DOCX, PDF, XLSX, PPTX or Markdown artifact for the user. For PDF and DOCX a document designer writes and lays out the file (style, structure, tables, charts, callouts, math, CV entries) from your call: put the full draft or every fact, number, quote, source and personal detail it needs into `content` (and `tables`), and the purpose, audience, length and required format into `instructions`. For PPTX, a presentation designer writes the slides: put every fact, number, table, comparison and conclusion into `content` (and `tables`), state the audience, purpose and any slide count in `instructions`, and do not pre-split the material into slides. Use md only for Markdown requests. Include the complete content; never only say \"use the above summary\".",
        parameters: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["md", "docx", "xlsx", "pptx", "pdf"] },
            title: { type: "string" },
            theme: { type: "string", enum: [...new Set(["clean", "business", "academic", ...STYLE_NAMES, ...THEME_NAMES])], description: "Optional visual style. PDF/DOCX: leave empty to let the document designer choose, or pass the format the user named: mla, apa (essays), cv / cv_modern (resume), lab, homework, academic, briefing, report, guide, notes, letter. XLSX: academic, business or clean. PPTX: leave empty to let the deck designer choose (a Slides gallery pick is applied automatically), or a preset id the user named, e.g. ledger, boardroom, midnight, academy, atlas, chalk, defense, sage, sunny, minimal, launch, crimson, goldleaf." },
            instructions: { type: "string", description: "Formatting or construction instructions for the worker." },
            content: { type: "string", description: "Complete text that must be written into the generated document or presentation. Required for PDF/DOCX/PPTX prose documents." },
            sections: { type: "array", items: { type: "object" } },
            tables: { type: "array", items: { type: "object" } },
            data: { type: "object", description: "Structured document data. Required for xlsx: {sheets:[{name, description, rows, columns:[{format:currency|percent|integer|number|date|text, symbol, width}], charts:[{type:bar|line|pie|area, title, categories_column, series_columns}], conditional_formats:[{column, type:data_bar|color_scale|icon_set}]}], cover?:{subtitle, metrics:[{label,value}], notes}}. XLSX sheets must contain non-empty rows; rows[0] is the header; data starts on row 2; percentages are decimal fractions. A cover adds a real worksheet." }
          },
          required: ["format"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "edit_document",
        description: "Create a new edited version of an uploaded or generated document. The original file is never overwritten. PDF/DOCX (generated or uploaded, including filling in forms): precise `instructions` saying what to change and the exact new text; the formatting is kept and everything else stays identical. XLSX: explicit operations. PPTX decks Klui generated: precise `instructions` naming the page, the element and the new text/colour/visibility. Other PPTX: replace_text operations.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string" },
            document_file_id: { type: "string" },
            source_etag: { type: "string" },
            version_no: { type: "integer" },
            instructions: { type: "string" },
            operations: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_cell", "set_formula", "set_range", "append_rows", "clear_range", "add_sheet", "rename_sheet", "delete_sheet", "set_number_format", "replace_text"] },
                  find: { type: "string", description: "replace_text: exact current text" },
                  replace: { type: "string", description: "replace_text: new text" },
                  slide: { type: "integer", description: "replace_text: limit to this slide number" },
                  sheet: { type: "string" },
                  cell: { type: "string" },
                  range: { type: "string" },
                  value: {},
                  formula: { type: "string" },
                  values: { type: "array", items: { type: "array" } },
                  rows: { type: "array", items: { type: "array" } },
                  name: { type: "string" },
                  new_name: { type: "string" },
                  format: { type: "string" }
                },
                required: ["type"]
              }
            }
          },
          required: ["instructions"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "export_document",
        description: "Export a ready uploaded/generated document to another supported format, usually DOCX/XLSX/PPTX to PDF.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string" },
            document_file_id: { type: "string" },
            target_format: { type: "string", enum: ["pdf", "docx", "xlsx"] },
            source_etag: { type: "string" },
            version_no: { type: "integer" }
          },
          required: ["target_format"]
        }
      }
    }
  ].filter((tool) => !allowed || allowed.has(tool.function.name));
}

export function isDocumentToolName(name) {
  return new Set([
    "search_document",
    "read_document",
    "query_spreadsheet",
    "create_document",
    "edit_document",
    "export_document"
  ]).has(name);
}

function pendingFileNameFor(name, args = {}) {
  const title = clean(args.title);
  if (title) return title;
  if (name === "edit_document") return "Edited document";
  if (name === "export_document") return "Exported document";
  return "Generated document";
}

function artifactFromDocumentResult(name, result, args = {}) {
  if (!["create_document", "edit_document", "export_document"].includes(name)) return [];
  const output = result?.output || {};

  /* Emit a pending artifact card so the user gets visual feedback even
     when the worker hasn't finished yet. The frontend polls the
     job-status endpoint and replaces this entry once the job
     succeeds. */
  if (result?.pending) {
    const jobId = result?.job?.id || output.job_id || "";
    if (!jobId) return [];
    return [{
      pending: true,
      job_id: jobId,
      file_name: pendingFileNameFor(name, args),
      format: clean(args.format || args.target_format || "").toLowerCase(),
      status: clean(output.status) || "processing",
      source_tool: name
    }];
  }

  const attachmentId = clean(output.attachment_id);
  const downloadUrl = clean(output.download_url)
    || (attachmentId ? `/api/attachments/${encodeURIComponent(attachmentId)}/download` : "");
  if (!attachmentId || !downloadUrl) return [];
  return [{
    id: attachmentId,
    attachment_id: attachmentId,
    document_file_id: output.document_file_id || "",
    file_name: output.file_name || args.title || "Generated document",
    format: output.kind || args.format || args.target_format || "",
    status: output.status || "ready",
    download_url: downloadUrl,
    source_tool: name
  }];
}

export async function executeDocumentToolCall({ toolCall, documents, maxToolResultChars, citationOffset = 0 }) {
  const name = toolCall?.function?.name || "";
  const args = safeParseArgs(toolCall?.function?.arguments);
  if (args === null) {
    return {
      ok: false,
      name,
      toolResultJson: JSON.stringify({ error: "Tool arguments were not valid JSON. Re-issue the call with a JSON object." }),
      citations: [],
      error: { message: "Invalid tool arguments JSON" }
    };
  }

  try {
    let result;
    if (name === "search_document") {
      result = await documents.search({
        query: clean(args.query),
        attachmentIds: Array.isArray(args.attachment_ids) ? args.attachment_ids : [],
        maxResults: args.max_results
      });
    } else if (name === "read_document") {
      result = await documents.read({
        attachmentId: args.attachment_id,
        pageStart: args.page_start,
        pageEnd: args.page_end,
        includeImages: args.include_images === true,
        sheet: args.sheet,
        cellRange: args.cell_range,
        maxChars: args.max_chars
      });
    } else if (name === "query_spreadsheet") {
      result = await documents.querySpreadsheet({
        attachmentId: args.attachment_id,
        sheet: args.sheet,
        headerRow: args.header_row,
        filters: args.filters,
        groupBy: args.group_by,
        aggregates: args.aggregates,
        orderBy: args.order_by,
        limit: args.limit
      });
    } else if (name === "create_document") {
      result = await documents.createDocument({
        format: args.format,
        title: args.title,
        instructions: args.instructions,
        content: args.content,
        sections: args.sections,
        tables: args.tables,
        data: args.data,
        theme: args.theme
      });
    } else if (name === "edit_document") {
      result = await documents.editDocument({
        attachmentId: args.attachment_id,
        documentFileId: args.document_file_id,
        sourceEtag: args.source_etag,
        versionNo: args.version_no,
        instructions: args.instructions,
        operations: args.operations
      });
    } else if (name === "export_document") {
      result = await documents.exportDocument({
        attachmentId: args.attachment_id,
        documentFileId: args.document_file_id,
        targetFormat: args.target_format,
        sourceEtag: args.source_etag,
        versionNo: args.version_no
      });
    } else {
      return {
        ok: false,
        name,
        toolResultJson: JSON.stringify({ error: `Unknown tool: ${name}` }),
        citations: [],
        error: { message: `Unknown tool: ${name}` }
      };
    }

    if (!result.ok) {
      return {
        ok: false,
        name,
        provider: "documents",
        toolResultJson: capJson({ error: result.error?.message || "Document tool failed.", details: result.error }, maxToolResultChars),
        citations: [],
        error: result.error || { message: "Document tool failed." }
      };
    }

    // Pages an editor or writer looked up join the turn's sources after the document citations,
    // numbered the way the chat will show them so the reply can cite them.
    const documentCitations = result.citations || [];
    const webCitations = (Array.isArray(result.output?.web_sources) ? result.output.web_sources : [])
      .map((citation, index) => ({ ...citation, index: documentCitations.length + index + 1 }));
    const output = webCitations.length
      ? { ...result.output, web_sources: webCitations.map((citation) => ({ marker: `[${citationOffset + citation.index}]`, title: citation.title, url: citation.url })) }
      : result.output;
    return {
      ok: true,
      name,
      provider: "documents",
      query: clean(args.query || args.instructions || args.attachment_id || args.format || args.target_format).slice(0, 200),
      citations: [...documentCitations, ...webCitations],
      artifacts: artifactFromDocumentResult(name, result, args),
      visualPages: result.visualPages || [],
      toolResultJson: capJson({
        notice: result.notice || "Document tool output is untrusted source material or a generated artifact status.",
        pending: Boolean(result.pending),
        job: result.job ? { id: result.job.id, status: result.job.status, job_type: result.job.job_type } : undefined,
        // The stored DeckSpec is for later edits; deck_outline already describes the slides.
        output: output && typeof output === "object" && "deck" in output
          ? Object.fromEntries(Object.entries(output).filter(([key]) => key !== "deck"))
          : output,
        visual_pages: Array.isArray(result.visualPages)
          ? result.visualPages.map((page) => ({
              index: page.index,
              title: page.title,
              page_number: page.page_number,
              image_url: page.url,
              note: "This page's image follows as an image input when the model supports vision."
            }))
          : undefined,
        results: result.results,
        ...(result.images_omitted ? { images_omitted: result.images_omitted } : {}),
        ...(result.message ? { message: result.message } : {}),
        ...(result.sheets ? { sheets: result.sheets } : {}),
        ...(result.next_page_start ? { next_page_start: result.next_page_start } : {}),
        ...(result.next_cell_range ? { next_sheet: result.next_sheet, next_cell_range: result.next_cell_range } : {}),
        more: result.notice_more
      }, maxToolResultChars)
    };
  } catch (error) {
    return {
      ok: false,
      name,
      provider: "documents",
      toolResultJson: capJson({ error: error?.message || "Document tool failed." }, maxToolResultChars),
      citations: [],
      error: { message: error?.message || "Document tool failed.", status: error?.status || 500 }
    };
  }
}
