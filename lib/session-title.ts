import Anthropic from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages/messages";

const client = new Anthropic();

const MODEL = "claude-haiku-4-5-20251001";
const MAX_INPUT_CHARS = 500;

const SYSTEM_PROMPT =
  "Du lager korte, beskrivende titler på norsk for samtaler i en juridisk AI-assistent for kommuner og byggesaker. " +
  "Returner kun selve tittelen — ingen anførselstegn, ingen punktum, ingen forklaring. " +
  "Maks 6 ord. Bruk substantivfraser, ikke fullstendige setninger.";

export interface GenerateTitleArgs {
  userMessage: string;
  assistantMessage: string;
}

export async function generateSessionTitle(
  args: GenerateTitleArgs,
): Promise<string | null> {
  const userText = args.userMessage.slice(0, MAX_INPUT_CHARS);
  const assistantText = args.assistantMessage.slice(0, MAX_INPUT_CHARS);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 30,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Samtalen:\n\nBruker: ${userText}\n\nAssistent: ${assistantText}\n\n` +
            "Skriv en kort tittel (maks 6 ord) på norsk som beskriver hva samtalen handler om.",
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is TextBlock => b.type === "text",
    );
    const raw = textBlock?.text ?? "";
    const cleaned = raw.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    console.error("generateSessionTitle failed:", err);
    return null;
  }
}
