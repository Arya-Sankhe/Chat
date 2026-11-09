import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./brand";

// A small popover menu. Items are plain buttons; the ones carrying data-* attributes are
// handled by the engine's click delegation, the rest by their own onClick.
// `fixed` places the menu against the window instead of its row, for menus inside a scrolling
// box (it would be cut off there); it opens upward when there's no room below.
export function Menu({ label, children, icon = "kebab", className = "", align = "right", trigger, fixed = false }: { label: string; children: ReactNode; icon?: string; className?: string; align?: "left" | "right"; trigger?: ReactNode; fixed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | undefined>();
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // A transformed ancestor moves what `fixed` is measured from; nudge the menu so it lands
  // where it was meant to, whatever box it ends up inside.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !fixed || !place || !el) return;
    const box = el.getBoundingClientRect();
    const num = (value: unknown) => (typeof value === "number" ? value : null);
    const [left, right, top, bottom] = [num(place.left), num(place.right), num(place.top), num(place.bottom)];
    if (left != null) el.style.left = `${left + (left - box.left)}px`;
    if (right != null) el.style.right = `${right - (window.innerWidth - right - box.right)}px`;
    if (top != null) el.style.top = `${top + (top - box.top)}px`;
    if (bottom != null) el.style.bottom = `${bottom - (window.innerHeight - bottom - box.bottom)}px`;
  }, [open, fixed, place]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const away = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    if (fixed) { document.addEventListener("scroll", close, true); window.addEventListener("resize", away); }
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", away);
    };
  }, [open, fixed]);
  const toggle = (button: HTMLElement) => {
    if (!open && fixed) {
      const box = button.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      const up = below < 280 && box.top > below;
      setPlace({
        position: "fixed",
        left: align === "left" ? box.left : "auto",
        right: align === "right" ? window.innerWidth - box.right : "auto",
        top: up ? "auto" : box.bottom + 6,
        bottom: up ? window.innerHeight - box.top + 6 : "auto",
        maxHeight: Math.max(160, (up ? box.top : below) - 18)
      });
    }
    setOpen(!open);
  };
  return (
    <div className={`d3-menu-wrap ${className}`} ref={ref} onKeyDown={event => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return;
      }
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') || [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
    }}>
      <button type="button" className={trigger ? "d3-menu-trigger" : "d3-iconbtn"} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { event.stopPropagation(); toggle(event.currentTarget); }}>
        {trigger || <Icon name={icon} />}
      </button>
      {open && (
        <div className={`d3-menu d3-menu--${align}`} role="menu" ref={menu} style={fixed ? place : undefined} onClick={event => { if ((event.target as HTMLElement).closest('[role^="menuitem"]')) setTimeout(() => { setOpen(false); if (!document.activeElement || document.activeElement === document.body) ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, 0); }}>
          {children}
        </div>
      )}
    </div>
  );
}
