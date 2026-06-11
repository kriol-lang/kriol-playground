<script lang="ts">
  import logoUrl from '../assets/kriol-lang-logo.svg';
  import KriolEditor from '$lib/components/KriolEditor.svelte';
  import { BackendCompiler } from '$lib/compiler/backendCompiler';
  import type { CompileResponse, CompileStatus } from '$lib/compiler/types';
  import { runWasiModule, type WasiRunResult } from '$lib/runtime/wasiRunner';

  const backendCompiler = new BackendCompiler();

  let source = `fn inisiu() {
    textu mensagem = "Kuale, Mundu!";
    mostran(mensagem);
}
`;
  let status: CompileStatus = 'idle';
  let result: CompileResponse | null = null;
  let wasmUrl = '';
  let wasmBytes: Uint8Array | null = null;
  let runStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
  let runResult: WasiRunResult | null = null;
  let runError = '';
  let theme: 'light' | 'dark' = 'light';

  $: diagnostics = result?.diagnostics ?? [];
  $: canDownload = Boolean(result?.ok && wasmUrl);
  $: canRun = Boolean(result?.ok && wasmBytes && runStatus !== 'running');
  $: isBusy = status === 'queued' || status === 'running';
  $: if (typeof document !== 'undefined')
    document.documentElement.dataset.theme = theme;

  async function compile() {
    status = 'queued';
    result = null;
    wasmBytes = null;
    runStatus = 'idle';
    runResult = null;
    runError = '';
    revokeWasmUrl();

    try {
      const response = await backendCompiler.compile({
        source,
        target: 'wasm32-wasi'
      });
      result = response;
      status = response.ok ? 'done' : 'error';

      if (response.ok && response.wasmBase64) {
        const bytes = base64ToBytes(response.wasmBase64);
        wasmBytes = bytes;
        wasmUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
      }
    } catch (error) {
      status = 'error';
      result = {
        ok: false,
        mode: 'backend',
        diagnostics: [error instanceof Error ? error.message : String(error)],
        elapsedMs: 0
      };
    }
  }

  async function runProgram() {
    if (!wasmBytes)
      return;

    runStatus = 'running';
    runResult = null;
    runError = '';

    try {
      runResult = await runWasiModule(wasmBytes);
      runStatus = runResult.exitCode === 0 ? 'done' : 'error';
    } catch (error) {
      runStatus = 'error';
      runError = error instanceof Error ? error.message : String(error);
    }
  }

  function base64ToBytes(text: string) {
    const raw = atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1)
      bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function revokeWasmUrl() {
    if (wasmUrl) {
      URL.revokeObjectURL(wasmUrl);
      wasmUrl = '';
    }
  }

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
  }
</script>

<svelte:head>
  <title>Kriol Playground</title>
  <meta
    name="description"
    content="Compile Kriol source to wasm32-wasi with the Kriol backend compiler."
  />
  <link rel="icon" href={logoUrl} />
</svelte:head>

<main class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="KriolLang">
      <img src={logoUrl} alt="" />
      <span>Kriol</span>
    </a>

    <nav class="nav-actions" aria-label="Project links">
      <a class="icon-link" href="https://github.com/kriol-lang" rel="noreferrer" target="_blank" aria-label="KriolLang GitHub">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 .5a12 12 0 0 0-3.8 23.39c.6.11.82-.26.82-.58v-2.02c-3.34.73-4.04-1.61-4.04-1.61-.55-1.38-1.34-1.75-1.34-1.75-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.08 1.83 2.82 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.34-5.47-5.94 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
        </svg>
        <span>GitHub</span>
      </a>

      <button class="icon-button" type="button" aria-label="Toggle theme" on:click={toggleTheme}>
        {#if theme === 'light'}
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.14-8.14 8.59 8.59 0 0 1 .25-2A1 1 0 0 0 8 2.36 10.14 10.14 0 1 0 21.86 14.05 1 1 0 0 0 21.64 13Z" /></svg>
        {:else}
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0 4a1 1 0 0 0 1-1v-1a1 1 0 1 0-2 0v1a1 1 0 0 0 1 1Zm0-18a1 1 0 0 0 1-1V2a1 1 0 1 0-2 0v1a1 1 0 0 0 1 1Zm10 8a1 1 0 0 0-1-1h-1a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1ZM4 12a1 1 0 0 0-1-1H2a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1Zm14.95 8.36a1 1 0 0 0 1.41-1.41l-.7-.71a1 1 0 0 0-1.42 1.42l.71.7ZM5.76 7.17a1 1 0 0 0 1.41-1.41l-.7-.71a1 1 0 0 0-1.42 1.42l.71.7Zm13.9 0 .7-.7a1 1 0 0 0-1.41-1.42l-.71.71a1 1 0 0 0 1.42 1.41ZM5.05 20.36a1 1 0 0 0 1.42 0l.7-.7a1 1 0 1 0-1.41-1.42l-.71.71a1 1 0 0 0 0 1.41Z" /></svg>
        {/if}
      </button>
    </nav>
  </header>

  <section class="workspace" aria-label="Kriol playground">
    <div class="editor-pane">
      <div class="bar">
        <div>
          <h1>Playground</h1>
        </div>

        <div class="actions">
          <button class="primary" type="button" disabled={isBusy} on:click={compile}>
            {isBusy ? 'Compiling' : 'Compile'}
          </button>
          <button class="secondary" type="button" disabled={!canRun} on:click={runProgram}>
            {runStatus === 'running' ? 'Running' : 'Run'}
          </button>
        </div>
      </div>

      <div class="editor-frame">
        <div class="pane-bar">
          <div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div>
          <strong>kodigu.kriol</strong>
        </div>
        <KriolEditor bind:value={source} />
      </div>
    </div>

    <aside class="side-pane">
      <div class="status-line" data-state={status}>
        <span>{status}</span>
        {#if result}
          <span>{result.elapsedMs} ms</span>
          {#if typeof result.queuePosition === 'number'}
            <span>queue {result.queuePosition}</span>
          {/if}
        {/if}
      </div>

      <div class="panel">
        {#if diagnostics.length > 0}
          <h2>Diagnostics</h2>
          <pre>{diagnostics.join('\n')}</pre>
        {:else if runError}
          <h2>Runtime Error</h2>
          <pre>{runError}</pre>
        {:else if runResult}
          <h2>Console</h2>
          <pre class="console">{runResult.stdout || '(no stdout)'}</pre>
          {#if runResult.stderr}
            <h2 class="stderr-heading">stderr</h2>
            <pre>{runResult.stderr}</pre>
          {/if}
          <p class="exit-code">exit {runResult.exitCode}</p>
        {:else if result?.ok}
          <h2>Output</h2>
          <p>wasm32-wasi module ready.</p>
        {:else}
          <h2>Backend</h2>
          <p>Ready.</p>
        {/if}
      </div>

      {#if canDownload}
        <a class="download" href={wasmUrl} download="program.wasm">Download wasm</a>
      {/if}
    </aside>
  </section>
</main>

<style>
  .shell {
    min-height: 100vh;
    padding: 18px;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    max-width: 1360px;
    min-height: 58px;
    margin: 0 auto 14px;
  }

  .brand,
  .nav-actions,
  .icon-link {
    display: inline-flex;
    align-items: center;
  }

  .brand {
    gap: 10px;
    color: var(--text);
    font-size: 24px;
    font-weight: 800;
    text-decoration: none;
  }

  .brand img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }

  .nav-actions {
    gap: 14px;
    color: var(--muted);
    font-weight: 700;
  }

  .icon-link {
    gap: 7px;
    min-height: 36px;
    text-decoration: none;
  }

  .icon-link:hover,
  .icon-button:hover {
    color: var(--text);
  }

  .icon-link svg,
  .icon-button svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 8px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 14px;
    max-width: 1360px;
    min-height: calc(100vh - 108px);
    margin: 0 auto;
  }

  .editor-pane,
  .side-pane,
  .editor-frame {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 8px;
  }

  .editor-pane {
    display: grid;
    grid-template-rows: auto minmax(420px, 1fr);
    gap: 12px;
    min-width: 0;
    padding: 12px;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 58px;
  }

  .eyebrow,
  h1,
  h2,
  p {
    margin: 0;
  }

  .eyebrow {
    margin-bottom: 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    font-size: 22px;
    font-weight: 800;
  }

  h2 {
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 13px;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .actions {
    display: inline-flex;
    gap: 10px;
  }

  .primary,
  .secondary,
  .download {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 8px;
    font-weight: 800;
    text-decoration: none;
  }

  .primary {
    border: 1px solid var(--brand-strong);
    background: var(--brand);
    color: #ffffff;
    cursor: pointer;
  }

  .primary:disabled {
    cursor: progress;
    opacity: 0.72;
  }

  .secondary,
  .download {
    border: 1px solid var(--line-strong);
    background: var(--surface-muted);
    color: var(--text);
    cursor: pointer;
  }

  .secondary:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .editor-frame {
    display: grid;
    grid-template-rows: auto minmax(420px, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .pane-bar {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    background: var(--surface-muted);
  }

  .pane-bar strong {
    color: var(--text);
    font-size: 14px;
  }

  .traffic {
    display: inline-flex;
    gap: 8px;
  }

  .traffic span {
    width: 12px;
    height: 12px;
    border-radius: 999px;
  }

  .traffic span:nth-child(1) {
    background: #df3333;
  }

  .traffic span:nth-child(2) {
    background: #f3c33c;
  }

  .traffic span:nth-child(3) {
    background: #19a85b;
  }

  :global(.editor-host),
  :global(.cm-editor) {
    height: 100%;
    min-height: 420px;
  }

  :global(.cm-editor) {
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    line-height: 1.55;
  }

  :global(.cm-scroller) {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  :global(.cm-gutters) {
    border-right: 1px solid var(--line);
    background: var(--surface-muted);
    color: var(--muted);
  }

  :global(.cm-activeLine),
  :global(.cm-activeLineGutter) {
    background: var(--surface-strong);
  }

  .side-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 12px;
  }

  .status-line {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 32px;
    margin-bottom: 12px;
    color: var(--muted);
    font-size: 13px;
  }

  .status-line span {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .status-line[data-state='done'] span:first-child {
    border-color: color-mix(in srgb, var(--success) 55%, var(--line));
    color: var(--success);
  }

  .status-line[data-state='error'] span:first-child {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--line));
    color: var(--danger);
  }

  .panel {
    flex: 1;
    min-height: 260px;
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .panel p,
  .exit-code {
    color: var(--muted);
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--danger);
    font-size: 13px;
    line-height: 1.5;
  }

  pre.console {
    color: var(--text);
  }

  .stderr-heading {
    margin-top: 16px;
  }

  .exit-code {
    margin-top: 14px;
    font-size: 13px;
  }

  .download {
    margin-top: 12px;
  }

  @media (max-width: 860px) {
    .shell {
      padding: 10px;
    }

    .topbar {
      margin-bottom: 10px;
    }

    .workspace {
      grid-template-columns: 1fr;
      min-height: auto;
    }

    .bar {
      align-items: stretch;
      flex-direction: column;
    }

    .actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .side-pane {
      min-height: 320px;
    }
  }
</style>
