import type { Criterion, Rubric } from './types.ts';

/** Lowercase, ASCII-ish id from free text: "Facts are sourced" -> "facts-are-sourced". */
export function slug(text: string): string {
  return text
    .replace(/[łŁ]/g, 'l')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Parse a rubric written in Markdown.
 *
 * - The first `# Heading` (if any) is the title.
 * - Every list item (`- `, `* `, `1. `) is one criterion.
 * - `- id: text` sets the id explicitly; otherwise the id is a slug of the text.
 * - Everything else (prose, blank lines) is ignored.
 */
export function parseRubric(markdown: string): Rubric {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  let title = 'Rubric';
  const criteria: Criterion[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^#\s+(.+)$/.exec(line);
    if (heading && title === 'Rubric') {
      title = heading[1].trim();
      continue;
    }
    const item = /^(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (!item) continue;
    const body = item[1].trim();
    const explicit = /^`?([a-z0-9][a-z0-9-]{0,47})`?\s*:\s*(.+)$/i.exec(body);
    let id: string;
    let text: string;
    if (explicit) {
      id = explicit[1].toLowerCase();
      text = explicit[2].trim();
    } else {
      id = slug(body);
      text = body;
    }
    if (!text) continue;
    if (!id) throw new Error(`Cannot make an id from "${body.slice(0, 40)}". Give it one: "- my-id: ${body.slice(0, 30)}".`);
    if (seen.has(id)) throw new Error(`Rubric has two criteria with the id "${id}".`);
    seen.add(id);
    criteria.push({ id, text });
  }

  if (criteria.length === 0) {
    throw new Error('Rubric has no criteria. Write each one as a list item: "- id: what the reader gets".');
  }
  return { title, criteria };
}
