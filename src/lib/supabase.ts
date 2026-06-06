import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side: satu instance, dipakai di browser
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side: singleton — dibuat SEKALI, dipakai ulang semua API route
// Sebelumnya: createClient() baru tiap request = ratusan koneksi terbuka
let _adminClient: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return _adminClient
}
