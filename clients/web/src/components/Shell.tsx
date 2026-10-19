import { useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar";

export function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className={`shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar onNavigate={() => setSidebarOpen(false)} />
      <button className="sidebar-scrim" type="button" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" aria-label="Open menu" onClick={() => setSidebarOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
          </button>
          <span className="brand">Klui</span>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
