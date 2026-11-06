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
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className={`d3-menu-wrap ${className}`} ref={ref}>
      <button type="button" className={trigger ? "d3-menu-trigger" : "d3-iconbtn"} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
        {trigger || <Icon name={icon} />}
      </button>
      {open && (
        <div className={`d3-menu d3-menu--${align}`} role="menu" onClick={() => setTimeout(() => setOpen(false), 0)}>
          {children}
        </div>
      )}
    </div>
  );
}
