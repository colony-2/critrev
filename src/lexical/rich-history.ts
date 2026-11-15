import type {EditorState, SerializedLexicalNode} from 'lexical';
import {reviewModelsEqual} from '../review-model-equality.js';
import type {ReviewModel} from '../review-model.js';
import type {ModelSnapshot} from './model-history.js';

// Serialized documents omit native selections and transient node keys.
export const richDocumentsEqual = (a: EditorState, b: EditorState): boolean =>
  JSON.stringify(a.toJSON()) === JSON.stringify(b.toJSON());

// Typing can move or split text around atoms without changing the image batch.
export const richImagesEqual = (a: EditorState, b: EditorState): boolean => {
  const images = (state: EditorState) => {
    const result: SerializedLexicalNode[] = [];
    const visit = (node: SerializedLexicalNode): void => {
      if (node.type === 'review-image') result.push(node);
      if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(state.toJSON().root);
    return JSON.stringify(result);
  };
  return images(a) === images(b);
};

export function verifiedRichState(
  target: ModelSnapshot,
  project: (state: EditorState) => ReviewModel,
): EditorState | null {
  return target.richState && reviewModelsEqual(project(target.richState), target.model)
    ? target.richState : null;
}
