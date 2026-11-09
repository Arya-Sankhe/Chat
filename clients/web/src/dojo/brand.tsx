// Klui/Dojo brand pieces for the React Dojo: wordmark, folders, the mascot and one icon family.
import { useId } from "react";
import { kluiMarkup } from "../islands/studyLectures.js";

const DOJO_LETTERS = [
  "M8 0H46C74 0 92 20 92 50S74 100 46 100H8Q0 100 0 92V8Q0 0 8 0ZM32 30V70H44C54 70 60 62 60 50S54 30 44 30Z",
  "M142 0H154C180 0 196 20 196 50S180 100 154 100H142C116 100 100 80 100 50S116 0 142 0ZM144 30C136 30 132 38 132 50S136 70 144 70H152C160 70 164 62 164 50S160 30 152 30Z",
  "M258 0H274Q282 0 282 8V58C282 84 266 100 242 100C220 100 206 88 204 68Q203.5 62 210 62H230Q235 62 236 66C237 69 239 70 242 70C247 70 250 67 250 61V8Q250 0 258 0Z",
  "M332 0H344C370 0 386 20 386 50S370 100 344 100H332C306 100 290 80 290 50S306 0 332 0ZM334 30C326 30 322 38 322 50S326 70 334 70H342C350 70 354 62 354 50S350 30 342 30Z"
].join("");

export function Wordmark({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`dojo-wordmark d3-wordmark ${className}`} viewBox="-4 -14 434 130" role="img" aria-label="Dojo">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2=".35">
          <stop offset="0" style={{ stopColor: "var(--d3-mark-a)" }} />
          <stop offset=".55" style={{ stopColor: "var(--d3-mark-b)" }} />
          <stop offset="1" style={{ stopColor: "var(--d3-mark-c)" }} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform="translate(22 0) skewX(-12)" fillRule="evenodd">
        <path d={DOJO_LETTERS} transform="translate(0 7)" style={{ fill: "var(--d3-mark-depth)" }} />
        <path d={DOJO_LETTERS} fill={`url(#${id}-fill)`} style={{ stroke: "var(--d3-mark-line)", strokeWidth: 2 }} />
        <path d={DOJO_LETTERS} fill={`url(#${id}-shine)`} />
      </g>
      <path d="M418 -12c1.4 6 3 7.6 9 9-6 1.4-7.6 3-9 9-1.4-6-3-7.6-9-9 6-1.4 7.6-3 9-9Z" style={{ fill: "var(--d3-mark-a)" }} />
    </svg>
  );
}

export const FOLDER_TONES = ["sage", "clay", "blue", "lilac", "rose"] as const;
const TONE_COLORS: Record<string, [string, string]> = {
  sage: ["#9ad8c4", "#4fa58c"],
  clay: ["#f6c996", "#d98c4c"],
  blue: ["#a7c9f7", "#5a8ee0"],
  lilac: ["#cdb8f5", "#8e6dd8"],
  rose: ["#f5b8c8", "#d7718f"],
  new: ["#c9d3e2", "#8796ae"]
};

export function toneStyle(tone: string) {
  const [light, deep] = TONE_COLORS[tone] || ["#9ad8c4", "#4fa58c"];
  return { "--folder-light": light, "--folder-deep": deep } as React.CSSProperties;
}

// `fluid` leaves the size to CSS (the home page folders); otherwise it is `size` wide.
export function Folder({ tone = "sage", add = false, size = 78, fluid = false }: { tone?: string; add?: boolean; size?: number; fluid?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`dojo-folder d3-folder${add ? " dojo-folder--new" : ""}`} viewBox="0 0 200 180" {...(fluid ? {} : { width: size, height: size * 0.9 })} fill="none" aria-hidden="true" style={{ ...toneStyle(add ? "new" : tone), ...(fluid ? {} : { width: size, height: size * 0.9 }) }}>
      <defs>
        <linearGradient id={`${id}-back`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "var(--folder-deep)", stopOpacity: 0.62 }} /><stop offset="1" style={{ stopColor: "var(--folder-deep)", stopOpacity: 0.9 }} /></linearGradient>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2=".35" y2="1"><stop offset="0" style={{ stopColor: "var(--folder-light)", stopOpacity: 0.95 }} /><stop offset="1" style={{ stopColor: "var(--folder-deep)", stopOpacity: 0.98 }} /></linearGradient>
      </defs>
      <ellipse cx="100" cy="167" rx="68" ry="6" className="dojo-folder-shadow" />
      <path d="M28 44a10 10 0 0 1 10-10h32l12 11h80a10 10 0 0 1 10 10v96a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10Z" fill={`url(#${id}-back)`} className="dojo-folder-back" />
      <g className="dojo-folder-sheet dojo-folder-sheet--one"><rect x="40" y="48" width="100" height="100" rx="6" /><path d="M54 64h36M54 75h67M54 84h58M54 93h65" /></g>
      <g className="dojo-folder-sheet dojo-folder-sheet--two"><rect x="62" y="42" width="100" height="104" rx="6" /><path d="M76 58h31M76 69h70M76 78h60M76 87h67M76 96h43" /></g>
      <g className="dojo-folder-sheet dojo-folder-sheet--three"><rect x="47" y="60" width="108" height="92" rx="6" /><path d="M62 76h29M62 87h79M62 96h65" /></g>
      <path d="M22 88a10 10 0 0 1 10-10h136a10 10 0 0 1 10 10l-6 64a11 11 0 0 1-11 10H39a11 11 0 0 1-11-10Z" fill={`url(#${id}-front)`} className="dojo-folder-front" />
      <path d="M34 82.5h132" className="dojo-folder-rim" />
      {add
        ? <><circle cx="100" cy="122" r="15" className="dojo-folder-badge" /><path d="M100 115v14m-7-7h14" className="dojo-folder-plus" /></>
        : <rect x="42" y="142" width="34" height="5" rx="2.5" className="dojo-folder-label" />}
    </svg>
  );
}

export function toneFor(index: number) {
  return FOLDER_TONES[index % FOLDER_TONES.length] || "sage";
}

// The Klui mascot, with the moods the old Dojo animates (listening, writing, happy).
export function Klui({ mood = "", size = 32 }: { mood?: string; size?: number }) {
  return <span className="d3-klui" dangerouslySetInnerHTML={{ __html: kluiMarkup(mood, size) }} />;
}

const PATHS: Record<string, string> = {
  play: '<path d="m7 4 13 8-13 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  kebab: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  test: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  mindmap: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><circle cx="19" cy="19" r="2"/><path d="M8 7l7 .7M7 8l1.2 7.5M16.5 10l-5 5.5M12 18h4.8"/>',
  podcast: '<circle cx="12" cy="11" r="2"/><path d="M8.5 14.5a5 5 0 1 1 7 0"/><path d="M6 17a8.5 8.5 0 1 1 12 0"/><path d="M12 13v8"/>',
  tutor: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="5" height="7" rx="2"/><rect x="16.5" y="13" width="5" height="7" rx="2"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  notes: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 21h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l3 3.2H6Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>',
  retry: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  sparkle: '<path d="M12 3c.7 4.2 1.8 5.3 6 6-4.2.7-5.3 1.8-6 6-.7-4.2-1.8-5.3-6-6 4.2-.7 5.3-1.8 6-6Z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1L3 20l1.2-5.3A8.5 8.5 0 1 1 21 11.5Z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
};

export function Icon({ name, size = 18, width = 1.8, className = "" }: { name: string; size?: number; width?: number; className?: string }) {
  return (
    <svg className={`d3-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] || "" }} />
  );
}

export const TOOL_ICON: Record<string, string> = { flashcards: "layers", quiz: "test", mindmap: "mindmap", notes: "notes", podcast: "podcast", tutor: "tutor", whiteboard: "pen" };
