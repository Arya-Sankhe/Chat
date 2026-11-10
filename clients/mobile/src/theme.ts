import { useColorScheme } from "react-native";
import { palette } from "@klui/shared";

export function useTheme() {
  const scheme = useColorScheme();
  return { dark: scheme === "dark", colors: scheme === "dark" ? palette.dark : palette.light };
}
