// Status "siswa sedang dipantau admin" (mode Lihat-sebagai) — sisi server.
//
// Tidak butuh tabel baru: setiap sesi Lihat-sebagai atas SISWA punya SATU baris
// penanda di `log_aktivitas` (id = sid, user_id = NIS siswa):
//   aksi 'DIPANTAU_MULAI'   → sesi berjalan
//   aksi 'DIPANTAU_SELESAI' → sesi ditutup admin
// Banner admin mengirim "ping" tiap 30 detik yang menyegarkan created_at baris
// itu. Siswa dianggap sedang dipantau kalau baris MULAI-nya di-ping dalam
// DIPANTAU_TTL_MS terakhir. Jadi kalau tab admin tertutup mendadak, banner di
// sisi siswa hilang sendiri paling lama ~2 menit — tidak menggantung 2 jam.
import { SupabaseClient } from '@supabase/supabase-js'
import { cachedFetch, cacheDel } from '@/lib/cache'

export const DIPANTAU_TTL_MS = 120_000
const PETA_KEY = 'dipantau:peta'

// Satu query untuk SEMUA siswa (di-cache 4 detik per instance), bukan satu
// query per siswa — supaya polling ratusan siswa tidak membebani database.
async function petaDipantau(db: SupabaseClient<any>): Promise<Record<string, string>> {
  return cachedFetch(PETA_KEY, 4, async () => {
    const since = new Date(Date.now() - DIPANTAU_TTL_MS).toISOString()
    const { data, error } = await db
      .from('log_aktivitas')
      .select('id, user_id')
      .eq('aksi', 'DIPANTAU_MULAI')
      .gte('created_at', since)
    if (error) {
      console.error('Gagal baca status dipantau:', error)
      return {}
    }
    const peta: Record<string, string> = {}
    for (const r of (data ?? []) as { id: string; user_id: string }[]) peta[r.user_id] = r.id
    return peta
  })
}

// Mengembalikan sid sesi yang sedang memantau siswa ini, atau null.
export async function sidDipantauUntuk(db: SupabaseClient<any>, nis: string): Promise<string | null> {
  const peta = await petaDipantau(db)
  return peta[nis] ?? null
}

// Dipanggil setelah sesi dimulai/diakhiri supaya instance ini langsung
// membaca data segar (instance lain menyusul dalam ≤4 detik).
export function invalidasiDipantau() {
  cacheDel(PETA_KEY)
}
