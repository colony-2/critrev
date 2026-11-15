/** Durable Markdown metadata. Display URLs are supplied separately by the host. */
export type ReviewImage = {src: string; alt: string; title?: string};
export type ReviewImagePasteResult = {images: readonly ReviewImage[]} | {reject: true};
export type ReviewImagePasteFailure =
  | 'rejected' | 'invalid-result' | 'count-mismatch' | 'invalid-image'
  | 'selection-unavailable' | 'callback-error' | 'insertion-failed';
export type ReviewImagePasteOutcome = {files: readonly File[]} & (
  | {inserted: true; images: readonly ReviewImage[]}
  | {inserted: false; reason: ReviewImagePasteFailure}
);
export type ReviewMarkdownInspection = {exact: boolean; projectedMarkdown: string};

const controls = /[\x00-\x1f\x7f-\x9f]/u;
const escape = (value: string) => value.replace(/[\\[\]()"]/g, '\\$&');
export function serializeImage(image: ReviewImage): string {
  return `![${escape(image.alt)}](${escape(image.src)}${image.title === undefined ? '' : ` "${escape(image.title)}"`})`;
}

/** Scanner shared by import, validation and source mapping. No URL is dereferenced. */
export function imageAt(text: string, start = 0): {image: ReviewImage; end: number} | null {
  if (!text.startsWith('![', start)) return null;
  let cursor = start + 2;
  const field = (close: string): string | null => {
    let value = '';
    while (cursor < text.length) {
      const character = text[cursor++]!;
      if (character === '\\' && cursor < text.length) value += text[cursor++];
      else if (character === close) return value;
      else value += character;
    }
    return null;
  };
  const alt = field(']');
  if (alt === null || text[cursor++] !== '(') return null;
  let src = '';
  let depth = 0;
  while (cursor < text.length) {
    const character = text[cursor]!;
    if (character === '\\' && cursor + 1 < text.length) {
      src += text[cursor + 1]; cursor += 2;
    } else if (character === ')' && depth === 0) {
      return {image: {src, alt}, end: cursor + 1};
    } else if (character === ' ' && depth === 0) {
      cursor += 1;
      if (text[cursor++] !== '"') return null;
      const title = field('"');
      if (title === null || text[cursor++] !== ')') return null;
      return {image: {src, alt, title}, end: cursor};
    } else {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      src += character; cursor += 1;
    }
  }
  return null;
}

export function copyValidImages(value: unknown): ReviewImage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const images: ReviewImage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.src !== 'string' ||
        typeof entry.alt !== 'string' || ('title' in entry && typeof entry.title !== 'string')) return null;
    const {src, alt, title} = entry;
    if (!src || /[\s\x00-\x1f\x7f-\x9f<>]/u.test(src) ||
        /^(?:blob|data|javascript|vbscript|file):/i.test(src) || controls.test(alt) ||
        (title !== undefined && controls.test(title))) return null;
    const image: ReviewImage = title === undefined ? {src, alt} : {src, alt, title};
    const spelling = serializeImage(image);
    const parsed = imageAt(spelling);
    if (!parsed || parsed.end !== spelling.length || parsed.image.src !== src || parsed.image.alt !== alt || parsed.image.title !== title) return null;
    images.push(image);
  }
  return images;
}

/** RegExp protocol lets Lexical's text transformer use the same scanner. */
export class ImagePattern extends RegExp {
  constructor(private readonly atEnd = false) { super('!\\['); }
  override exec(text: string): RegExpExecArray | null {
    for (let index = 0; index < text.length - 1; index += 1) {
      if (text[index] === '\\') { index += 1; continue; }
      const parsed = imageAt(text, index);
      if (!parsed || (this.atEnd && parsed.end !== text.length)) continue;
      const match = [text.slice(index, parsed.end)] as RegExpExecArray;
      match.index = index; match.input = text;
      return match;
    }
    return null;
  }
}
