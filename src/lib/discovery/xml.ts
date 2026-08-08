// Minimal RSS/Atom parsing for trusted feed payloads (arXiv Atom, lab
// RSS/Atom feeds). Deliberately not a general XML parser: we only need to
// split feed items and pull a handful of fields. Feed content is treated as
// untrusted *data* — parsed text is never executed and never fetched.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => ENTITIES[name] ?? match);
}

/** Split an XML document into the text of each <tag>...</tag> block. */
export function extractXmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

/** Extract the inner text of the first <tag>...</tag> inside a block. */
export function xmlField(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = re.exec(block);
  if (!match) return null;
  let inner = match[1];
  // Strip a CDATA wrapper: <![CDATA[...]]>
  inner = inner.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
  return decodeEntities(inner.trim().replace(/\s+/g, ' '));
}

/** Extract a link: Atom <link href="..."/> or RSS <link>...</link>. */
export function xmlLink(block: string): string | null {
  const href = /<link[^>]*href="([^"]+)"/i.exec(block);
  if (href) return href[1].trim();
  const plain = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  if (plain) return plain[1].trim();
  return null;
}

/**
 * Parse an RSS or Atom feed document into uniform items:
 * { title, summary, link, publishedAt } — with the RSS (item) and Atom
 * (entry) conventions both handled.
 */
export interface FeedItem {
  title: string | null;
  summary: string | null;
  link: string | null;
  publishedAt: string | null;
}

export function parseFeedItems(xml: string): FeedItem[] {
  const entries = extractXmlBlocks(xml, 'entry');
  const items = extractXmlBlocks(xml, 'item');
  const blocks = entries.length > 0 ? entries : items;

  return blocks.map(block => {
    const title = xmlField(block, 'title');
    const summary = xmlField(block, 'summary') ?? xmlField(block, 'description') ?? xmlField(block, 'content:encoded') ?? null;
    const link = xmlLink(block);
    const publishedAt =
      xmlField(block, 'published') ??
      xmlField(block, 'pubDate') ??
      xmlField(block, 'updated') ??
      null;
    return { title, summary, link, publishedAt };
  });
}
