/**
 * Pengaturan GLOBAL (berlaku untuk semua sekolah), disimpan di tabel
 * pengaturan_global (supabase/48_logo_aplikasi_global.sql).
 *
 * Saat ini hanya memuat logo aplikasi. Pembacaannya terbuka (ditampilkan di
 * halaman login), tetapi PENULISAN hanya lewat /api/developer/logo-aplikasi
 * yang dijaga requireDeveloper — admin sekolah tidak punya jalan menulisnya.
 */
import { createAdminClient } from '@/lib/supabase'
import { cachedFetch } from '@/lib/cache'

export const KUNCI_LOGO_APLIKASI = 'logoAplikasi'

// Diawali 'pengaturan:' supaya ikut terhapus oleh cacheDelPrefix('pengaturan:')
// yang sudah dipakai di seluruh aplikasi.
const KUNCI_CACHE = 'pengaturan:global:logoAplikasi'

/**
 * URL logo aplikasi global, atau '' kalau belum diatur. Tidak pernah melempar
 * error: kalau tabel belum dimigrasi / database bermasalah, hasilnya '' dan
 * halaman memakai logo sekolah sebagai cadangan.
 */
export async function ambilLogoAplikasi(): Promise<string> {
  try {
    return await cachedFetch<string>(KUNCI_CACHE, 60, async () => {
      const { data, error } = await createAdminClient()
        .from('pengaturan_global')
        .select('value')
        .eq('key', KUNCI_LOGO_APLIKASI)
        .maybeSingle()
      if (error) return ''
      return (data?.value as string | undefined) ?? ''
    })
  } catch {
    return ''
  }
}

export async function simpanLogoAplikasi(url: string): Promise<{ error?: string }> {
  const { error } = await createAdminClient()
    .from('pengaturan_global')
    .upsert({ key: KUNCI_LOGO_APLIKASI, value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return error ? { error: error.message } : {}
}
