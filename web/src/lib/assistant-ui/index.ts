/**
 * @module @onyx/assistant-ui
 *
 * Bridges the `@assistant-ui/react` component library with the Onyx streaming
 * backend.
 *
 * ## Quick Start
 *
 * ```tsx
 * import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react";
 * import { useOnyxRuntime } from "@/lib/assistant-ui";
 *
 * export function OnyxChat({ personaId }: { personaId: number }) {
 *   const runtime = useOnyxRuntime({ personaId });
 *   return (
 *     <AssistantRuntimeProvider runtime={runtime}>
 *       <Thread />
 *     </AssistantRuntimeProvider>
 *   );
 * }
 * ```
 */

export { OnyxChatModelAdapter } from "./OnyxChatModelAdapter";
export type { OnyxRunConfig } from "./OnyxChatModelAdapter";

export { useOnyxRuntime } from "./useOnyxRuntime";
export type { UseOnyxRuntimeOptions } from "./useOnyxRuntime";
