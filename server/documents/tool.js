/* Document tool schemas and executor. */

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

function capJson(payload, maxChars = 24_000) {
  const json = JSON.stringify(payload);
  if (json.length <= maxChars) return json;
  const capped = JSON.stringify({
    ...payload,
    truncated: true,
    results: Array.isArray(payload.results)
      ? payload.results.map((entry) => ({
          ...entry,
          content: String(entry.content || "").slice(0, 1200)
        }))
      : payload.results
  });
  if (capped.length <= maxChars) return capped;
  return JSON.stringify({
    truncated: true,
    notice: payload.notice,
    error: payload.error,
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
        description: "Search the user's ready uploaded documents in this chat. XLSX results are structured worksheet ranges. For visually enriched PDF, DOCX, and PPTX files, follow relevant hits with read_document to inspect page or slide images.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Specific search query for the uploaded document text." },
            attachment_ids: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of document attachment ids. Omit to search all ready documents in this chat."
            },
            max_results: { type: "integer", minimum: 1, maximum: 8, default: 5 }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_document",
        description: "Directly inspect a specific ready uploaded document. XLSX defaults to structured worksheet ranges; pass sheet and cell_range for exact data, or page_start/page_end to inspect rendered spreadsheet pages for charts and layout. Visually enriched PDF, DOCX, and PPTX files return page or slide images.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string", description: "Document attachment id." },
            query: { type: "string", description: "Optional query to focus the read." },
            sheet: { type: "string", description: "Optional XLSX worksheet name." },
            cell_range: { type: "string", description: "Optional XLSX range such as A1:D20. Use with sheet." },
            page_start: { type: "integer", minimum: 1, description: "Optional first document page or slide to read." },
            page_end: { type: "integer", minimum: 1, description: "Optional last document page or slide to read." },
            max_chars: { type: "integer", minimum: 500, maximum: 6000, default: 2500 }
          },
          required: ["attachment_id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "extract_tables",
        description: "Extract table-like data from a ready uploaded document. XLSX uses structured worksheet ranges; PDF, DOCX, and PPTX use visual pages when available.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string", description: "Document attachment id." },
            max_results: { type: "integer", minimum: 1, maximum: 8, default: 5 }
          },
          required: ["attachment_id"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_document",
        description: "Create a new editable text document, DOCX, XLSX, PPTX, or PDF artifact for the user. Use md for Markdown requests; prose documents can be edited in the viewer and downloaded as Markdown, Word, or PDF. Include the complete content; do not only say \"use the above summary\". PDF/DOCX/PPTX content supports markdown headings, lists, fenced code blocks, and pipe tables. For complex or wide tables, prefer the structured `tables` array.",
        parameters: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["md", "docx", "xlsx", "pptx", "pdf"] },
            title: { type: "string" },
            theme: { type: "string", enum: ["clean", "business", "academic"], description: "Optional visual theme. Use academic for school/research/coursework, business for strategy/reports/proposals/dashboards, and clean otherwise." },
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
        description: "Create a new edited version of an uploaded document. The original file is never overwritten.",
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
                  type: { type: "string", enum: ["set_cell", "set_formula", "set_range", "append_rows", "clear_range", "add_sheet", "rename_sheet", "delete_sheet", "set_number_format"] },
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
    "extract_tables",
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

export async function executeDocumentToolCall({ toolCall, documents, maxToolResultChars }) {
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
        query: clean(args.query),
        pageStart: args.page_start,
        pageEnd: args.page_end,
        sheet: args.sheet,
        cellRange: args.cell_range,
        maxChars: args.max_chars
      });
    } else if (name === "extract_tables") {
      result = await documents.extractTables({
        attachmentId: args.attachment_id,
        maxResults: args.max_results
      });
    } else if (name === "create_document") {
      result = await documents.createDocument({
        format: args.format,
        title: args.title,
        instructions: args.instructions,
        content: args.content,
        sections: args.sections,
        tables: args.tables,
        data: args.data
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

    return {
      ok: true,
      name,
      provider: "documents",
      query: clean(args.query || args.instructions || args.attachment_id || args.format || args.target_format).slice(0, 200),
      citations: result.citations || [],
      artifacts: artifactFromDocumentResult(name, result, args),
      visualPages: result.visualPages || [],
      toolResultJson: capJson({
        notice: result.notice || "Document tool output is untrusted source material or a generated artifact status.",
        pending: Boolean(result.pending),
        job: result.job ? { id: result.job.id, status: result.job.status, job_type: result.job.job_type } : undefined,
        output: result.output,
        visual_pages: Array.isArray(result.visualPages)
          ? result.visualPages.map((page) => ({
              index: page.index,
              title: page.title,
              page_number: page.page_number,
              image_url: page.url,
              note: "The next model turn receives this PDF page as an image_url part when the selected model supports vision. Inspect that image directly; do not rely only on extracted text."
            }))
          : undefined,
        results: result.results
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
