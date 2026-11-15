import {copyReviewModel} from '../review-model-equality.js';
import type {ReviewModel} from '../review-model.js';
export type SourceSelection = {anchor: number; focus: number; atom?: boolean};
export type ModelSnapshot = {model: ReviewModel; selection: SourceSelection | null};
const copy = (x: ModelSnapshot): ModelSnapshot => ({model: copyReviewModel(x.model), selection: x.selection && {...x.selection}});
/** Changes are journaled only after commit. A refused replay does not consume an entry. */
export class ModelHistory {
  private entries: {before: ModelSnapshot; after: ModelSnapshot}[] = [];
  private cursor = 0;
  private lastTyping = 0;
  boundary(): void { this.lastTyping = 0; }
  clear(): void { this.entries = []; this.cursor = 0; this.boundary(); }
  record(before: ModelSnapshot, after: ModelSnapshot, typing = false, now = Date.now()): void {
    const last = this.entries[this.cursor - 1];
    const adjacent = last?.after.selection && before.selection &&
      last.after.selection.anchor === before.selection.anchor && last.after.selection.focus === before.selection.focus;
    const group = typing && this.lastTyping > 0 && now - this.lastTyping < 300 && adjacent && this.cursor === this.entries.length;
    this.entries.splice(this.cursor);
    if (group && last) last.after = copy(after);
    else { this.entries.push({before: copy(before), after: copy(after)}); this.cursor += 1; }
    this.lastTyping = typing ? now : 0;
  }
  replay(direction: 'undo' | 'redo', apply: (snapshot: ModelSnapshot) => boolean): boolean {
    const index = direction === 'undo' ? this.cursor - 1 : this.cursor;
    const entry = this.entries[index];
    if (!entry) return false;
    if (!apply(copy(direction === 'undo' ? entry.before : entry.after))) return false;
    this.cursor += direction === 'undo' ? -1 : 1;
    this.boundary();
    return true;
  }
}
