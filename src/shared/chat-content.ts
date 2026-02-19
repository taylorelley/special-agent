export type ContentBlock = { type: string; text?: string };

export function extractTextFromChatContent(
  content: string | ContentBlock[] | undefined | null,
  opts?: {
    sanitize?: boolean;
    normalize?: boolean;
    join?: string;
  },
): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return opts?.sanitize ? content.replaceAll("\0", "").trim() : content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const texts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      const raw = opts?.sanitize ? block.text.replaceAll("\0", "").trim() : block.text;
      if (raw) {
        texts.push(raw);
      }
    }
  }

  const joined = texts.join(opts?.join ?? "\n");
  if (opts?.normalize) {
    return joined.replace(/\s+/g, " ").trim();
  }
  return joined;
}
