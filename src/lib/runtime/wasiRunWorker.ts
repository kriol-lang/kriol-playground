import { runWasiModule } from './wasiRunner';

type RunMessage = {
  type: 'run';
  wasmBytes: Uint8Array;
  stdinControlBuffer: SharedArrayBuffer;
  stdinDataBuffer: SharedArrayBuffer;
  stdoutControlBuffer: SharedArrayBuffer;
  stdoutDataBuffer: SharedArrayBuffer;
  stderrControlBuffer: SharedArrayBuffer;
  stderrDataBuffer: SharedArrayBuffer;
};

const OUTPUT_READ_INDEX = 0;
const OUTPUT_WRITE_INDEX = 1;
const OUTPUT_DROPPED_BYTES = 2;

const encoder = new TextEncoder();

function appendOutput(control: Int32Array, data: Uint8Array, chunk: string) {
  const bytes = encoder.encode(chunk);
  let read = Atomics.load(control, OUTPUT_READ_INDEX);
  let write = Atomics.load(control, OUTPUT_WRITE_INDEX);

  for (const byte of bytes) {
    const nextWrite = (write + 1) % data.length;
    if (nextWrite === read) {
      read = (read + 1) % data.length;
      Atomics.store(control, OUTPUT_READ_INDEX, read);
      Atomics.add(control, OUTPUT_DROPPED_BYTES, 1);
    }

    data[write] = byte;
    write = nextWrite;
  }

  Atomics.store(control, OUTPUT_WRITE_INDEX, write);
}

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  if (event.data.type !== 'run')
    return;

  try {
    const stdoutControl = new Int32Array(event.data.stdoutControlBuffer);
    const stdoutData = new Uint8Array(event.data.stdoutDataBuffer);
    const stderrControl = new Int32Array(event.data.stderrControlBuffer);
    const stderrData = new Uint8Array(event.data.stderrDataBuffer);

    const result = await runWasiModule(event.data.wasmBytes, {
      stdin: {
        control: new Int32Array(event.data.stdinControlBuffer),
        data: new Uint8Array(event.data.stdinDataBuffer)
      },
      onStdinRequest: () => {
        self.postMessage({ type: 'stdin-request' });
      },
      onStdout: (chunk) => {
        appendOutput(stdoutControl, stdoutData, chunk);
      },
      onStderr: (chunk) => {
        appendOutput(stderrControl, stderrData, chunk);
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
