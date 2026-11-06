import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./brand";

// A small popover menu. Items are plain buttons; the ones carrying data-* attributes are
// handled by the engine's click delegation, the rest by their own onClick.
export function Menu({ label, children, icon = "kebab", className = "", align = "right", trigger }: { label: string; children: ReactNode; icon?: string; className?: string; align?: "left" | "right"; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };

    document.addEventListener("pointerdown", close);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener("pointerdown", close); };
  }, [open]);
  return (
    <div className={`d3-menu-wrap ${className}`} ref={ref} onKeyDown={event => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return;
      }
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
    }}>
      <button type="button" className={trigger ? "d3-menu-trigger" : "d3-iconbtn"} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
        {trigger || <Icon name={icon} />}
      </button>
      {open && (
        <div className={`d3-menu d3-menu--${align}`} role="menu" onClick={event => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) setTimeout(() => { setOpen(false); if (!document.activeElement || document.activeElement === document.body) ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, 0); }}>
          {children}
        </div>
      )}
    </div>
  );
}
