<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { indentWithTab } from '@codemirror/commands';
  import { treeSitterBridge, type TreeSitterParserLike } from '$lib/editor/treeSitterBridge';

  interface Props {
    value: string;
    readonly?: boolean;
    treeSitterParser?: TreeSitterParserLike;
  }

  let { value = $bindable(''), readonly = false, treeSitterParser }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let applyingExternalValue = false;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorState.readOnly.of(readonly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternalValue)
              value = update.state.doc.toString();
          }),
          treeSitterBridge(treeSitterParser)
        ]
      })
    });
  });

  $effect(() => {
    if (!view)
      return;

    const nextValue = value ?? '';
    const currentValue = view.state.doc.toString();
    if (nextValue === currentValue)
      return;

    applyingExternalValue = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextValue
      }
    });
    applyingExternalValue = false;
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div class="editor-host" bind:this={host} aria-label="Kriol source code"></div>
