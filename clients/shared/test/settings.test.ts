import { describe, expect, it } from "vitest";
import { appearanceAttributes, parseSettings } from "../src/settings";

describe("stored chat settings", () => {
  it("reads the current site's value the way it does", () => {
    const { settings, migrated } = parseSettings(JSON.stringify({
      theme: "dark", spectrumLevel: 2, colorPreset: "rose", wallpaper: "moon", voiceSpeed: 1.149, writingStyle: "FORMAL"
    }));
    expect(migrated).toBe(true);
    expect(settings).not.toHaveProperty("theme");
    // Every load opens on Think, whatever was stored.
    expect(settings.spectrumLevel).toBe(1);
    // A swatch other than "default" counts as a deliberate pick.
    expect([settings.colorChosen, settings.colorPreset]).toEqual([true, "rose"]);
    expect(settings.wallpaper).toBe("clouds");
    expect(settings.voiceSpeed).toBe(1.15);
    expect(settings.writingStyle).toBe("formal");
    // "default" alone was never a choice: blue.
    expect(parseSettings('{"colorPreset":"default"}').settings.colorPreset).toBe("ocean");
    expect(parseSettings("{broken").settings.appearance).toBe("system");
  });

  it("derives the wallpaper and accent attributes", () => {
    const { settings } = parseSettings(null);
    expect(appearanceAttributes(settings, true)).toMatchObject({
      accent: "ocean",
      mode: "dark",
      wallpaperSrc: "/images/home-clouds-dark-v3.webp?v=20260825-clouds-dark-v3"
    });
    const alpine = appearanceAttributes({ ...settings, wallpaper: "alpine", appearance: "dark" }, false, true);
    expect(alpine.wallpaperSrc).toBe("/images/home-alpine.webp");
    expect(alpine.style["--home-wallpaper-base"]).toBe('url("/images/home-night-sky.webp")');
    expect(appearanceAttributes({ ...settings, wallpaper: "none" }, false)).toMatchObject({ wallpaperSrc: "", style: {} });
  });
});
