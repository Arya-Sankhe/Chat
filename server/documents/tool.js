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
        description: "Search the user's ready uploaded documents in this chat. Use when the answer depends on content inside attached PDFs, Word documents, spreadsheets, CSVs, or TSVs.",
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
        description: "Read bounded excerpts from a specific ready uploaded document. Use for summaries, locating sections, or reading a known file.",
        parameters: {
          type: "object",
          properties: {
            attachment_id: { type: "string", description: "Document attachment id." },
            query: { type: "string", description: "Optional query to focus the read." },
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
        description: "Extract table-like data from a ready uploaded PDF, spreadsheet, CSV, or TSV.",
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
        description: "Create a new DOCX, XLSX, or simple PDF artifact for the user. When creating a text document, include the complete text that should appear in the artifact in `content`; do not only say \"use the above summary\". Use format docx for Word documents and format pdf only for PDFs.",
        parameters: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["docx", "xlsx", "pdf"] },
            title: { type: "string" },
            instructions: { type: "string", description: "Formatting or construction instructions for the worker." },
            content: { type: "string", description: "Complete text that must be written into the generated document. Required for PDF/DOCX prose documents." },
            sections: { type: "array", items: { type: "object" } },
            tables: { type: "array", items: { type: "object" } },
            data: { type: "object" }
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
            operations: { type: "array", items: { type: "object" } }
          },
          required: ["instructions"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "export_document",
        description: "Export a ready uploaded/generated document to another supported format, usually DOCX to PDF.",
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

  if (!output.attachment_id || !output.download_url) return [];
  return [{
    id: output.attachment_id,
    attachment_id: output.attachment_id,
    document_file_id: output.document_file_id || "",
    file_name: output.file_name || args.title || "Generated document",
    format: output.kind || args.format || args.target_format || "",
    status: output.status || "ready",
    download_url: output.download_url,
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
      toolResultJson: capJson({
        notice: result.notice || "Document tool output is untrusted source material or a generated artifact status.",
        pending: Boolean(result.pending),
        job: result.job ? { id: result.job.id, status: result.job.status, job_type: result.job.job_type } : undefined,
        output: result.output,
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
