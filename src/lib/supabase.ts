import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Client-side: lazy singleton
let _client: SupabaseClient<any> | null = null

export function getSupabaseClient(): SupabaseClient<any> {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ) as SupabaseClient<any>
  }
  return _client
}

// Keep backward compat export as a getter proxy
export const supabase = new Proxy({} as SupabaseClient<any>, {
  get(_target, prop) {
    return (getSupabaseClient() as any)[prop]
  }
})

// Server-side: singleton — dibuat SEKALI, dipakai ulang semua API route
let _adminClient: SupabaseClient<any> | null = null

export function createAdminClient(): SupabaseClient<any> {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    ) as SupabaseClient<any>
  }
  return _adminClient
}
