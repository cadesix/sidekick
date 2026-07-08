import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { AdView, MessageAttachment } from "~/lib/chat-thread";
import { readSearchSources, readToolChrome } from "~/features/chat/tool-chrome";
import { SidekickBubble, UserBubble } from "./ChatBubbles";
import { SourcePills } from "./SourcePills";
import { SponsoredCard } from "./SponsoredCard";

/** Filename from the object URL's last (URL-encoded) path segment. */
function filenameFromUrl(url: string): string {
  const segment = url.split("/").pop() ?? "file";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
import { DocumentCard } from "./DocumentCard";
import { FileBubble } from "./FileBubble";
import { ImageBubble } from "./ImageBubble";
import { VoiceBubble } from "./VoiceBubble";

/**
 * One rendered thread message (09): the text bubble plus any attachment bubbles
 * (image grid / voice / file), and — for assistant messages — the tool-driven
 * chrome (a DocumentCard for create/update_document, a "see all →" reminders link).
 */
export function ThreadMessage({
  role,
  text,
  attachments,
  toolCalls,
  ad,
}: {
  role: "user" | "assistant";
  text: string;
  attachments: MessageAttachment[];
  toolCalls: unknown;
  ad?: AdView | null;
}) {
  const router = useRouter();
  if (ad) {
    return <SponsoredCard ad={ad} />;
  }
  const images = attachments.filter((a) => a.kind === "image");
  const audios = attachments.filter((a) => a.kind === "audio");
  const files = attachments.filter((a) => a.kind === "file");
  const chrome = role === "assistant" ? readToolChrome(toolCalls) : { document: null, remindersLink: false };
  const sources = role === "assistant" ? readSearchSources(toolCalls) : [];

  return (
    <View className="gap-2">
      {text.trim().length > 0 ? (
        role === "assistant" ? <SidekickBubble text={text} /> : <UserBubble text={text} />
      ) : null}

      {images.length > 0 ? <ImageBubble uris={images.map((a) => a.url)} /> : null}

      {audios.map((a) => (
        <VoiceBubble key={a.id} url={a.url} durationMs={a.durationMs} transcript={a.transcript} />
      ))}

      {files.map((a) => (
        <FileBubble
          key={a.id}
          filename={filenameFromUrl(a.url)}
          bytes={a.bytes}
          mime={a.mime}
          status={a.status}
        />
      ))}

      {chrome.document ? (
        <DocumentCard
          title={chrome.document.title}
          meta="document"
          preview={chrome.document.preview}
          onPress={() => router.push(`/document/${chrome.document?.documentId}`)}
        />
      ) : null}

      {chrome.remindersLink ? (
        <Pressable onPress={() => router.push("/reminders")} className="self-start active:opacity-60">
          <Text className="text-[12px] font-medium text-ink/40">see all →</Text>
        </Pressable>
      ) : null}

      <SourcePills sources={sources} />
    </View>
  );
}
