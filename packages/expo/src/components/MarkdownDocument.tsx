import { Pressable, StyleSheet, Text, View } from "react-native";
import Markdown, { type ASTNode, renderRules } from "react-native-markdown-display";
import { Check } from "lucide-react-native";
import { taskLabel } from "~/lib/documents";

/**
 * The document viewer's markdown renderer (15). The style map is pinned to the
 * 06 design tokens; task-list items (`- [ ]`) render as 20px ink-bordered squares
 * that toggle through `onToggleTask` (the viewer persists a new version on tap).
 */
const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 24, color: "#111111" },
  heading1: { fontSize: 24, fontWeight: "800", color: "#111111", marginTop: 20, marginBottom: 8 },
  heading2: { fontSize: 17, fontWeight: "700", color: "#111111", marginTop: 24, marginBottom: 8 },
  heading3: { fontSize: 15, fontWeight: "700", color: "#111111", marginTop: 16, marginBottom: 6 },
  paragraph: { marginTop: 0, marginBottom: 12, flexWrap: "wrap" },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  strong: { fontWeight: "700" },
  hr: { backgroundColor: "rgba(17,17,17,0.1)", height: 1, marginVertical: 12 },
  blockquote: {
    backgroundColor: "#F0F0F2",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  code_inline: { backgroundColor: "#F0F0F2", borderRadius: 6, paddingHorizontal: 4 },
  fence: { backgroundColor: "#F0F0F2", borderRadius: 12, padding: 12, marginBottom: 12 },
  code_block: { backgroundColor: "#F0F0F2", borderRadius: 12, padding: 12, marginBottom: 12 },
  link: { color: "#111111", textDecorationLine: "underline" },
});

function nodeText(node: ASTNode): string {
  if (node.content) {
    return node.content;
  }
  return (node.children ?? []).map(nodeText).join("");
}

export function MarkdownDocument({
  content,
  onToggleTask,
}: {
  content: string;
  onToggleTask?: (label: string) => void;
}) {
  const defaultListItem = renderRules.list_item;
  const rules = {
    list_item: (
      node: ASTNode,
      children: React.ReactNode[],
      parent: ASTNode[],
      rulesStyles: typeof styles,
      inheritedStyles: object = {},
    ) => {
      const task = taskLabel(nodeText(node));
      if (!task) {
        return defaultListItem
          ? defaultListItem(node, children, parent, rulesStyles, inheritedStyles)
          : null;
      }
      return (
        <Pressable
          key={node.key}
          onPress={onToggleTask ? () => onToggleTask(task.label) : undefined}
          className="flex-row items-start gap-2.5 mb-1.5"
        >
          <View
            className={`w-5 h-5 rounded-md border-2 border-ink items-center justify-center mt-0.5 ${
              task.checked ? "bg-ink" : "bg-white"
            }`}
          >
            {task.checked ? <Check size={13} color="#fff" strokeWidth={3.5} /> : null}
          </View>
          <Text className={`flex-1 text-[15px] leading-[1.6] ${task.checked ? "text-ink/45" : "text-ink"}`}>
            {task.label}
          </Text>
        </Pressable>
      );
    },
  };

  return (
    <Markdown style={styles} rules={rules}>
      {content}
    </Markdown>
  );
}
