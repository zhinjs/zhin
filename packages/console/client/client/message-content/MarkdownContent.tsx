import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  highlightCodeLine,
  parseMarkdown,
  type MarkdownInline,
} from './markdown.js';

export interface MarkdownContentProps {
  readonly text: string;
  readonly className?: string;
}

function InlineContent({ content }: { readonly content: readonly MarkdownInline[] }) {
  const nodes: ReactNode[] = [];
  content.forEach((token, index) => {
    const key = `${token.type}-${index}`;
    const value = token.value.split('\n').map((line, lineIndex, lines) => (
      <Fragment key={`${key}-line-${lineIndex}`}>
        {line}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    ));
    if (token.type === 'strong') nodes.push(<strong key={key}>{value}</strong>);
    else if (token.type === 'emphasis') nodes.push(<em key={key}>{value}</em>);
    else if (token.type === 'strike') nodes.push(<del key={key}>{value}</del>);
    else if (token.type === 'code') nodes.push(<code key={key} className="im-inline-code">{token.value}</code>);
    else if (token.type === 'link') nodes.push(
      <a key={key} href={token.href} target={token.href.startsWith('#') ? undefined : '_blank'} rel="noreferrer" className="im-message-link">{value}</a>,
    );
    else nodes.push(<Fragment key={key}>{value}</Fragment>);
  });
  return <>{nodes}</>;
}

export function CodeBlock({ code, language = '', closed = true }: { readonly code: string; readonly language?: string; readonly closed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => code.split('\n'), [code]);
  const isLong = lines.length > 18 || code.length > 1800;
  const visibleLines = isLong && !expanded ? lines.slice(0, 18) : lines;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className="zhin-code-block">
      <figcaption className="zhin-code-toolbar">
        <span className="zhin-code-language">{language || 'plain text'}</span>
        {!closed ? <span className="zhin-code-streaming">生成中</span> : null}
        <span className="zhin-code-actions">
          <button type="button" onClick={() => setWrapped((value) => !value)} aria-pressed={wrapped}>{wrapped ? '不折行' : '折行'}</button>
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
        </span>
      </figcaption>
      <pre className={wrapped ? 'zhin-code-pre zhin-code-pre--wrap' : 'zhin-code-pre'}>
        <code>
          {visibleLines.map((line, lineIndex) => (
            <span className="zhin-code-line" key={`${lineIndex}-${line}`}>
              <span className="zhin-code-line-number" aria-hidden="true">{lineIndex + 1}</span>
              <span className="zhin-code-line-content">
                {highlightCodeLine(line, language).map((token, tokenIndex) => (
                  <span key={`${token.kind}-${tokenIndex}`} className={`zhin-code-token zhin-code-token--${token.kind}`}>{token.value}</span>
                ))}
                {'\n'}
              </span>
            </span>
          ))}
        </code>
      </pre>
      {isLong ? (
        <button type="button" className="zhin-code-expand" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起代码' : `展开其余 ${lines.length - visibleLines.length} 行`}
        </button>
      ) : null}
    </figure>
  );
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  return (
    <div className={['im-markdown-body', 'zhin-markdown', className].filter(Boolean).join(' ')}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Heading = `h${block.level}` as keyof React.JSX.IntrinsicElements;
          return <Heading key={index} className={`im-markdown-heading im-markdown-heading-${block.level}`}><InlineContent content={block.content} /></Heading>;
        }
        if (block.type === 'paragraph') return <p key={index} className="im-markdown-paragraph"><InlineContent content={block.content} /></p>;
        if (block.type === 'quote') return <blockquote key={index} className="im-markdown-quote"><InlineContent content={block.content} /></blockquote>;
        if (block.type === 'rule') return <hr key={index} className="zhin-markdown-rule" />;
        if (block.type === 'code') return <CodeBlock key={index} code={block.value} language={block.language} closed={block.closed} />;
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={index} className={`im-markdown-list${block.ordered ? ' im-markdown-list-ordered' : ''}`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className={item.checked === undefined ? undefined : 'zhin-markdown-task'}>
                  {item.checked === undefined ? null : <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? '已完成' : '未完成'} />}
                  <InlineContent content={item.content} />
                </li>
              ))}
            </List>
          );
        }
        if (block.type === 'table') {
          return (
            <div className="zhin-markdown-table-wrap" key={index}>
              <table className="zhin-markdown-table">
                <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}><InlineContent content={cell} /></th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineContent content={cell} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
