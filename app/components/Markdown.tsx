"use client";

import { useEffect, useState, ReactNode, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function textOf(node: ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as any).children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeEl = Array.isArray(children) ? children[0] : children;
  const className: string =
    (isValidElement(codeEl) && (codeEl.props as any).className) || "";
  const lang = (className.match(/language-(\w+)/) || [])[1] || "code";
  const raw = textOf(codeEl);

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang}</span>
        <button
          className="code-copy"
          onClick={() => {
            navigator.clipboard.writeText(raw);
            setCopied(true);
            setTimeout(() => setCopied(false), 1300);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  const [browserHost, setBrowserHost] = useState("");
  useEffect(() => setBrowserHost(window.location.hostname), []);
  const reachableHref = (href?: string) => {
    if (!href || !browserHost) return href;
    try {
      const url = new URL(href);
      if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !["localhost", "127.0.0.1", "::1"].includes(browserHost)) {
        url.hostname = browserHost;
        return url.toString();
      }
    } catch {}
    return href;
  };
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => {
            const safeHref = reachableHref(href);
            const visible = textOf(children).trim() === href ? safeHref : children;
            return <a href={safeHref} target="_blank" rel="noreferrer">{visible}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
