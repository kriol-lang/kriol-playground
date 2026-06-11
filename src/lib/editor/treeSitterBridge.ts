import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

export interface TreeSitterParserLike<TTree = unknown> {
  parse(source: string, previousTree?: TTree): TTree;
}

export function treeSitterBridge(parser?: TreeSitterParserLike): Extension {
  if (!parser)
    return [];

  return ViewPlugin.fromClass(class {
    private tree: unknown;

    constructor(view: EditorView) {
      this.tree = parser.parse(view.state.doc.toString());
    }

    update(update: ViewUpdate) {
      if (!update.docChanged)
        return;
      this.tree = parser.parse(update.state.doc.toString(), this.tree);
    }
  });
}
