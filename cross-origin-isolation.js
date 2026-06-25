const DEFAULT_COOP = 'same-origin';
const DEFAULT_COEP = 'require-corp';
const DEFAULT_CORP = '';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function crossOriginIsolationHeaders(env = {}) {
  const coop = env.KRIOL_CROSS_ORIGIN_OPENER_POLICY ?? DEFAULT_COOP;
  const coep = env.KRIOL_CROSS_ORIGIN_EMBEDDER_POLICY ?? DEFAULT_COEP;
  const corp = env.KRIOL_CROSS_ORIGIN_RESOURCE_POLICY ?? DEFAULT_CORP;

  return {
    ...(coop ? { 'Cross-Origin-Opener-Policy': coop } : {}),
    ...(coep ? { 'Cross-Origin-Embedder-Policy': coep } : {}),
    ...(corp ? { 'Cross-Origin-Resource-Policy': corp } : {})
  };
}
