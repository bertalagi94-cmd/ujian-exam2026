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

// ── Timeout permintaan ke Supabase (sisi server) ───────────────────────────
// LATAR BELAKANG: tanpa batas waktu, satu permintaan ke database yang sedang
// jenuh/mati (mis. Cloudflare 522) ditunggu sampai fungsi Vercel kena batas
// 300 detik. Selama itu fungsi tetap berjalan, menumpuk, dan menghabiskan
// kuota -- request berikutnya (termasuk login) ikut tertahan. Dengan timeout,
// permintaan gagal CEPAT sebagai error biasa: semua pemanggil sudah menangani
// `error` dari supabase-js (client siswa menyimpan jawaban di perangkat dan
// mengulang otomatis).
//
// Default 30 dtk: jauh di bawah 300 dtk, tapi tetap di bawah maxDuration 60
// dtk untuk route berat (backup/restore/impor) di vercel.json. Bisa diubah
// lewat env SUPABASE_FETCH_TIMEOUT_MS (milidetik) tanpa mengubah kode.
const FETCH_TIMEOUT_MS = (() => {
  const n = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 30_000
})()

const fetchDenganTimeout: typeof fetch = (input, init) => {
  const batasWaktu = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  // Hormati signal bawaan pemanggil (kalau ada) -- batalkan bila salah satu aktif.
  const signalGabungan =
    init?.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, batasWaktu])
      : init?.signal ?? batasWaktu
  return fetch(input, { ...init, signal: signalGabungan })
}

// Server-side: singleton — dibuat SEKALI, dipakai ulang semua API route
let _adminClient: SupabaseClient<any> | null = null

export function createAdminClient(): SupabaseClient<any> {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: fetchDenganTimeout },
      }
    ) as SupabaseClient<any>
  }
  return _adminClient
}
