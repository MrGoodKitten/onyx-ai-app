"use client";

import { Chat } from "@assistant-ui/react";

export default function OnyxChat() {
  return (
    <Chat
      api={async ({ messages }) => {
        const res = await fetch("/api/onyx-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });

        const data = await res.json();
        return { messages: data.messages };
      }}
    />
  );
}
