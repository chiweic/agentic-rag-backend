import ReactMarkdown from "react-markdown";
import type { Message } from "@/lib/api";
import { CitationPills } from "./CitationPills";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2 text-sm text-white">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="markdown max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2 text-sm text-zinc-900">
        {message.text ? (
          <ReactMarkdown
            components={{
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  {children}
                </a>
              ),
            }}
          >
            {message.text}
          </ReactMarkdown>
        ) : (
          <span className="text-zinc-400">…</span>
        )}
      </div>
      {message.citations.length > 0 ? (
        <div className="max-w-[85%]">
          <CitationPills citations={message.citations} />
        </div>
      ) : null}
    </div>
  );
}
