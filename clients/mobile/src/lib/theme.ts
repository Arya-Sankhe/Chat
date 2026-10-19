import { useColorScheme } from "react-native";
import { palette, type Palette } from "@klui/shared";

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? palette.dark : palette.light;
}
