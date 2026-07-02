<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import logoUrl from '../assets/kriol-lang-logo.svg';
  import KriolEditor from '$lib/components/KriolEditor.svelte';
  import { BackendCompiler } from '$lib/compiler/backendCompiler';
  import type { CompileResponse, CompileStatus } from '$lib/compiler/types';
  import type { WasiRunResult } from '$lib/runtime/wasiRunner';

  type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'stopped';
  type WorkerMessage =
    | { type: 'stdin-request' }
    | { type: 'done'; result: WasiRunResult }
    | { type: 'error'; error: string };

  const backendCompiler = new BackendCompiler();
  const STDIN_READY = 1;
  const STDIN_CLOSED = 2;
  const STDIN_REQUEST_COUNT = 2;
  const STDIN_CONTROL_SLOTS = 3;
  const STDIN_BUFFER_BYTES = 64 * 1024;
  const OUTPUT_BUFFER_BYTES = 64 * 1024;
  const OUTPUT_CONTROL_SLOTS = 3;
  const OUTPUT_READ_INDEX = 0;
  const OUTPUT_WRITE_INDEX = 1;
  const OUTPUT_DROPPED_BYTES = 2;

  let source = `fn ola(textu nomi, bool naKriolu) {
  si naKriolu {
    mostran(f"👋 Olá {nomi}, ami nta programa na Kriol!");
  } sinon {
    mostran(f"👋 Hello {nomi}, I program in Kriol!");
  }
}

fn inisiu() {
  // Toma nomi atravez di entrada
  textu nomi = toma('Nomi: ');

  // Executa funson \`ola\` passando parametros
  ola(nomi, sin);
  ola(nomi, nau);
}
`;
  let status: CompileStatus = 'idle';
  let result: CompileResponse | null = null;
  let wasmUrl = '';
  let wasmBytes: Uint8Array | null = null;
  let runStatus: RunStatus = 'idle';
  let runResult: WasiRunResult | null = null;
  let runError = '';
  let consoleStdout = '';
  let consoleStderr = '';
  let stdinValue = '';
  let stdinPlaceholder = 'Valor para stdin';
  let waitingForStdin = false;
  let stdinControl: Int32Array | null = null;
  let stdinData: Uint8Array | null = null;
  let stdinInput: HTMLInputElement | null = null;
  let stdinRequestCount = 0;
  let stdoutControl: Int32Array | null = null;
  let stdoutData: Uint8Array | null = null;
  let stderrControl: Int32Array | null = null;
  let stderrData: Uint8Array | null = null;
  let stdoutDecoder = new TextDecoder();
  let stderrDecoder = new TextDecoder();
  let outputPoll: ReturnType<typeof setInterval> | null = null;
  let runWorker: Worker | null = null;
  let infoDialog: HTMLDialogElement | null = null;
  let theme: 'light' | 'dark' = 'light';
  let compilerVersion = 'X.Y.Z';

  $: diagnostics = result?.diagnostics ?? [];
  $: isCompiling = status === 'queued' || status === 'running';
  $: canDownload = Boolean(result?.ok && wasmUrl);
  $: canRun = Boolean(result?.ok && wasmBytes && runStatus !== 'running');
  $: consoleTitle = diagnostics.length > 0
    ? 'Diagnósticos'
    : runError
      ? 'Erro de execução'
      : 'Consola';
  $: consoleOutput = consoleStdout || '(sem saída padrão)';
  $: statusLabel = translateStatus(status);
  $: if (typeof document !== 'undefined')
    document.documentElement.dataset.theme = theme;

  async function compile() {
    status = 'queued';
    result = null;
    wasmBytes = null;
    runStatus = 'idle';
    runResult = null;
    runError = '';
    consoleStdout = '';
    consoleStderr = '';
    revokeWasmUrl();

    if (!hasEntryPoint(source)) {
      status = 'error';
      result = {
        ok: false,
        mode: 'backend',
        diagnostics: ["Falta a função de entrada: defina `fn inisiu()` antes de compilar."],
        elapsedMs: 0
      };
      return;
    }

    try {
      const response = await backendCompiler.compile({
        source,
        target: 'wasm32-wasi'
      });
      result = response;
      if (response.compilerVersion)
        compilerVersion = response.compilerVersion;
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

    stopRun(false);
    runStatus = 'running';
    runResult = null;
    runError = '';
    consoleStdout = '';
    consoleStderr = '';
    stdinValue = '';
    stdinPlaceholder = 'Valor para stdin';
    waitingForStdin = false;
    stdinRequestCount = 0;

    if (typeof SharedArrayBuffer !== 'function' || !globalThis.crossOriginIsolated) {
      runStatus = 'error';
      runError = 'Interactive stdin requires SharedArrayBuffer. Reload after the playground is served with cross-origin isolation headers.';
      return;
    }

    const stdinControlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * STDIN_CONTROL_SLOTS);
    const stdinDataBuffer = new SharedArrayBuffer(STDIN_BUFFER_BYTES);
    const stdoutControlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * OUTPUT_CONTROL_SLOTS);
    const stdoutDataBuffer = new SharedArrayBuffer(OUTPUT_BUFFER_BYTES);
    const stderrControlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * OUTPUT_CONTROL_SLOTS);
    const stderrDataBuffer = new SharedArrayBuffer(OUTPUT_BUFFER_BYTES);
    stdinControl = new Int32Array(stdinControlBuffer);
    stdinData = new Uint8Array(stdinDataBuffer);
    stdoutControl = new Int32Array(stdoutControlBuffer);
    stdoutData = new Uint8Array(stdoutDataBuffer);
    stderrControl = new Int32Array(stderrControlBuffer);
    stderrData = new Uint8Array(stderrDataBuffer);
    stdoutDecoder = new TextDecoder();
    stderrDecoder = new TextDecoder();
    startRuntimePolling();

    const worker = new Worker(new URL('../lib/runtime/wasiRunWorker.ts', import.meta.url), {
      type: 'module'
    });
    runWorker = worker;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (worker !== runWorker)
        return;

      if (event.data.type === 'stdin-request') {
        activateStdinPrompt();
        return;
      }

      drainRuntimeOutput(true);
      runWorker = null;
      worker.terminate();
      resetRuntimeChannels();

      if (event.data.type === 'done') {
        runResult = event.data.result;
        runStatus = event.data.result.exitCode === 0 ? 'done' : 'error';
        return;
      }

      runStatus = 'error';
      runError = event.data.error;
    };

    worker.onerror = (event) => {
      if (worker !== runWorker)
        return;

      drainRuntimeOutput(true);
      runWorker = null;
      worker.terminate();
      resetRuntimeChannels();
      runStatus = 'error';
      runError = event.message;
    };

    worker.postMessage({
      type: 'run',
      wasmBytes,
      stdinControlBuffer,
      stdinDataBuffer,
      stdoutControlBuffer,
      stdoutDataBuffer,
      stderrControlBuffer,
      stderrDataBuffer
    });
  }

  function stopRun(markStopped = true) {
    if (!runWorker)
      return;

    closeStdin();
    drainRuntimeOutput(true);
    runWorker.terminate();
    runWorker = null;
    resetRuntimeChannels();
    if (markStopped)
      runStatus = 'stopped';
  }

  function closeStdin() {
    if (!stdinControl)
      return;

    Atomics.store(stdinControl, 0, STDIN_CLOSED);
    Atomics.notify(stdinControl, 0);
  }

  function sendStdin() {
    if (!waitingForStdin || !stdinControl || !stdinData)
      return;

    const submitted = stdinValue;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(`${submitted}\n`);
    if (encoded.length > stdinData.length) {
      runStatus = 'error';
      runError = `Entrada demasiado grande: limite de ${stdinData.length} bytes por linha.`;
      closeStdin();
      runWorker?.terminate();
      runWorker = null;
      resetRuntimeChannels();
      return;
    }

    drainRuntimeOutput();
    echoStdin(submitted);
    stdinData.fill(0);
    stdinData.set(encoded);
    Atomics.store(stdinControl, 1, encoded.length);
    Atomics.store(stdinControl, 0, STDIN_READY);
    Atomics.notify(stdinControl, 0);

    stdinValue = '';
    stdinPlaceholder = 'Valor para stdin';
    waitingForStdin = false;
  }

  function echoStdin(value: string) {
    consoleStdout += `${value}\n`;
  }

  function startRuntimePolling() {
    stopRuntimePolling();
    outputPoll = setInterval(() => {
      drainRuntimeOutput();
      syncStdinPrompt();
    }, 33);
  }

  function stopRuntimePolling() {
    if (!outputPoll)
      return;

    clearInterval(outputPoll);
    outputPoll = null;
  }

  function drainRuntimeOutput(flush = false) {
    if (stdoutControl && stdoutData)
      consoleStdout += drainOutput(stdoutControl, stdoutData, stdoutDecoder);
    if (stderrControl && stderrData)
      consoleStderr += drainOutput(stderrControl, stderrData, stderrDecoder);

    if (flush) {
      consoleStdout += stdoutDecoder.decode();
      consoleStderr += stderrDecoder.decode();
    }
  }

  function drainOutput(control: Int32Array, data: Uint8Array, decoder: TextDecoder) {
    const read = Atomics.load(control, OUTPUT_READ_INDEX);
    const write = Atomics.load(control, OUTPUT_WRITE_INDEX);
    const dropped = Atomics.exchange(control, OUTPUT_DROPPED_BYTES, 0);
    if (read === write)
      return dropped > 0 ? `\n[${dropped} bytes de saída truncados]\n` : '';

    let output = '';
    if (read < write) {
      output = decoder.decode(copySharedBytes(data, read, write), { stream: true });
    } else {
      output = decoder.decode(copySharedBytes(data, read, data.length), { stream: true });
      output += decoder.decode(copySharedBytes(data, 0, write), { stream: true });
    }

    Atomics.store(control, OUTPUT_READ_INDEX, write);

    if (dropped > 0)
      output += `\n[${dropped} bytes de saída truncados]\n`;

    return output;
  }

  function copySharedBytes(data: Uint8Array, start: number, end: number) {
    const copy = new Uint8Array(end - start);
    copy.set(data.subarray(start, end));
    return copy;
  }

  function syncStdinPrompt() {
    if (!stdinControl)
      return;

    const nextRequestCount = Atomics.load(stdinControl, STDIN_REQUEST_COUNT);
    if (nextRequestCount === stdinRequestCount)
      return;

    stdinRequestCount = nextRequestCount;
    activateStdinPrompt();
  }

  function activateStdinPrompt() {
    if (waitingForStdin)
      return;

    drainRuntimeOutput();
    stdinPlaceholder = stdinPlaceholderFromStdout();
    waitingForStdin = true;
    tick().then(() => stdinInput?.focus());
  }

  function stdinPlaceholderFromStdout() {
    const lines = consoleStdout.split(/\r?\n/);
    const lastLine = lines[lines.length - 1]?.trim();
    return lastLine || 'Valor para stdin';
  }

  function resetRuntimeChannels() {
    stopRuntimePolling();
    waitingForStdin = false;
    stdinRequestCount = 0;
    stdinControl = null;
    stdinData = null;
    stdoutControl = null;
    stdoutData = null;
    stderrControl = null;
    stderrData = null;
  }

  function clearConsole() {
    stopRun(false);
    result = null;
    wasmBytes = null;
    runStatus = 'idle';
    runResult = null;
    runError = '';
    consoleStdout = '';
    consoleStderr = '';
    stdinValue = '';
    stdinPlaceholder = 'Valor para stdin';
    resetRuntimeChannels();
    status = 'idle';
    revokeWasmUrl();
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

  function translateStatus(value: CompileStatus) {
    switch (value) {
      case 'idle':
        return 'preparado';
      case 'queued':
        return 'em fila';
      case 'running':
        return 'a compilar';
      case 'done':
        return 'concluído';
      case 'error':
        return 'erro';
    }
  }

  function hasEntryPoint(code: string) {
    const withoutStrings = code.replace(/"(?:\\.|[^"\\])*"/g, '""');
    const withoutComments = withoutStrings
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return /\bfn\s+inisiu\s*\(/.test(withoutComments);
  }

  function openInfoDialog() {
    if (infoDialog && !infoDialog.open)
      infoDialog.showModal();
  }

  function closeInfoDialog() {
    infoDialog?.close();
  }

  onDestroy(() => {
    stopRun(false);
    resetRuntimeChannels();
    revokeWasmUrl();
  });

  onMount(() => {
    backendCompiler.info()
      .then((info) => {
        compilerVersion = info.compilerVersion;
      })
      .catch(() => {
        compilerVersion = 'Kriol';
      });
  });
</script>

<svelte:head>
  <title>Kriol Playground</title>
  <meta
    name="description"
    content="Compile o código-fonte Kriol para wasm32-wasi com o compilador backend Kriol e execute no navegador."
  />
  <link rel="icon" href={logoUrl} />
</svelte:head>

<main class="shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="KriolLang">
      <img src={logoUrl} alt="" />
      <span>Kriol</span>
    </a>
    <span class="version-badge">{compilerVersion}</span>

    <nav class="nav-actions" aria-label="Project links">
      <a class="icon-link" href="https://docs.kriol.dev" rel="noreferrer" target="_blank" aria-label="KriolLang Documentation">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M21.17 2.06A13.1 13.1 0 0 0 19 1.87a12.94 12.94 0 0 0-7 2.05 12.94 12.94 0 0 0-7-2 13.1 13.1 0 0 0-2.17.19 1 1 0 0 0-.83 1v12a1 1 0 0 0 1.17 1 10.9 10.9 0 0 1 8.25 1.91l.12.07h.11a.91.91 0 0 0 .7 0h.11l.12-.07A10.9 10.9 0 0 1 20.83 16 1 1 0 0 0 22 15V3a1 1 0 0 0-.83-.94ZM11 15.35a12.87 12.87 0 0 0-6-1.48H4v-10c.33-.02.67-.02 1 0a10.86 10.86 0 0 1 6 1.8v9.68Zm9-1.44h-1a12.87 12.87 0 0 0-6 1.48V5.67a10.86 10.86 0 0 1 6-1.8c.33-.02.67-.02 1 0v10.04Zm1.17 4.15a13.1 13.1 0 0 0-2.17-.19 12.94 12.94 0 0 0-7 2.05 12.94 12.94 0 0 0-7-2.05c-.73 0-1.45.07-2.17.19A1 1 0 1 0 3.17 20a10.9 10.9 0 0 1 8.25 1.91 1 1 0 0 0 1.16 0A10.9 10.9 0 0 1 20.83 20a1 1 0 1 0 .34-1.94Z" />
        </svg>
        <span>Docs</span>
      </a>

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
        <div class="title-row">
          <h1>Playground</h1>
          <button class="info-button" type="button" aria-label="How the playground works" title="How the playground works" on:click={openInfoDialog}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16.001A8 8 0 0 1 12 20Zm0-9a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0v-4a1 1 0 0 0-1-1Zm.38-3.92a1 1 0 0 0-.76 0 1 1 0 0 0-.33.21 1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0A1 1 0 0 0 13 8a1 1 0 0 0-.62-.92Z" /></svg>
          </button>
        </div>

        <div class="actions">
          <button class="primary" type="button" disabled={isCompiling || runStatus === 'running'} on:click={compile}>
            {isCompiling ? 'A compilar...' : 'Compilar'}
          </button>
          <button class="secondary" type="button" disabled={!canRun} on:click={runProgram}>
            {runStatus === 'running' ? 'A executar...' : 'Executar'}
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
        <span>{statusLabel}</span>
        {#if result}
          <span>{result.elapsedMs} ms</span>
          {#if typeof result.queuePosition === 'number'}
            <span>fila {result.queuePosition}</span>
          {/if}
        {/if}
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>{consoleTitle}</h2>
          <div class="panel-actions">
            {#if runStatus === 'running'}
              <button class="tool-button danger" type="button" aria-label="Parar execução" title="Parar execução" on:click={() => stopRun()}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>
              </button>
            {/if}
            <button class="tool-button" type="button" aria-label="Limpar consola" title="Limpar consola" on:click={clearConsole}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9Zm1 2h4v1h-4V5Zm7 2v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7h10Zm-7 3a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-5a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-5a1 1 0 0 0-1-1Z" /></svg>
            </button>
          </div>
        </div>

        {#if waitingForStdin}
          <form class:stdin-active={waitingForStdin} class="stdin-panel" on:submit|preventDefault={sendStdin}>
            <label for="stdin">Entrada padrão</label>
            <div class="stdin-row">
              <input id="stdin" bind:this={stdinInput} bind:value={stdinValue} placeholder={stdinPlaceholder} spellcheck="false" disabled={!waitingForStdin} autocomplete="off" />
              <button class="secondary stdin-send" type="submit" disabled={!waitingForStdin}>Enviar</button>
            </div>
          </form>
        {/if}

        {#if diagnostics.length > 0}
          <pre>{diagnostics.join('\n')}</pre>
        {:else}
          <div class="console-wrap">
            <pre class="console">{consoleOutput}</pre>
            {#if waitingForStdin}
              <span class="stdin-waiting">waiting stdin...</span>
            {/if}
          </div>
          {#if consoleStderr}
            <h2 class="stderr-heading">Erro padrão</h2>
            <pre>{consoleStderr}</pre>
          {/if}
          {#if runError}
            <h2 class="stderr-heading">Erro</h2>
            <pre>{runError}</pre>
          {:else if runResult}
            <p class="exit-code">Código de saída {runResult.exitCode}</p>
          {:else if runStatus === 'stopped'}
            <p class="exit-code">Execução parada.</p>
          {:else if result?.ok}
            <p class="exit-code">Artefacto compilado para wasm32-wasi e pronto a executar.</p>
          {:else}
            <p class="exit-code">Preparado.</p>
          {/if}
        {/if}
      </div>

      {#if canDownload}
        <a class="download" href={wasmUrl} download="program.wasm">Download wasm</a>
      {/if}
    </aside>
  </section>

  <dialog class="info-dialog" bind:this={infoDialog} aria-labelledby="playground-info-title" on:click={(event) => event.target === infoDialog && closeInfoDialog()}>
    <div class="dialog-header">
      <h2 id="playground-info-title">Como/aonde isto executa?</h2>
      <button class="tool-button" type="button" aria-label="Close" title="Close" on:click={closeInfoDialog}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m13.41 12 6.3-6.29a1 1 0 1 0-1.42-1.42L12 10.59l-6.29-6.3a1 1 0 1 0-1.42 1.42l6.3 6.29-6.3 6.29a1 1 0 0 0 1.42 1.42l6.29-6.3 6.29 6.3a1 1 0 0 0 1.42-1.42L13.41 12Z" /></svg>
      </button>
    </div>
    <ol>
      <li>O código-fonte é enviado para o backend do playground.</li>
      <li>O backend compila-o num módulo wasm32-wasi com o compilador Kriol.</li>
      <li>O navegador executa esse módulo WASM localmente com o ambiente de execução WASI do playground.</li>
    </ol>
    <p>Então, embora a compilação ocorra no backend, a execução em tempo de execução ocorre, no entanto, no seu navegador. Isto é possível graças ao suporte ao target de compilação WebAssembly (wasm) por parte do compilador.</p>
    <p>Por causa da execução ocorrer no contexto do navegador, algumas capacidades do ambiente nativo, como acesso direto ao sistema de ficheiros ou a processos externos, podem estar limitadas.</p>
  </dialog>
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
  .version-badge,
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

  .version-badge {
    min-height: 28px;
    margin-right: auto;
    padding: 0 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
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

  .info-button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 8px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .info-button:hover {
    color: var(--text);
    background: var(--surface-muted);
  }

  .info-button svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 14px;
    max-width: 1360px;
    height: calc(100vh - 108px);
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
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 12px;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 58px;
  }

  .title-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
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

  .secondary:not(:disabled) {
    border-color: color-mix(in srgb, var(--success) 62%, var(--line));
    background: color-mix(in srgb, var(--success) 14%, var(--surface));
    color: var(--success);
  }

  .secondary:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--success) 78%, var(--line));
    background: color-mix(in srgb, var(--success) 20%, var(--surface));
  }

  .editor-frame {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
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
    min-height: 0;
  }

  :global(.cm-editor) {
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    line-height: 1.55;
  }

  :global(.cm-scroller) {
    overflow: auto !important;
    height: 100%;
    -webkit-overflow-scrolling: touch;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    touch-action: pan-x pan-y;
  }

  :global(.cm-content) {
    width: max-content;
    min-width: 100%;
    white-space: pre;
  }

  :global(.cm-line) {
    white-space: pre;
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
    min-height: 0;
    min-width: 0;
    overflow: hidden;
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
    min-height: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .panel-header {
    position: sticky;
    top: -12px;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    margin-bottom: 10px;
    padding-top: 12px;
    padding-bottom: 8px;
    background: var(--surface-muted);
  }

  .panel-header h2 {
    margin: 0;
  }

  .panel-actions {
    display: inline-flex;
    gap: 6px;
  }

  .stdin-panel {
    display: grid;
    gap: 8px;
    margin-bottom: 12px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }

  .stdin-panel.stdin-active {
    border-color: color-mix(in srgb, var(--success) 70%, var(--line));
  }

  .stdin-panel label {
    color: var(--muted);
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .stdin-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .stdin-row input {
    min-width: 0;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface-muted);
    font: 13px/1.5 "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  .stdin-row input:focus {
    outline: 2px solid color-mix(in srgb, var(--success) 34%, transparent);
    outline-offset: 1px;
  }

  .stdin-send {
    min-width: 78px;
  }

  .tool-button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--muted);
    background: var(--surface);
    cursor: pointer;
  }

  .tool-button:hover {
    color: var(--text);
    border-color: var(--line-strong);
  }

  .tool-button.danger:hover {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 55%, var(--line));
  }

  .tool-button svg {
    width: 17px;
    height: 17px;
    fill: currentColor;
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

  .console-wrap {
    min-height: 0;
  }

  .stdin-waiting {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    margin-top: 8px;
    padding: 0 8px;
    border: 1px solid color-mix(in srgb, var(--success) 54%, var(--line));
    border-radius: 999px;
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, var(--surface));
    font-size: 12px;
    font-weight: 800;
  }

  .stderr-heading {
    margin-top: 16px;
  }

  .exit-code {
    margin-top: 14px;
    font-size: 13px;
  }

  .download {
    flex: 0 0 auto;
    margin-top: 12px;
  }

  .info-dialog {
    width: min(520px, calc(100vw - 32px));
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .info-dialog::backdrop {
    background: rgba(8, 22, 44, 0.45);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .dialog-header h2 {
    margin: 0;
    color: var(--text);
    font-size: 16px;
    text-transform: none;
  }

  .info-dialog ol {
    display: grid;
    gap: 8px;
    margin: 0 0 14px;
    padding-left: 22px;
    color: var(--text);
  }

  .info-dialog p {
    color: var(--muted);
    line-height: 1.55;
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
      height: auto;
      min-height: auto;
    }

    .editor-pane {
      max-height: 70vh;
    }

    .editor-frame {
      min-height: 0;
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
      overflow: visible;
    }

    .panel {
      max-height: 52vh;
    }

    .panel-actions {
      gap: 8px;
    }

    .tool-button {
      width: 44px;
      height: 44px;
    }

    .tool-button svg {
      width: 20px;
      height: 20px;
    }
  }
</style>
