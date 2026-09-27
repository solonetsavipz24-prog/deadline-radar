export function getAuthRedirectUrl(baseUrl: string, origin: string) {
  return new URL(baseUrl, origin).toString()
}

export function getAuthCallbackError(search: string, hash: string) {
  const searchError = new URLSearchParams(search).get('error_description')
  const hashError = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('error_description')
  return searchError ?? hashError
}
