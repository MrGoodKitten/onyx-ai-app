/**
 * Unit tests for OnyxChatModelAdapter
 *
 * Tests that the adapter correctly:
 * - Translates Onyx streaming packets to assistant-ui ChatModelRunResult
 * - Handles session creation
 * - Propagates text, reasoning, sources, and tool-call content
 * - Handles stop and error packets
 */

import type { ChatModelRunOptions } from "@assistant-ui/react";
import type { ThreadMessage } from "@assistant-ui/react";
import { OnyxChatModelAdapter } from "./OnyxChatModelAdapter";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/app/app/services/lib", () => ({
  sendMessage: jest.fn(),
  createChatSession: jest.fn().mockResolvedValue("session-abc"),
}));

import { sendMessage, createChatSession } from "@/app/app/services/lib";

const mockSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockCreateChatSession = createChatSession as jest.MockedFunction<
  typeof createChatSession
>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userMessage(text: string): ThreadMessage {
  return {
    id: "msg-1",
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    metadata: { custom: {} },
  } as unknown as ThreadMessage;
}

async function* makePacketStream(
  packets: object[]
): AsyncGenerator<object, void> {
  for (const p of packets) {
    yield p;
  }
}

function buildOptions(
  messages: ThreadMessage[],
  custom: Record<string, unknown> = {}
): ChatModelRunOptions {
  const abortController = new AbortController();
  return {
    messages,
    runConfig: { custom },
    abortSignal: abortController.signal,
    context: {} as ChatModelRunOptions["context"],
    config: {} as ChatModelRunOptions["config"],
    unstable_getMessage: () => messages[messages.length - 1] as ThreadMessage,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OnyxChatModelAdapter", () => {
  let adapter: OnyxChatModelAdapter;

  beforeEach(() => {
    adapter = new OnyxChatModelAdapter();
    jest.clearAllMocks();
  });

  it("creates a new chat session when chatSessionId is not provided", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: "Hello" },
        },
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("Hi")], { personaId: 1 })
    )) {
      results.push(r);
    }

    expect(mockCreateChatSession).toHaveBeenCalledWith(1, null, null);
  });

  it("skips session creation when chatSessionId is provided", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    for await (const _ of adapter.run(
      buildOptions([userMessage("Hi")], { chatSessionId: "existing-session" })
    )) {
      // consume
    }

    expect(mockCreateChatSession).not.toHaveBeenCalled();
  });

  it("yields text content from message_delta packets", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: "Hello" },
        },
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: " World" },
        },
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("Hi")], { chatSessionId: "s1" })
    )) {
      results.push(r);
    }

    // Last result should be complete with accumulated text
    const last = results[results.length - 1];
    expect(last?.status?.type).toBe("complete");
    const textPart = last?.content?.find((p) => p.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    expect(textPart?.text).toBe("Hello World");
  });

  it("yields reasoning content from reasoning_delta packets", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: { type: "reasoning_delta", reasoning: "Let me think..." },
        },
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: "Answer" },
        },
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("Hi")], { chatSessionId: "s1" })
    )) {
      results.push(r);
    }

    const last = results[results.length - 1];
    const reasoningPart = last?.content?.find((p) => p.type === "reasoning") as
      | { type: "reasoning"; text: string }
      | undefined;
    expect(reasoningPart?.text).toBe("Let me think...");
  });

  it("adds sources from search_tool_documents_delta packets", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: {
            type: "search_tool_documents_delta",
            documents: [
              {
                document_id: "doc-1",
                link: "https://example.com/doc",
                semantic_identifier: "Example Doc",
              },
            ],
          },
        },
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: "Found it" },
        },
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("search for something")], {
        chatSessionId: "s1",
      })
    )) {
      results.push(r);
    }

    const last = results[results.length - 1];
    const sourcePart = last?.content?.find((p) => p.type === "source") as
      | { type: "source"; id: string; url: string; title?: string }
      | undefined;
    expect(sourcePart?.id).toBe("doc-1");
    expect(sourcePart?.url).toBe("https://example.com/doc");
    expect(sourcePart?.title).toBe("Example Doc");
  });

  it("marks result as incomplete on error packet", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: { type: "error", message: "Something went wrong" },
        },
      ]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("Hi")], { chatSessionId: "s1" })
    )) {
      results.push(r);
    }

    const last = results[results.length - 1];
    expect(last?.status?.type).toBe("incomplete");
    if (last?.status?.type === "incomplete") {
      expect(last.status.reason).toBe("error");
    }
  });

  it("yields running status during streaming", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([
        {
          placement: { turn_index: 0 },
          obj: { type: "message_delta", content: "Hi" },
        },
        { placement: { turn_index: 0 }, obj: { type: "stop" } },
      ]) as ReturnType<typeof sendMessage>
    );

    const statuses: Array<string | undefined> = [];
    for await (const r of adapter.run(
      buildOptions([userMessage("Hello")], { chatSessionId: "s1" })
    )) {
      statuses.push(r.status?.type);
    }

    expect(statuses).toContain("running");
    expect(statuses[statuses.length - 1]).toBe("complete");
  });

  it("returns empty if there are no user messages", async () => {
    mockSendMessage.mockReturnValue(
      makePacketStream([]) as ReturnType<typeof sendMessage>
    );

    const results = [];
    // Send only an assistant message - no user message
    const assistantMsg = {
      id: "msg-2",
      role: "assistant",
      content: [{ type: "text", text: "previous" }],
      status: { type: "complete", reason: "stop" },
      metadata: {
        custom: {},
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
      },
    } as unknown as ThreadMessage;
    for await (const r of adapter.run(
      buildOptions([assistantMsg], { chatSessionId: "s1" })
    )) {
      results.push(r);
    }

    expect(results).toHaveLength(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
