import { runWasiModule } from './wasiRunner';

type RunMessage = {
  type: 'run';
  wasmBytes: Uint8Array;
};

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  if (event.data.type !== 'run')
    return;

  try {
    const result = await runWasiModule(event.data.wasmBytes, {
      onStdout: (chunk) => {
        self.postMessage({ type: 'stdout', chunk });
      },
      onStderr: (chunk) => {
        self.postMessage({ type: 'stderr', chunk });
      }
    });

    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
