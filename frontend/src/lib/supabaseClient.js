import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const DEFAULT_TOKEN_SKEW_SECONDS = 30

export const missingSupabaseEnv = []

if (!supabaseUrl) missingSupabaseEnv.push('VITE_SUPABASE_URL')
if (!supabaseAnonKey) missingSupabaseEnv.push('VITE_SUPABASE_ANON_KEY')

export const supabase = missingSupabaseEnv.length === 0
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Keep auth across refreshes and browser restarts until the user signs out or the session expires.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  })
  : null

const decodeBase64 = (value) => {
  if (typeof atob === 'function') return atob(value)
  if (typeof globalThis?.Buffer !== 'undefined') {
    return globalThis.Buffer.from(value, 'base64').toString('utf-8')
  }
  return ''
}

export const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(decodeBase64(padded))
  } catch {
    return null
  }
}

export const isAccessTokenExpired = (token, skewSeconds = DEFAULT_TOKEN_SKEW_SECONDS) => {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return true
  const nowSeconds = Math.floor(Date.now() / 1000)
  return payload.exp <= nowSeconds + skewSeconds
}
