/* Design intent shared by web CSS variables and native styles. Values come
   from public/styles/base.css and themes-dark-accent.css. */

export const palette = {
  light: {
    bg: "#ffffff",
    bgSecondary: "#f9f9f9",
    surface: "#f4f4f7",
    text: "#0d0d0d",
    textSecondary: "#6e6e6e",
    textTertiary: "#999999",
    border: "#e5e5e5",
    borderLight: "#efefef",
    accent: "#0d0d0d",
    accentContrast: "#ffffff",
    danger: "#ef4444",
    codeBg: "#f6f8fa",
    codeText: "#24292f"
  },
  dark: {
    bg: "#1f1f1f",
    bgSecondary: "#2b2b2b",
    surface: "#262626",
    text: "#ececec",
    textSecondary: "#b4b4b4",
    textTertiary: "#8a8a8a",
    border: "#3a3a3a",
    borderLight: "#2e2e2e",
    accent: "#ececec",
    accentContrast: "#1a1a1a",
    danger: "#ef4444",
    codeBg: "#161616",
    codeText: "#e6e6e6"
  }
} as const;

export type ColorScheme = keyof typeof palette;
export type Palette = { [K in keyof (typeof palette)["light"]]: string };

export const radius = { sm: 8, md: 12, lg: 16, full: 9999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { sm: 13, md: 15, lg: 17, xl: 22 } as const;
