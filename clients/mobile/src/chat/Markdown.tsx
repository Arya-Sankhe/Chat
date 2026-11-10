import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { extractMath, type MathSlot } from "@klui/shared";
import { marked, type Token, type Tokens } from "marked";
import { createContext, memo, useContext, useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import { MathBlock } from "./MathBlock";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

type Colors = ReturnType<typeof useTheme>["colors"];
type BlockProps = { token: Token; colors: Colors; math: MathSlot[]; unfinished: boolean };

function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) void WebBrowser.openBrowserAsync(url);
}

function Inline({ tokens, colors }: { tokens?: Token[]; colors: Colors }) {
  return (
    <>
      {(tokens ?? []).map((token, index) => {
        const key = index;
        switch (token.type) {
          case "strong":
            return <Text key={key} style={styles.strong}><Inline tokens={(token as Tokens.Strong).tokens} colors={colors} /></Text>;
          case "em":
            return <Text key={key} style={styles.em}><Inline tokens={(token as Tokens.Em).tokens} colors={colors} /></Text>;
          case "del":
            return <Text key={key} style={styles.del}><Inline tokens={(token as Tokens.Del).tokens} colors={colors} /></Text>;
          case "codespan":
            return <Text key={key} style={[styles.codespan, { backgroundColor: colors.codeBg, color: colors.codeText }]}>{decode((token as Tokens.Codespan).text)}</Text>;
          case "link": {
            const link = token as Tokens.Link;
            return <Text key={key} style={styles.link} accessibilityRole="link" onPress={() => openLink(link.href)}><Inline tokens={link.tokens} colors={colors} /></Text>;
          }
          case "image":
            return <Text key={key} style={styles.link} onPress={() => openLink((token as Tokens.Image).href)}>{(token as Tokens.Image).text || "Image"}</Text>;
          case "br":
            return <Text key={key}>{"\n"}</Text>;
          case "text": {
            const text = token as Tokens.Text;
            return text.tokens ? <Inline key={key} tokens={text.tokens} colors={colors} /> : <Text key={key}>{decode(text.text)}</Text>;
          }
          default:
            return <Text key={key}>{decode(("text" in token && String(token.text)) || token.raw)}</Text>;
        }
      })}
    </>
  );
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
function decode(text: string) {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Opens the reply in the web client, for what it alone can draw. */
export const OpenFullView = createContext<(() => void) | undefined>(undefined);

const WEB_ONLY_BLOCKS: Record<string, string> = { mermaid: "Diagram", visualize: "Visual", email: "Email draft" };

function CodeBlock({ token, colors }: { token: Tokens.Code; colors: Colors }) {
  const openFull = useContext(OpenFullView);
  const webOnly = WEB_ONLY_BLOCKS[token.lang?.split(/\s/)[0] ?? ""];
  if (webOnly) {
    return (
      <Pressable testID="webOnlyBlock" accessibilityRole="button" disabled={!openFull} onPress={openFull}
        style={[styles.webOnly, { backgroundColor: colors.codeBg, borderColor: colors.borderLight }]}>
        <Icon name="open" size={16} color={colors.text} />
        <Text style={[styles.body, { color: colors.text }]}>{webOnly}: open in full view</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.code, { backgroundColor: colors.codeBg, borderColor: colors.borderLight }]}>
      <View style={styles.codeHead}>
        <Text style={[styles.codeLang, { color: colors.textSecondary }]}>{token.lang || "code"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copy code" hitSlop={10}
          onPress={() => void Clipboard.setStringAsync(token.text)}>
          <Icon name="copy" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.codeText, { color: colors.codeText }]}>{token.text}</Text>
      </ScrollView>
    </View>
  );
}

function Table({ token, colors }: { token: Tokens.Table; colors: Colors }) {
  const cell = (item: Tokens.TableCell, index: number, head: boolean) => (
    <View key={index} style={[styles.cell, { borderColor: colors.border, backgroundColor: head ? colors.surface : undefined }]}>
      <Text selectable style={[styles.body, { color: colors.text }, head && styles.strong]}>
        <Inline tokens={item.tokens} colors={colors} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableWrap}>
      <View>
        <View style={styles.tableRow}>{token.header.map((item, index) => cell(item, index, true))}</View>
        {token.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>{row.map((item, index) => cell(item, index, false))}</View>
        ))}
      </View>
    </ScrollView>
  );
}

const HELD_MATH = /KLUIMATHHOLD\d+END/;

function BlockView({ token, colors, math, unfinished }: BlockProps) {
  if (HELD_MATH.test(token.raw)) {
    // Still arriving: its source for now, since a web view per update would be heavy.
    if (unfinished) {
      let source = token.raw;
      for (const slot of math) source = source.replaceAll(slot.token, () => (slot.display ? `$$${slot.latex}$$` : `$${slot.latex}$`));
      return <Text selectable style={[styles.body, { color: colors.text }]}>{source.trim()}</Text>;
    }
    return <MathBlock token={token} slots={math} colors={colors} onLink={openLink} />;
  }
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const size = [24, 21, 18, 16, 15, 15][heading.depth - 1] ?? 15;
      return <Text selectable accessibilityRole="header" style={[styles.heading, { fontSize: size, lineHeight: size * 1.3, color: colors.text }]}><Inline tokens={heading.tokens} colors={colors} /></Text>;
    }
    case "paragraph":
      return <Text selectable style={[styles.body, { color: colors.text }]}><Inline tokens={(token as Tokens.Paragraph).tokens} colors={colors} /></Text>;
    case "text": {
      const text = token as Tokens.Text;
      return <Text selectable style={[styles.body, { color: colors.text }]}>{text.tokens ? <Inline tokens={text.tokens} colors={colors} /> : decode(text.text)}</Text>;
    }
    case "list": {
      const list = token as Tokens.List;
      const first = typeof list.start === "number" ? list.start : 1;
      return (
        <View style={styles.list}>
          {list.items.map((item, index) => (
            <View key={index} style={styles.listItem}>
              <Text style={[styles.body, styles.marker, { color: colors.textSecondary }]}>
                {item.task ? (item.checked ? "☑" : "☐") : list.ordered ? `${first + index}.` : "•"}
              </Text>
              <View style={styles.flex}><Blocks tokens={item.tokens} colors={colors} /></View>
            </View>
          ))}
        </View>
      );
    }
    case "code":
      return <CodeBlock token={token as Tokens.Code} colors={colors} />;
    case "blockquote":
      return <View style={[styles.quote, { borderColor: colors.border }]}><Blocks tokens={(token as Tokens.Blockquote).tokens} colors={colors} /></View>;
    case "table":
      return <Table token={token as Tokens.Table} colors={colors} />;
    case "hr":
      return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
    case "space":
      return null;
    default:
      return token.raw?.trim() ? <Text selectable style={[styles.body, { color: colors.text }]}>{token.raw.trim()}</Text> : null;
  }
}

/* Finished blocks don't change as a reply streams, so only the last one renders again. */
/* The block's text with its math back in: the same raw text can hold different formulas. */
const blockSource = ({ token, math }: BlockProps) => token.raw.replace(/KLUIMATHHOLD\d+END/g, (held) => {
  const slot = math.find((candidate) => candidate.token === held);
  return slot ? `${slot.display ? "$$" : "$"}${slot.latex}` : held;
});

const MemoBlock = memo(BlockView, (a, b) => blockSource(a) === blockSource(b) && a.colors === b.colors && a.unfinished === b.unfinished);

function Blocks({ tokens, colors, math = [], streaming = false }: { tokens?: Token[]; colors: Colors; math?: MathSlot[]; streaming?: boolean }) {
  const list = tokens ?? [];
  return (
    <View style={styles.blocks}>
      {list.map((token, index) => <MemoBlock key={index} token={token} colors={colors} math={math} unfinished={streaming && index === list.length - 1} />)}
    </View>
  );
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { colors } = useTheme();
  const { tokens, math } = useMemo(() => {
    const held = extractMath(text);
    const all = marked.lexer(held.text);
    // A table only parses once its divider row is whole; until then it would show as raw pipes.
    const last = all[all.length - 1];
    return { tokens: streaming && last?.type === "paragraph" && last.raw.startsWith("|") ? all.slice(0, -1) : all, math: held.slots };
  }, [text, streaming]);
  return <Blocks tokens={tokens} colors={colors} math={math} streaming={streaming} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  webOnly: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  blocks: { gap: 10 },
  body: { fontSize: 16, lineHeight: 24 },
  heading: { fontWeight: "600", marginTop: 4 },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through" },
  link: { color: "#2563eb", textDecorationLine: "underline" },
  codespan: { fontFamily: MONO, fontSize: 14 },
  code: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  codeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingTop: 8 },
  codeLang: { fontSize: 12 },
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 19, padding: 12 },
  list: { gap: 6 },
  listItem: { flexDirection: "row", gap: 8 },
  marker: { minWidth: 18 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  tableWrap: { flexGrow: 0 },
  tableRow: { flexDirection: "row" },
  cell: { width: 150, padding: 8, borderWidth: StyleSheet.hairlineWidth }
});
