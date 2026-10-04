import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToString} from 'react-dom/server';
import {beforeAfterToReviewModel} from '../index.js';
import {ReviewChanges, ReviewEditor, useReview} from './index.js';

test('React entry renders on a server without window/document or imported CSS', () => {
  function App() {
    const review = useReview({defaultValue: beforeAfterToReviewModel('Hello', 'Hello world')});
    return <><ReviewEditor value={review.value} className="my-editor" aria-label="Document" />
      <ReviewChanges value={review.value} renderChange={change => <span>{change.newValue}</span>} /></>;
  }
  const html = renderToString(<App />);
  assert.match(html, /class="my-editor"/);
  assert.match(html, /aria-label="Document"/);
  assert.match(html, /world/);
  assert.doesNotMatch(html, /style=/);
});
