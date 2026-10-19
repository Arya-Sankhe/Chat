import { marked, type Token, type Tokens } from "marked";
import { memo, useMemo, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";
import { fontSize, radius, space, type Palette } from "@klui/shared";
import { useTheme } from "../lib/theme";

/* Native renderer over marked's lexer, the same parser the web client uses.
   Blocks are memoized by their source, so while a reply streams only the
   last block re-renders. */

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) void Linking.openURL(href);
}

function inline(tokens: Token[] | undefined, colors: Palette, keyPrefix: string, style?: TextStyle): ReactNode[] {
  return (tokens ?? []).map((token, i) => {
    const key = `${keyPrefix}.${i}`;
    switch (token.type) {
      case "strong":
        return <Text key={key} style={[style, { fontWeight: "700" }]}>{inline((token as Tokens.Strong).tokens, colors, key, style)}</Text>;
      case "em":
        return <Text key={key} style={[style, { fontStyle: "italic" }]}>{inline((token as Tokens.Em).tokens, colors, key, style)}</Text>;
      case "del":
        return <Text key={key} style={[style, { textDecorationLine: "line-through" }]}>{inline((token as Tokens.Del).tokens, colors, key, style)}</Text>;
      case "codespan":
        return <Text key={key} style={[style, styles.codespan, { backgroundColor: colors.surface }]}>{decode((token as Tokens.Codespan).text)}</Text>;
      case "link": {
        const link = token as Tokens.Link;
        return <Text key={key} style={[style, { textDecorationLine: "underline" }]} onPress={() => openLink(link.href)}>{inline(link.tokens, colors, key, style)}</Text>;
      }
      case "br":
        return "\n";
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? <Text key={key}>{inline(text.tokens, colors, key, style)}</Text> : decode(text.text);
      }
      case "escape":
        return decode((token as Tokens.Escape).text);
      default:
        return "raw" in token ? decode(String(token.raw)) : null;
    }
  });
}

const Block = memo(function Block({ token, colors }: { token: Token; colors: Palette; raw: string }) {
  const body: TextStyle = { color: colors.text, fontSize: fontSize.md, lineHeight: 23 };
  switch (token.type) {
    case "paragraph":
      return <Text style={[body, styles.block]} selectable>{inline((token as Tokens.Paragraph).tokens, colors, "p", body)}</Text>;
    case "heading": {
      const heading = token as Tokens.Heading;
      const size = heading.depth <= 1 ? 22 : heading.depth === 2 ? 19 : 17;
      const style: TextStyle = { ...body, fontSize: size, lineHeight: size * 1.35, fontWeight: "700" };
      return <Text style={[style, styles.block]} selectable>{inline(heading.tokens, colors, "h", style)}</Text>;
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <ScrollView horizontal style={[styles.block, styles.codeBlock, { backgroundColor: colors.codeBg }]} contentContainerStyle={{ padding: space.md }}>
          <Text style={[styles.mono, { color: colors.codeText }]} selectable>{code.text}</Text>
        </ScrollView>
      );
    }
    case "blockquote":
      return (
        <View style={[styles.block, styles.quote, { borderColor: colors.border }]}>
          {(token as Tokens.Blockquote).tokens.map((child, i) => <Block key={i} token={child} colors={colors} raw={child.raw} />)}
        </View>
      );
    case "list": {
      const list = token as Tokens.List;
      const start = typeof list.start === "number" ? list.start : 1;
      return (
        <View style={styles.block}>
          {list.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={[body, styles.bullet]}>{list.ordered ? `${start + i}.` : "•"}</Text>
              <View style={{ flex: 1 }}>
                {item.tokens.map((child, j) => child.type === "text"
                  ? <Text key={j} style={body} selectable>{inline((child as Tokens.Text).tokens ?? [child], colors, "li", body)}</Text>
                  : <Block key={j} token={child} colors={colors} raw={child.raw} />)}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      const cell = (c: Tokens.TableCell, i: number, header: boolean) => (
        <View key={i} style={[styles.cell, { borderColor: colors.border }]}>
          <Text style={[body, header && { fontWeight: "700" }]}>{inline(c.tokens, colors, "td", body)}</Text>
        </View>
      );
      return (
        <ScrollView horizontal style={styles.block}>
          <View>
            <View style={styles.row}>{table.header.map((c, i) => cell(c, i, true))}</View>
            {table.rows.map((row, r) => <View key={r} style={styles.row}>{row.map((c, i) => cell(c, i, false))}</View>)}
          </View>
        </ScrollView>
      );
    }
    case "hr":
      return <View style={[styles.block, { height: StyleSheet.hairlineWidth, backgroundColor: colors.border }]} />;
    case "space":
      return null;
    default:
      return "raw" in token && String(token.raw).trim() ? <Text style={[body, styles.block]} selectable>{String(token.raw).trim()}</Text> : null;
  }
}, (prev, next) => prev.raw === next.raw && prev.colors === next.colors);

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const colors = useTheme();
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text]);
  return <View>{tokens.map((token, i) => <Block key={i} token={token} colors={colors} raw={token.raw} />)}</View>;
});

const styles = StyleSheet.create({
  block: { marginBottom: space.md },
  codespan: { fontFamily: "monospace", fontSize: fontSize.sm },
  codeBlock: { borderRadius: radius.md },
  mono: { fontFamily: "monospace", fontSize: fontSize.sm, lineHeight: 19 },
  quote: { borderLeftWidth: 3, paddingLeft: space.md },
  listItem: { flexDirection: "row", gap: space.sm, marginBottom: space.xs },
  bullet: { minWidth: 18 },
  row: { flexDirection: "row" },
  cell: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: 90 }
});
