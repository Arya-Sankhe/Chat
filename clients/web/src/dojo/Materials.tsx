// Course › Materials: slides, PDFs, links and pasted text that feed Ask and the study tools.
import { Icon } from "./brand";
import { day, joinMeta } from "./fmt";
import { Menu } from "./Menu";
import type { DojoHub, DojoView } from "./types";

const KIND_ICON: Record<string, string> = { website: "link", text: "type" };
const KIND_LABEL: Record<string, string> = { website: "website", text: "pasted text", pdf: "PDF", pptx: "slides", ppt: "slides", docx: "document", doc: "document", image: "image" };

export function MaterialsTab({ hub, view }: { hub: DojoHub; view: DojoView }) {
  const { actions } = hub;
  if (view.previewId) {
    return (
      // The viewer's own header has the close button.
      <div className="d3-tabbody d3-tool is-studio">
        <div className="d3-preview dojo-source-preview-slot" />
      </div>
    );
  }
  const items = view.materials || [];
  const pending = view.pendingUploads || [];
  return (
    <div className="d3-tabbody" data-study-drop="">
      <div className="d3-toolbar">
        <p className="d3-group">{items.length ? `${items.length} ${items.length === 1 ? "material" : "materials"}` : "materials"}</p>
        <span className="d3-top-space" />
        <Menu label="Add material" align="right" trigger={<span className="d3-btn is-filled"><Icon name="plus" size={15} />add slides, PDF, link or text</span>}>
          <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.addMaterial("")}><Icon name="file" size={16} />slides or PDF</button>
          <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.addMaterial("website")}><Icon name="link" size={16} />website link</button>
          <button type="button" className="d3-mi" role="menuitem" onClick={() => actions.addMaterial("text")}><Icon name="type" size={16} />paste text</button>
        </Menu>
      </div>
      {(items.length > 0 || pending.length > 0) && (
        <div className="d3-list">
          {pending.map((item, index) => (
            <div className="d3-row" key={`pending-${index}`}>
              <span className="d3-thumb is-icon"><span className="d3-spin" /></span>
              <div className="d3-row-main is-static"><h3>{item.name}</h3><span className="d3-row-meta"><span className="d3-chip is-proc">uploading…</span></span></div>
            </div>
          ))}
          {items.map((item) => (
            <div className="d3-row" key={item.id}>
              <button type="button" className="d3-row-main is-tool" data-view-source={item.id}>
                <span className="d3-thumb is-icon"><Icon name={KIND_ICON[item.kind] || "file"} size={20} /></span>
                <span className="d3-row-copy">
                  <h3>{item.name}</h3>
                  <span className="d3-row-meta">
                    <span>{joinMeta(KIND_LABEL[item.kind] || item.kind || "file", item.pages ? `${item.pages} pages` : "", day(item.createdAt))}</span>
                    {item.status === "reading" && <span className="d3-chip is-proc">reading…</span>}
                    {item.status === "failed" && <span className="d3-chip is-error">couldn’t read it</span>}
                  </span>
                </span>
              </button>
              <Menu label={`Options for ${item.name}`}>
                <button type="button" className="d3-mi" role="menuitem" data-view-source={item.id}><Icon name="file" size={16} />open</button>
                <button type="button" className="d3-mi is-danger" role="menuitem" data-delete-doc={item.id}><Icon name="trash" size={16} />remove</button>
              </Menu>
            </div>
          ))}
        </div>
      )}
      {!items.length && !pending.length && (
        <div className="d3-empty">
          <h3>no materials yet</h3>
          <p>add your slides, readings or a link. klui uses them when you ask questions and when it makes study tools.</p>
        </div>
      )}
      <button type="button" className="d3-quietlink d3-upload-rec" onClick={() => actions.uploadRecording()}>upload a recording (becomes a lecture note)</button>
    </div>
  );
}
