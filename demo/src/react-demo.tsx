import {StrictMode, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeAfterToReviewModel, criticMarkupToReviewModel, type ReviewRange} from '../../src/index.js';
import {ReviewChanges, ReviewEditor, useReview, type ReviewEditorHandle, type ReviewContentMode, type ReviewViewMode} from '../../src/react/index.js';
import './react-demo.css';

const initialValue = beforeAfterToReviewModel('Hello **team**.\n\nShip the draft.', 'Hello **team**.\n\nShip the polished draft.');
const classNames = {addition: 'app-addition', deletion: 'app-deletion', rangeComment: 'app-comment'};
const theme = {paragraph: 'app-paragraph', text: {bold: 'app-bold'}};

function App() {
  const review = useReview({defaultValue: initialValue});
  const editor = useRef<ReviewEditorHandle>(null);
  const [contentMode, setContentMode] = useState<ReviewContentMode>('wysiwyg');
  const [viewMode, setViewMode] = useState<ReviewViewMode>('revisions');
  const [readOnly, setReadOnly] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [trackChanges, setTrackChanges] = useState(true);
  const [declineEdits, setDeclineEdits] = useState(false);
  const [pendingRange, setPendingRange] = useState<ReviewRange | null>(null);
  const [comment, setComment] = useState('');
  const [changeCount, setChangeCount] = useState(0);

  return <main>
    <h1>critrev React example</h1>
    <p>All controls, layout and styles on this page belong to the consuming app.</p>
    <nav aria-label="Editor controls">
      <label>Content <select value={contentMode} onChange={event => setContentMode(event.target.value as ReviewContentMode)}>
        <option value="wysiwyg">WYSIWYG</option><option value="source">Source</option>
      </select></label>
      <label>View <select value={viewMode} onChange={event => setViewMode(event.target.value as ReviewViewMode)}>
        <option value="revisions">Revisions</option><option value="accept">Accept preview</option><option value="reject">Reject preview</option>
      </select></label>
      <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />Read only</label>
      <label><input type="checkbox" checked={trackChanges} onChange={event => setTrackChanges(event.target.checked)} />Track changes</label>
      <button onMouseDown={event => event.preventDefault()} onClick={() => setPendingRange(editor.current?.getSelectionRange() ?? null)}>Comment on selection</button>
      <button onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.applyMarkdownFormat({action: 'inline', prefix: '**', suffix: '**', richFormat: 'bold'})}>Bold</button>
      <button onClick={() => review.resolveAll('accept')}>Accept all</button>
      <button onClick={() => review.resolveAll('reject')}>Reject all</button>
      <button onClick={() => review.setValue(initialValue)}>Reset diff</button>
    </nav>
    {mounted && <ReviewEditor ref={editor} value={review.value}
      onChange={value => {setChangeCount(count => count + 1); if (!declineEdits) review.setValue(value);}}
      contentMode={contentMode} viewMode={viewMode} readOnly={readOnly} trackChanges={trackChanges}
      className="app-editor" classNames={classNames} theme={theme}
      onCommentRequest={range => setPendingRange(range)} />}
    {pendingRange && <form onSubmit={event => {
      event.preventDefault();
      review.addComment({...pendingRange, value: comment});
      setPendingRange(null);
      setComment('');
    }}>
      <label>Comment <input autoFocus value={comment} onChange={event => setComment(event.target.value)} /></label>
      <button type="submit">Save comment</button>
      <button type="button" onClick={() => setPendingRange(null)}>Cancel</button>
    </form>}
    <aside aria-label="Review changes">
      <ReviewChanges value={review.value} empty={<p>No changes or comments.</p>}
        renderChange={change => <article data-change-id={change.id}>
          <p>{change.type}: <del>{change.oldValue}</del> <ins>{change.newValue}</ins></p>
          <button onClick={() => review.resolveChange(change.id, 'accept')}>Accept</button>
          <button onClick={() => review.resolveChange(change.id, 'reject')}>Reject</button>
        </article>}
        renderComment={item => <article data-comment-card={item.id}>
          <p>{item.value}</p><q>{review.value.text.slice(item.start, item.end)}</q>
          <button onClick={() => review.removeComment(item.id)}>Delete comment</button>
        </article>} />
    </aside>
    <h2>CriticMarkup</h2><pre data-testid="react-markup">{review.criticMarkup}</pre>
    <h2>Accepted Markdown</h2><pre>{review.finalize({preserveComments: false})}</pre>
    <details><summary>Integration checks</summary>
      <button onClick={() => setMounted(value => !value)}>Toggle editor mount</button>
      <button onClick={() => review.setValue(criticMarkupToReviewModel('First paragraph.\n\nSecond **bold** word.'))}>Load document</button>
      <button onClick={() => {
        review.addComment({start: 0, end: 0, value: 'First note'});
        review.addComment({start: 0, end: 0, value: 'Second note'});
      }}>Add two comments</button>
      <label><input type="checkbox" checked={declineEdits} onChange={event => setDeclineEdits(event.target.checked)} />Decline edits</label>
      <output data-testid="change-count">{changeCount}</output>
      <ReviewEditor aria-label="Independent editor" value={criticMarkupToReviewModel('Independent document')} />
    </details>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
