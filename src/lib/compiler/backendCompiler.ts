import type { CompileRequest, CompileResponse, CompilerInfoResponse, CompilerProvider } from './types';

export class BackendCompiler implements CompilerProvider {
  readonly mode = 'backend' as const;

  async compile(request: CompileRequest): Promise<CompileResponse> {
    const response = await fetch('/api/compile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    const payload = (await response.json()) as CompileResponse;
    if (!response.ok && payload.diagnostics.length === 0) {
      payload.diagnostics = [`Compile request failed with HTTP: ${response.status}`];
    }
    return payload;
  }

  async info(): Promise<CompilerInfoResponse> {
    const response = await fetch('/api/compile');
    if (!response.ok)
      throw new Error(`Compiler info request failed with HTTP: ${response.status}`);
    return (await response.json()) as CompilerInfoResponse;
  }
}
