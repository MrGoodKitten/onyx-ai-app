"use client";

import { useMemo, useRef, useCallback } from "react";
import { useLocalRuntime } from "@assistant-ui/react";
import type { AssistantRuntime } from "@assistant-ui/react";
import { OnyxChatModelAdapter, OnyxRunConfig } from "./OnyxChatModelAdapter";

export interface UseOnyxRuntimeOptions
  extends Omit<
    OnyxRunConfig,
    "chatSessionId" | "parentMessageId" | "onSessionCreated" | "onParentMessageIdUpdate"
  > {}

/**
 * `useOnyxRuntime` creates an `@assistant-ui/react` local runtime backed by
 * the Onyx streaming API.
 *
 * The returned `runtime` can be passed directly to
 * `<AssistantRuntimeProvider runtime={runtime}>`.
 *
 * Chat session lifecycle (create / update) is managed internally.  The caller
 * can optionally pass `onSessionCreated` / `onParentMessageIdUpdate` callbacks
 * via each message's `runConfig.custom` if they need to observe those values.
 *
 * @example
 * ```tsx
 * function MyChat({ personaId }: { personaId: number }) {
 *   const runtime = useOnyxRuntime({ personaId });
 *   return (
 *     <AssistantRuntimeProvider runtime={runtime}>
 *       <Thread />
 *     </AssistantRuntimeProvider>
 *   );
 * }
 * ```
 */
export function useOnyxRuntime(
  options: UseOnyxRuntimeOptions = {}
): AssistantRuntime {
  // Keep a stable ref to the shared session state so the adapter can update it
  const sessionRef = useRef<{
    chatSessionId: string | undefined;
    parentMessageId: number | null;
  }>({ chatSessionId: undefined, parentMessageId: null });

  const onSessionCreated = useCallback((id: string) => {
    sessionRef.current.chatSessionId = id;
  }, []);

  const onParentMessageIdUpdate = useCallback((msgId: number) => {
    sessionRef.current.parentMessageId = msgId;
  }, []);

  // Keep a stable ref to the adapter instance - it has no constructor params so
  // it never needs to be recreated.
  const adapterRef = useRef(new OnyxChatModelAdapter());
  const adapter = adapterRef.current;

  // Inject session-tracking callbacks into every run via a model-context
  // provider so callers don't need to manage them manually.
  // NOTE: `onSessionCreated` and `onParentMessageIdUpdate` have empty
  // dependency arrays in useCallback so they're stable; we include `adapter`
  // only since the wrapped adapter delegates to it.
  const wrappedAdapter = useMemo<OnyxChatModelAdapter>(() => {
    const wrapped: OnyxChatModelAdapter = {
      run: async function* (opts) {
        const base: OnyxRunConfig = {
          ...(opts.runConfig?.custom as OnyxRunConfig | undefined),
          // Merge stable options from hook
          personaId:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)?.personaId ??
            options.personaId,
          filters:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)?.filters ??
            options.filters,
          deepResearch:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.deepResearch ?? options.deepResearch,
          enabledToolIds:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.enabledToolIds ?? options.enabledToolIds,
          forcedToolId:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.forcedToolId ?? options.forcedToolId,
          modelProvider:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.modelProvider ?? options.modelProvider,
          modelVersion:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.modelVersion ?? options.modelVersion,
          temperature:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.temperature ?? options.temperature,
          // Session state maintained across turns
          chatSessionId:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.chatSessionId ?? sessionRef.current.chatSessionId,
          parentMessageId:
            (opts.runConfig?.custom as OnyxRunConfig | undefined)
              ?.parentMessageId ?? sessionRef.current.parentMessageId,
          onSessionCreated,
          onParentMessageIdUpdate,
        };

        yield* adapter.run({
          ...opts,
          runConfig: { ...opts.runConfig, custom: base },
        });
      },
    };
    return wrapped;
  }, [adapter]);

  return useLocalRuntime(wrappedAdapter);
}
