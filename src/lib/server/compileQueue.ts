import { chmod, chown, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { CompileResponse } from '$lib/compiler/types';

const DEFAULT_KRIOL_BIN = resolve(process.cwd(), '../kriol/build/kriol');
const KRIOL_BIN = process.env.KRIOL_BIN ?? DEFAULT_KRIOL_BIN;
const COMPILE_TIMEOUT_MS = Number(process.env.KRIOL_COMPILE_TIMEOUT_MS ?? 10000);
const MAX_QUEUE_SIZE = Number(process.env.KRIOL_COMPILE_QUEUE_SIZE ?? 8);
const OUTPUT_LIMIT_BYTES = Number(process.env.KRIOL_COMPILE_OUTPUT_LIMIT_BYTES ?? 64 * 1024);
const SANDBOX_UID = Number(process.env.KRIOL_SANDBOX_UID ?? 65532);
const SANDBOX_GID = Number(process.env.KRIOL_SANDBOX_GID ?? 65532);

interface Job {
  source: string;
  enqueuedAt: number;
  resolve: (response: CompileResponse) => void;
  reject: (error: Error) => void;
}

const queue: Job[] = [];
let active = false;

export function getQueueDepth() {
  return queue.length + (active ? 1 : 0);
}

export function enqueueCompile(source: string): Promise<CompileResponse> {
  if (queue.length >= MAX_QUEUE_SIZE) {
    return Promise.resolve({
      ok: false,
      mode: 'backend',
      diagnostics: ['The compile queue is full. Please try again in a moment.'],
      elapsedMs: 0
    });
  }

  return new Promise((resolveJob, rejectJob) => {
    const queuePosition = getQueueDepth();
    queue.push({
      source,
      enqueuedAt: Date.now(),
      resolve: (response) => {
        response.queuePosition = queuePosition;
        resolveJob(response);
      },
      reject: rejectJob
    });
    void drainQueue();
  });
}

async function drainQueue() {
  if (active)
    return;

  const job = queue.shift();
  if (!job)
    return;

  active = true;
  try {
    job.resolve(await compileWithNativeKriol(job.source, Date.now() - job.enqueuedAt));
  } catch (error) {
    job.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    active = false;
    void drainQueue();
  }
}

async function compileWithNativeKriol(source: string, queuedMs: number): Promise<CompileResponse> {
  const startedAt = Date.now();
  const workdir = await mkdtemp(join(tmpdir(), 'kriol-playground-'));
  const sourcePath = join(workdir, 'input.kr');
  const wasmPath = join(workdir, 'output.wasm');

  try {
    await chmod(workdir, 0o700);
    await writeFile(sourcePath, source, 'utf8');
    await prepareSandboxOwnership(workdir, sourcePath);
    const run = await runKriol([
      sourcePath,
      '--target',
      'wasm32-wasi',
      '-o',
      wasmPath,
      '--ignore-extension'
    ]);

    if (run.code !== 0) {
      return {
        ok: false,
        mode: 'backend',
        diagnostics: splitDiagnostics(formatFailure(run)),
        elapsedMs: Date.now() - startedAt
      };
    }

    const wasm = await readFile(wasmPath);
    return {
      ok: true,
      mode: 'backend',
      queuePosition: queuedMs > 0 ? 0 : undefined,
      wasmBase64: wasm.toString('base64'),
      diagnostics: [],
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function runKriol(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const privilegeDrop = process.getuid?.() === 0
      ? { uid: SANDBOX_UID, gid: SANDBOX_GID }
      : {};
    const child = spawn(KRIOL_BIN, args, {
      cwd: tmpdir(),
      detached: process.platform !== 'win32',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: tmpdir(),
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? '',
        TMPDIR: tmpdir()
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...privilegeDrop
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled)
        return;
      killProcessTree(child.pid);
    }, COMPILE_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on('error', (error) => {
      settled = true;
      clearTimeout(timeout);
      resolveRun({
        code: 1,
        stdout,
        stderr: `Could not start kriol compiler at ${KRIOL_BIN}: ${error.message}`
      });
    });
    child.on('close', (code) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function prepareSandboxOwnership(workdir: string, sourcePath: string) {
  if (process.getuid?.() !== 0)
    return;

  await chown(workdir, SANDBOX_UID, SANDBOX_GID);
  await chown(sourcePath, SANDBOX_UID, SANDBOX_GID);
}

function killProcessTree(pid: number | undefined) {
  if (!pid)
    return;

  try {
    if (process.platform === 'win32')
      process.kill(pid, 'SIGKILL');
    else
      process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process may already have exited between timeout and kill.
    }
  }
}

function appendLimited(current: string, chunk: string) {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= OUTPUT_LIMIT_BYTES)
    return next;
  return next.slice(0, OUTPUT_LIMIT_BYTES) + '\n[compiler output truncated]';
}

function formatFailure(run: { code: number | null; stdout: string; stderr: string }) {
  if (run.code === null)
    return `Compilation timed out after ${COMPILE_TIMEOUT_MS} ms.`;
  return run.stderr || run.stdout || 'Compilation failed.';
}

function splitDiagnostics(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
