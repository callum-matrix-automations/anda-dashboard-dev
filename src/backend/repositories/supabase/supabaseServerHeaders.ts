export function supabaseServerHeaders(
  secretKey: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...headers,
    apikey: secretKey,
    ...(secretKey.startsWith("sb_secret_")
      ? {}
      : { authorization: `Bearer ${secretKey}` }),
  };
}
