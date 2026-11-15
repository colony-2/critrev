import assert from 'node:assert/strict';
import {test} from 'node:test';
import {copyValidImages, imageAt, ImagePattern, serializeImage} from './image-markdown.js';

for (const src of ['pasted-a.png', '../folder/a(b).png', 'https://host/a.png', 'HTTP://host/a', 'artifact:opaque-id', 'folder/a\\b[1]".png']) {
  for (const title of [undefined, '', 'Title \\ " ( ) [ ]']) {
    test(`U01–U03 round-trip ${JSON.stringify({src, title})}`, () => {
      const image = {src, alt: 'Alt \\ [brackets] (parentheses) "quotes"', ...(title === undefined ? {} : {title})};
      assert.deepEqual(copyValidImages([image]), [image]);
      const spelling = serializeImage(image);
      assert.deepEqual(imageAt(spelling), {image, end: spelling.length});
      assert.equal(new ImagePattern().exec('prefix ' + spelling + ' suffix')?.[0], spelling);
      assert.equal(new ImagePattern(true).exec('prefix ' + spelling)?.index, 7);
    });
  }
}
for (const src of ['blob:x', 'dAtA:image/png', 'JAVASCRIPT:x', 'vbscript:x', 'file:///a', '', ' x', '\u0000x', 'a\u0085b', 'a\u00a0b', 'a\nb', 'a<b', 'a>b', '\tjavascript:x']) {
  test(`U04–U05 reject destination ${JSON.stringify(src)}`, () => assert.equal(copyValidImages([{src, alt: ''}]), null));
}
test('U06–U07 invalid descriptors and whole batches fail before mutation', () => {
  for (const value of [null, [], {}, [null], [{src: 1, alt: ''}], [{src: 'a'}], [{src: 'a', alt: '', title: undefined}], [{src: 'a', alt: '\n'}], [{src: 'a', alt: '', title: '\u007f'}], [{src: 'ok', alt: ''}, {src: 'data:x', alt: ''}]]) assert.equal(copyValidImages(value), null);
  const original = [{src: 'a', alt: ''}]; const copied = copyValidImages(original)!;
  original[0]!.src = 'b'; assert.equal(copied[0]!.src, 'a');
});
test('scanner respects escaping, ordering and balanced destinations', () => {
  assert.equal(new ImagePattern().exec('\\![a](b)'), null);
  assert.deepEqual(imageAt('![a](f(o)o.png)'), {image: {src: 'f(o)o.png', alt: 'a'}, end: 15});
  assert.equal(serializeImage({src: 'folder/a(b).png', alt: '', title: ''}), '![](folder/a\\(b\\).png "")');
});
