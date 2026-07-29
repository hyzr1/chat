// Thin provider adapters. Each turns a chat history into a stream of text
// deltas (for text models) or a single image result (for image models).
// Keys are BYOK: passed in per-request, never stored server-side.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { MODELS } from "./models";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Keys {
  anthropic?: string;
  openai?: string;
}

export interface StreamChunk {
  type: "text" | "image" | "usage" | "error";
  text?: string;
  imageB64?: string;
  inputTokens?: number;
  outputTokens?: number;
  message?: string;
}

const SYSTEM =
  "You are Hyzr Chat, a helpful coding and reasoning assistant. Be concise and correct. " +
  "Use Markdown for code.";

async function* streamAnthropic(
  modelId: string,
  messages: ChatMessage[],
  key: string,
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey: key });
  const stream = client.messages.stream({
    model: modelId,
    max_tokens: 4096,
    system: SYSTEM,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }
  const final = await stream.finalMessage();
  yield {
    type: "usage",
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  };
}

async function* streamOpenAI(
  modelId: string,
  messages: ChatMessage[],
  key: string,
): AsyncGenerator<StreamChunk> {
  const client = new OpenAI({ apiKey: key });
  const stream = await client.chat.completions.create({
    model: modelId,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: SYSTEM },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "text", text: delta };
    if (chunk.usage) {
      yield {
        type: "usage",
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
      };
    }
  }
}

async function* generateImage(
  modelId: string,
  prompt: string,
  key: string,
): AsyncGenerator<StreamChunk> {
  const client = new OpenAI({ apiKey: key });
  yield { type: "text", text: "*Generating image…*\n\n" };
  const res = await client.images.generate({
    model: modelId,
    prompt,
    n: 1,
    size: "1024x1024",
  });
  const b64 = res.data?.[0]?.b64_json;
  if (b64) {
    yield { type: "image", imageB64: b64 };
  } else {
    yield { type: "error", message: "Image model returned no image." };
  }
}

export async function* runModel(
  modelId: string,
  messages: ChatMessage[],
  keys: Keys,
): AsyncGenerator<StreamChunk> {
  const spec = MODELS[modelId];
  if (!spec) {
    yield { type: "error", message: `Unknown model ${modelId}` };
    return;
  }
  const key = keys[spec.provider];
  if (!key) {
    yield {
      type: "error",
      message: `No ${spec.provider} API key connected. Add one in Settings.`,
    };
    return;
  }

  try {
    if (spec.capabilities.includes("image")) {
      const last = [...messages].reverse().find((m) => m.role === "user");
      yield* generateImage(modelId, last?.content ?? "", key);
    } else if (spec.provider === "anthropic") {
      yield* streamAnthropic(modelId, messages, key);
    } else {
      yield* streamOpenAI(modelId, messages, key);
    }
  } catch (e: any) {
    yield { type: "error", message: e?.message ?? "Provider request failed." };
  }
}
