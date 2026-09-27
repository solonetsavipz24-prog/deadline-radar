import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigError = (() => {
  if (!url && !key) return ''
  if (!url || !key) return `Для Supabase потрібні обидві змінні VITE_SUPABASE_URL і VITE_SUPABASE_ANON_KEY. Додайте відсутнє значення у .env.local та перезапустіть застосунок.`
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return 'URL Supabase має використовувати HTTPS. Перевірте VITE_SUPABASE_URL.'
    }
    return ''
  } catch {
    return 'VITE_SUPABASE_URL має бути повною URL-адресою Supabase. Перевірте .env.local.'
  }
})()
export const supabaseConfigured = Boolean(url && key && !supabaseConfigError)
export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
