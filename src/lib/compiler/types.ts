export type CompilerMode = 'backend';

export type CompileStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface CompileRequest {
  source: string;
  target: 'wasm32-wasi';
}

export interface CompileResponse {
  ok: boolean;
  mode: CompilerMode;
  compilerVersion?: string;
  queuePosition?: number;
  wasmBase64?: string;
  diagnostics: string[];
  elapsedMs: number;
}

export interface CompilerInfoResponse {
  compilerVersion: string;
}

export interface CompilerProvider {
  readonly mode: CompilerMode;
  compile(request: CompileRequest): Promise<CompileResponse>;
}
