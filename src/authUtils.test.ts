import { describe, expect, it } from 'vitest'
import { getAuthCallbackError, getAuthRedirectUrl } from './authUtils'

describe('Supabase auth callback helpers', () => {
  it('keeps the GitHub Pages project path in the OAuth redirect', () => {
    expect(getAuthRedirectUrl('/deadline-radar/', 'https://student.github.io'))
      .toBe('https://student.github.io/deadline-radar/')
    expect(getAuthRedirectUrl('/', 'http://localhost:5173'))
      .toBe('http://localhost:5173/')
  })

  it('decodes OAuth errors from query or fragment parameters', () => {
    expect(getAuthCallbackError('', '#error=access_denied&error_description=Access+denied'))
      .toBe('Access denied')
    expect(getAuthCallbackError('?error_description=Callback+failed', ''))
      .toBe('Callback failed')
    expect(getAuthCallbackError('', '#access_token=token')).toBeNull()
  })
})
