// Prefixes are safe-ish: normal encoding is fine
export function encPrefixSegment(x: string): string {
  return encodeURIComponent(x);
}

// URI-ish segments can contain "/" which servers will decode and treat as path separators.
// Double-encode "%" so "%2F" survives a single decode as the literal characters "%2F".
export function encUriSegment(x: string): string {
  return encodeURIComponent(x);
}
