"use client";

import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
  ThreadMessage,
} from "@assistant-ui/react";
import { sendMessage } from "@/app/app/services/lib";
import { createChatSession } from "@/app/app/services/lib";
import {
  BackendMessage,
  FileDescriptor,
  StreamingError,
} from "@/app/app/interfaces";
import { Packet } from "@/app/app/services/streamingModels";
import { PacketType } from "@/app/app/services/lib";
import { Filters } from "@/lib/search/interfaces";

// ─── Onyx-specific run config passed via runConfig.custom ───────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface OnyxRunConfig extends Record<string, any> {
  /**
   * Onyx chat session ID. If omitted the adapter will create a new session
   * using `personaId`.
   */
  chatSessionId?: string;
  /**
   * Parent message ID in the Onyx message tree (null for the first message).
   */
  parentMessageId?: number | null;
  /** Persona / assistant ID to use when creating a new session. */
  personaId?: number;
  /** Optional search filters. */
  filters?: Filters | null;
  /** Whether deep-research mode is active. */
  deepResearch?: boolean;
  /** Allowed tool IDs. */
  enabledToolIds?: number[];
  /** Single forced tool ID. */
  forcedToolId?: number | null;
  /** LLM model provider override. */
  modelProvider?: string;
  /** LLM model version override. */
  modelVersion?: string;
  /** Temperature override. */
  temperature?: number;
  /**
   * Callback invoked after the adapter creates a new chat session.
   * Callers can use this to persist the session ID for future turns.
   */
  onSessionCreated?: (chatSessionId: string) => void;
  /**
   * Callback invoked with the new parent message ID once the backend returns
   * the assistant message ID.  Callers should persist this for the next turn.
   */
  onParentMessageIdUpdate?: (parentMessageId: number) => void;
}

// ─── Helper: extract the last user text from the thread messages ─────────────

function getLastUserText(messages: readonly ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg !== undefined && msg.role === "user") {
      return msg.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("");
    }
  }
  return "";
}

// ─── Module-level counter for unique tool call IDs ───────────────────────────
let _toolCallCounter = 0;

function nextToolCallId(prefix: string): string {
  return `${prefix}_${++_toolCallCounter}`;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * `OnyxChatModelAdapter` bridges the Onyx streaming backend with the
 * `@assistant-ui/react` `ChatModelAdapter` interface.
 *
 * Pass Onyx-specific configuration through `runConfig.custom` when appending
 * a message:
 *
 * ```tsx
 * thread.append({
 *   role: "user",
 *   content: [{ type: "text", text: "Hello" }],
 *   runConfig: { custom: { personaId: 1, chatSessionId: "abc123" } },
 * });
 * ```
 */
export class OnyxChatModelAdapter implements ChatModelAdapter {
  async *run({
    messages,
    runConfig,
    abortSignal,
  }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
    const onyxConfig: OnyxRunConfig =
      (runConfig?.custom as OnyxRunConfig | undefined) ?? {};

    // Resolve or create the chat session
    let chatSessionId = onyxConfig.chatSessionId;
    if (!chatSessionId) {
      const personaId = onyxConfig.personaId ?? 0;
      chatSessionId = await createChatSession(personaId, null, null);
      onyxConfig.onSessionCreated?.(chatSessionId);
    }

    const userText = getLastUserText(messages);
    if (!userText) {
      return;
    }

    const parentMessageId = onyxConfig.parentMessageId ?? null;

    // Accumulate streamed text and reasoning so we can yield incrementally
    let accumulatedText = "";
    let accumulatedReasoning = "";
    let isReasoning = false;

    // Sources (citations) collected during the stream
    const sources: Array<{
      type: "source";
      sourceType: "url";
      id: string;
      url: string;
      title?: string;
    }> = [];

    // Tool-call parts collected during the stream
    const toolCalls: Array<{
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: unknown;
    }> = [];

    const stream = sendMessage({
      message: userText,
      parentMessageId,
      chatSessionId,
      filters: onyxConfig.filters ?? null,
      signal: abortSignal,
      deepResearch: onyxConfig.deepResearch,
      enabledToolIds: onyxConfig.enabledToolIds,
      forcedToolId: onyxConfig.forcedToolId,
      modelProvider: onyxConfig.modelProvider,
      modelVersion: onyxConfig.modelVersion,
      temperature: onyxConfig.temperature,
      origin: "webapp",
    });

    for await (const packet of stream) {
      if (abortSignal?.aborted) {
        break;
      }

      // ── Backend message text packets ──────────────────────────────────────
      const p = packet as PacketType;

      // New packet-based streaming (Packet wrapper)
      if ("obj" in p && "placement" in p) {
        const wrappedPacket = p as Packet;
        const obj = wrappedPacket.obj;

        if (obj.type === "message_delta") {
          accumulatedText += obj.content;
          isReasoning = false;
          yield buildResult(
            accumulatedText,
            accumulatedReasoning,
            sources,
            toolCalls,
            "running"
          );
          continue;
        }

        if (obj.type === "reasoning_delta") {
          accumulatedReasoning += obj.reasoning;
          isReasoning = true;
          yield buildResult(
            accumulatedText,
            accumulatedReasoning,
            sources,
            toolCalls,
            "running"
          );
          continue;
        }

        if (obj.type === "search_tool_documents_delta") {
          for (const doc of obj.documents) {
            sources.push({
              type: "source",
              sourceType: "url",
              id: doc.document_id,
              url: doc.link ?? "",
              title: doc.semantic_identifier ?? doc.document_id,
            });
          }
          yield buildResult(
            accumulatedText,
            accumulatedReasoning,
            sources,
            toolCalls,
            "running"
          );
          continue;
        }

        if (obj.type === "search_tool_start") {
          const toolCallId = nextToolCallId("search");
          toolCalls.push({
            type: "tool-call",
            toolCallId,
            toolName: obj.is_internet_search ? "webSearch" : "search",
            args: {},
            argsText: "{}",
          });
          yield buildResult(
            accumulatedText,
            accumulatedReasoning,
            sources,
            toolCalls,
            "running"
          );
          continue;
        }

        if (obj.type === "stop") {
          yield buildResult(
            accumulatedText,
            accumulatedReasoning,
            sources,
            toolCalls,
            "complete"
          );
          return;
        }

        if (obj.type === "error") {
          yield buildResult(
            accumulatedText || obj.message || "An error occurred.",
            accumulatedReasoning,
            sources,
            toolCalls,
            "error",
            obj.message
          );
          return;
        }
        continue;
      }

      // Legacy flat packets (BackendMessage, StreamingError, etc.)
      const flat = p as BackendMessage | StreamingError | { type?: string };

      if ("error" in flat && flat.error) {
        yield buildResult(
          accumulatedText,
          accumulatedReasoning,
          sources,
          toolCalls,
          "error",
          String(flat.error)
        );
        return;
      }

      if ("message_id" in flat && "parent_message" in flat) {
        // MessageResponseIDInfo — update parent message ID for next turn
        const idInfo = flat as { message_id: number; parent_message: number };
        onyxConfig.onParentMessageIdUpdate?.(idInfo.message_id);
        continue;
      }

      if ("top_message" in flat) {
        // BackendMessage — legacy final text response
        const backendMsg = flat as unknown as BackendMessage;
        if (backendMsg.message) {
          accumulatedText = backendMsg.message;
        }
        yield buildResult(
          accumulatedText,
          accumulatedReasoning,
          sources,
          toolCalls,
          "complete"
        );
        return;
      }
    }

    // Stream exhausted without explicit stop
    yield buildResult(
      accumulatedText,
      accumulatedReasoning,
      sources,
      toolCalls,
      "complete"
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type RunStatus = "running" | "complete" | "error";

function buildResult(
  text: string,
  reasoning: string,
  sources: Array<{
    type: "source";
    sourceType: "url";
    id: string;
    url: string;
    title?: string;
  }>,
  toolCalls: Array<{
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    argsText: string;
    result?: unknown;
  }>,
  runStatus: RunStatus,
  errorMessage?: string
): ChatModelRunResult {
  // Build content as a mutable array first, then narrow to the required type
  type ContentPart =
    | { type: "reasoning"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        argsText: string;
        result?: unknown;
      }
    | { type: "source"; sourceType: "url"; id: string; url: string; title?: string }
    | { type: "text"; text: string };

  const content: ContentPart[] = [];

  if (reasoning) {
    content.push({ type: "reasoning", text: reasoning });
  }

  for (const tc of toolCalls) {
    content.push(tc);
  }

  for (const src of sources) {
    content.push(src);
  }

  if (text) {
    content.push({ type: "text", text });
  }

  const status: ChatModelRunResult["status"] =
    runStatus === "running"
      ? { type: "running" }
      : runStatus === "complete"
        ? { type: "complete", reason: "stop" }
        : {
            type: "incomplete",
            reason: "error" as const,
            error: errorMessage ?? "Stream error",
          };

  return {
    content: content as ChatModelRunResult["content"],
    status,
  };
}
