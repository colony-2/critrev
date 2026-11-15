import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectMarkdown, createMarkdownSourceMap} from './adapter.js';
import {serializeImage} from './image-markdown.js';
for (const markdown of ['Plain text', '**bold**', '*italic*', '![alt](pasted.png "")', '\\*literal\\*', '``a`b``', '`` `edge` ``', '`  edge spaces  `', '`````\nline\n```\n````\nend\n`````']) {
  test(`actual rich importer/exporter projects ${JSON.stringify(markdown)}`, () => assert.equal(projectMarkdown(markdown), markdown));
}
test('image metadata scanner is used by the real rich importer/exporter', () => {
  const image = {src: 'a(b)\\c[1]".png', alt: '[x] \\ (y) "', title: ''};
  const markdown = serializeImage(image) + serializeImage({src: 'absent.png', alt: ''});
  assert.equal(projectMarkdown(markdown), markdown);
});
test('actual projection reports normalization and unsupported structure', () => {
  assert.equal(projectMarkdown('_italic_'), '*italic*');
  assert.equal(projectMarkdown('* item'), '- item');
  assert.notEqual(projectMarkdown('a\r\n\r\nb'), 'a\r\n\r\nb');
  assert.notEqual(projectMarkdown('<img src="https://unbound.invalid/x">'), '<img src="https://unbound.invalid/x">');
});

test('source mapping counts UTF-16 escapes and whole image atoms without preview text', () => {
  const text = '😀 \\*literal\\* ![a](a.png) end';
  const map = createMarkdownSourceMap(text);
  assert.equal(map.displayText, '😀 *literal* \uFFFC end');
  assert.equal(map.displayToSourceStart[3], 3);
  assert.equal(map.displayToSourceEnd[12], 14);
  const imageStart = text.indexOf('!['), imageEnd = text.indexOf(')', imageStart) + 1;
  const displayStart = map.displayText.indexOf('\uFFFC');
  assert.equal(map.displayToSourceStart[displayStart], imageStart);
  assert.equal(map.displayToSourceEnd[displayStart + 1], imageEnd);
  assert.equal(map.displayToSourceStart[displayStart + 1], imageEnd);
});
test('source mapping uses complete code delimiters and strips code padding', () => {
  assert.equal(createMarkdownSourceMap('`` `edge` ``').displayText, '`edge`');
  assert.equal(createMarkdownSourceMap('``a`b``').displayText, 'a`b');
});

test('escaped link-looking text stays literal beside a real link', () => {
  const markdown = '\\[brackets\\](paren) [real](https://example.com)';
  assert.equal(projectMarkdown(markdown), markdown);
});

test('a selection beginning at an escaped character includes its escape', () => {
  const map = createMarkdownSourceMap('😀 \\*literal\\* end');
  assert.equal(map.displayToSourceStart[3], 3);
  assert.equal(map.displayToSourceEnd[3], 3);
});
