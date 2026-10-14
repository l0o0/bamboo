import MarkdownIt from "markdown-it";
import type { CSSProperties, MouseEvent } from "react";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

markdown.validateLink = (url) => {
  const value = url.trim();
  return /^(https?:|mailto:)/i.test(value);
};

const linkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return linkOpen
    ? linkOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

export function renderWhiteboardMarkdown(value: string): string {
  return markdown.render(value);
}

export function MarkdownCardBody({
  value,
  className,
  style,
}: {
  value: string;
  className?: string;
  style?: CSSProperties;
}) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest("a");
    if (link) {
      event.stopPropagation();
      if ((link as HTMLAnchorElement).target !== "_blank")
        event.preventDefault();
    }
  };
  return (
    <div
      className={className}
      style={style}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderWhiteboardMarkdown(value) }}
    />
  );
}
