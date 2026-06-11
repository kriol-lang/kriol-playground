export interface WasiRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WasiRunOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

class WasiExit extends Error {
  constructor(readonly code: number) {
    super(`WASI program exited with code ${code}`);
  }
}

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_NOENT = 44;
const ERRNO_NOSYS = 52;
const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;
const FILETYPE_CHARACTER_DEVICE = 2;
const RIGHTS_FD_READ = 1n << 1n;
const RIGHTS_FD_WRITE = 1n << 6n;
const RIGHTS_FD_SEEK = 1n << 2n;
const RIGHTS_FD_TELL = 1n << 5n;
const RIGHTS_FD_FDSTAT_SET_FLAGS = 1n << 3n;

export async function runWasiModule(
  wasmBytes: Uint8Array,
  options: WasiRunOptions = {}
): Promise<WasiRunResult> {
  let instance: WebAssembly.Instance | null = null;
  let stdout = '';
  let stderr = '';
  let lastWasiCall = '(none)';
  let importsSummary = '(not compiled)';
  const decoder = new TextDecoder();

  function memory() {
    const exportedMemory = instance?.exports.memory;
    if (!(exportedMemory instanceof WebAssembly.Memory))
      throw new Error('WASI module did not export memory.');
    return exportedMemory;
  }

  function view() {
    return new DataView(memory().buffer);
  }

  function bytes() {
    return new Uint8Array(memory().buffer);
  }

  function fdWrite(fd: number, iovs: number, iovsLen: number, nwritten: number) {
    if (fd !== 1 && fd !== 2)
      return ERRNO_BADF;

    const dataView = view();
    const data = bytes();
    let written = 0;
    let output = '';

    for (let i = 0; i < iovsLen; i += 1) {
      const iov = iovs + i * 8;
      const ptr = dataView.getUint32(iov, true);
      const len = dataView.getUint32(iov + 4, true);
      output += decoder.decode(data.subarray(ptr, ptr + len));
      written += len;
    }

    dataView.setUint32(nwritten, written, true);
    if (fd === 1) {
      stdout += output;
      options.onStdout?.(output);
    } else {
      stderr += output;
      options.onStderr?.(output);
    }
    return ERRNO_SUCCESS;
  }

  function writeU64(ptr: number, value: bigint) {
    view().setBigUint64(ptr, value, true);
  }

  function clockTimeGet(clockId: number, _precision: bigint, timePtr: number) {
    if (clockId !== CLOCK_REALTIME && clockId !== CLOCK_MONOTONIC)
      return ERRNO_INVAL;
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    writeU64(timePtr, nowNs);
    return ERRNO_SUCCESS;
  }

  function writeFdStat(fd: number, statPtr: number) {
    const data = bytes();
    const dataView = view();
    data.fill(0, statPtr, statPtr + 24);
    dataView.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
    dataView.setUint16(statPtr + 2, 0, true);

    const rights = fd === 0
      ? RIGHTS_FD_READ
      : RIGHTS_FD_WRITE | RIGHTS_FD_SEEK | RIGHTS_FD_TELL | RIGHTS_FD_FDSTAT_SET_FLAGS;
    dataView.setBigUint64(statPtr + 8, rights, true);
    dataView.setBigUint64(statPtr + 16, rights, true);
  }

  function withTrace<T extends (...args: any[]) => unknown>(
    name: string,
    fn: T
  ): T {
    return ((...args: Parameters<T>) => {
      lastWasiCall = `${name}(${args.map(String).join(', ')})`;
      return fn(...args);
    }) as T;
  }

  const wasi = {
    args_sizes_get: (argcPtr: number, argvBufSizePtr: number) => {
      const args = ["program.wasm"]; // Add actual CLI args here later if needed
      const dataView = view();
      dataView.setUint32(argcPtr, args.length, true);
      const totalByteLength = args.reduce((sum, arg) => sum + new TextEncoder().encode(arg).length + 1, 0);
      dataView.setUint32(argvBufSizePtr, totalByteLength, true);

      return ERRNO_SUCCESS;
    },
    args_get: (argvPtr: number, argvBufPtr: number) => {
      const args = ["program.wasm"];
      const dataView = view();
      const data = bytes();

      let currentArgvPtr = argvPtr;
      let currentBufPtr = argvBufPtr;

      for (const arg of args) {
        // Point the current argv index to the current string buffer position
        dataView.setUint32(currentArgvPtr, currentBufPtr, true);
        currentArgvPtr += 4; // WASM32 pointers are 4 bytes
        // Write the string + null terminator
        const encoded = new TextEncoder().encode(arg + "\0");
        data.set(encoded, currentBufPtr);
        currentBufPtr += encoded.length;
      }
      return ERRNO_SUCCESS;
    },
    clock_time_get: clockTimeGet,
    clock_res_get: (_clockId: number, resolutionPtr: number) => {
      writeU64(resolutionPtr, 1_000_000n);
      return ERRNO_SUCCESS;
    },
    environ_get: () => ERRNO_SUCCESS,
    environ_sizes_get: (countPtr: number, sizePtr: number) => {
      const dataView = view();
      dataView.setUint32(countPtr, 0, true);
      dataView.setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    fd_close: (fd: number) => (fd >= 0 && fd <= 2 ? ERRNO_SUCCESS : ERRNO_BADF),
    fd_datasync: () => ERRNO_SUCCESS,
    fd_fdstat_get: (fd: number, statPtr: number) => {
      if (fd < 0 || fd > 2)
        return ERRNO_BADF;
      writeFdStat(fd, statPtr);
      return ERRNO_SUCCESS;
    },
    fd_fdstat_set_flags: () => ERRNO_SUCCESS,
    fd_filestat_get: (_fd: number, statPtr: number) => {
      bytes().fill(0, statPtr, statPtr + 64);
      return ERRNO_SUCCESS;
    },
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_read: (_fd: number, _iovs: number, _iovsLen: number, nread: number) => {
      view().setUint32(nread, 0, true);
      return ERRNO_SUCCESS;
    },
    fd_seek: (_fd: number, _offset: bigint, _whence: number, newOffsetPtr: number) => {
      writeU64(newOffsetPtr, 0n);
      return ERRNO_SUCCESS;
    },
    fd_sync: () => ERRNO_SUCCESS,
    fd_tell: (_fd: number, offsetPtr: number) => {
      writeU64(offsetPtr, 0n);
      return ERRNO_SUCCESS;
    },
    fd_write: fdWrite,
    path_create_directory: () => ERRNO_NOENT,
    path_filestat_get: () => ERRNO_NOENT,
    path_open: () => ERRNO_NOENT,
    path_readlink: () => ERRNO_NOENT,
    path_remove_directory: () => ERRNO_NOENT,
    path_rename: () => ERRNO_NOENT,
    path_symlink: () => ERRNO_NOENT,
    path_unlink_file: () => ERRNO_NOENT,
    poll_oneoff: () => ERRNO_NOSYS,
    proc_exit: (code: number) => {
      throw new WasiExit(code);
    },
    proc_raise: () => ERRNO_INVAL,
    random_get: (ptr: number, len: number) => {
      const data = bytes();
      for (let offset = 0; offset < len; offset += 65536) {
        crypto.getRandomValues(data.subarray(ptr + offset, ptr + Math.min(offset + 65536, len)));
      }
      return ERRNO_SUCCESS;
    },
    sched_yield: () => ERRNO_SUCCESS
  };

  const tracedWasi = Object.fromEntries(
    Object.entries(wasi).map(([name, fn]) => [name, withTrace(name, fn)])
  );

  try {
    const compiled = await WebAssembly.compile(wasmBytes);
    importsSummary = WebAssembly.Module.imports(compiled)
      .map((entry) => `${entry.module}.${entry.name}:${entry.kind}`)
      .join('\n') || '(none)';

    instance = await WebAssembly.instantiate(compiled, {
      wasi_snapshot_preview1: tracedWasi
    });

    const start = instance.exports._start;
    if (typeof start !== 'function')
      throw new Error('WASI module does not export _start.');

    start();
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (error instanceof WasiExit)
      return { stdout, stderr, exitCode: error.code };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        message,
        '',
        `Last WASI call: ${lastWasiCall}`,
        '',
        'Wasm imports:',
        importsSummary,
        '',
        stdout ? `stdout before trap:\n${stdout}` : 'stdout before trap: (empty)',
        stderr ? `stderr before trap:\n${stderr}` : 'stderr before trap: (empty)'
      ].join('\n')
    );
  }
}
