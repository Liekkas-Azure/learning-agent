"use client";

import { useMemo, type ComponentProps } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "@/components/MermaidDiagram";
import { headingToSectionId } from "@/lib/markdownSections";

function safeImgSrc(src: string | undefined): string | undefined {
  if (!src || typeof src !== "string") return undefined;
  const t = src.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return undefined;
  if (lower.startsWith("data:") && !lower.startsWith("data:image/")) return undefined;
  return t;
}

function buildMarkdownComponents(): Components {
  const heading =
    (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    ({ children, ...rest }: ComponentProps<typeof Tag>) => {
      const text = String(children).replace(/\n/g, " ").trim();
      const id = text ? headingToSectionId(text) : undefined;
      return (
        <Tag {...rest} id={id}>
          {children}
        </Tag>
      );
    };

  return {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6"),
    a: ({ href, children, ...rest }) => (
      <a
        {...rest}
        href={href}
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    ),
    img: ({ src, alt, ...rest }) => {
      const safe = safeImgSrc(typeof src === "string" ? src : undefined);
      if (!safe) return null;
      return <img {...rest} src={safe} alt={alt ?? ""} loading="lazy" decoding="async" />;
    },
    table: ({ children, ...rest }) => (
      <div className="wiki-table-scroll">
        <table {...rest}>{children}</table>
      </div>
    ),
    code(props) {
      const { children, className, ...rest } = props;
      const isInline = (props as { inline?: boolean }).inline === true;
      const text = String(children).replace(/\n$/, "");
      if (!isInline && /language-mermaid\b/.test(className || "")) {
        return <MermaidDiagram key={text.slice(0, 120)} chart={text} />;
      }
      if (isInline) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }
      return (
        <pre className="wiki-md-pre-fence">
          <code className={className} {...rest}>
            {children}
          </code>
        </pre>
      );
    },
  };
}

const markdownComponents = buildMarkdownComponents();

export type WikiReadingMarkdownProps = {
  markdown: string;
  className?: string;
};

export function WikiReadingMarkdown({ markdown, className }: WikiReadingMarkdownProps) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkBreaks], []);
  const rootClass = ["wiki-reading", "wiki-md", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {markdown || ""}
      </ReactMarkdown>
    </div>
  );
}

export default WikiReadingMarkdown;
