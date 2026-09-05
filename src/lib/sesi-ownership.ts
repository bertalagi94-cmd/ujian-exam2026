// src/lib/sesi-ownership.ts
//
// ── OWNERSHIP CHECK UNTUK SESI UJIAN ────────────────────────────────────────
// BUG SEBELUMNYA: beberapa endpoint pengawas (lihat daftar di bawah) hanya
// memvalidasi role akun (GURU/ADMIN), TANPA mengecek apakah guru yang
// memanggil benar-benar pengawas yang ditugaskan untuk sesi ujian tersebut.
// Akibatnya, secara teori GURU A bisa memanggil endpoint ini langsung
// (lewat API, bukan lewat tampilan aplikasi) untuk melihat data siswa,
// melihat pelanggaran, mereset siswa, atau menutup sesi ujian milik GURU B —
// padahal di tampilan aplikasi (Mode Pengawas) dia memang tidak pernah
// melihat sesi milik guru lain.
//
// FIX: helper ini dipakai di endpoint yang menerima sesiId, untuk
// memastikan `username` pemanggil memang pengawas yang sah untuk sesi itu,
// sebelum endpoint melanjutkan baca/tulis data.
//
// Dipakai oleh:
//   - GET  /api/pengawas/sesi/[id]/siswa
//   - GET  /api/pengawas/pelanggaran   (saat ?sesiId= diisi)
//   - POST /api/pengawas/sesi/[id]/reset-siswa
//   - POST /api/guru/mode-pengawas/tutup

import { createAdminClient } from '@/lib/supabase'
import { cacheGet, cacheSet } from '@/lib/cache'

type DbClient = ReturnType<typeof createAdminClient>

/**
 * Sama seperti verifySesiOwnership, tapi hasilnya di-cache di memori server
 * selama beberapa detik. Status "siapa pengawas sah sesi ini" praktis tidak
 * pernah berubah selagi sesi berjalan (kecuali diambil-alih admin — jarang
 * terjadi), jadi meng-query ulang 2 tabel di setiap polling tick (yang bisa
 * terjadi tiap 1-2 detik untuk deteksi pelanggaran cepat) adalah pemborosan.
 * TTL singkat (15 detik) dipilih supaya kalau memang terjadi pengambilalihan
 * sesi oleh admin, guru lama tidak terus dianggap "sah" lebih dari 15 detik.
 */
export async function verifySesiOwnershipCached(
  db: DbClient,
  sesiId: string,
  username: string
): Promise<boolean> {
  const key = `sesi-ownership:${sesiId}:${username}`
  const cached = cacheGet<boolean>(key)
  if (cached !== null) return cached

  const result = await verifySesiOwnership(db, sesiId, username)
  cacheSet(key, result, 15)
  return result
}


/**
 * Cek apakah `username` adalah pengawas yang sah untuk sesi ujian `sesiId`.
 *
 * Sah jika salah satu:
 *   - dia pengawas ASLI yang tercatat di `jadwal.pengawas`, ATAU
 *   - dia pengawas PENGGANTI yang ditugaskan Admin khusus untuk sesi
 *     susulan ini — dicatat di `sesi_ujian.info_json.pengawas_susulan`
 *     (lihat src/app/api/admin/susulan/route.ts). Pengawas asli sengaja
 *     TIDAK ikut dianggap berhak lagi untuk sesi yang sudah diambil-alih ini
 *     (sama seperti logika "diambil_alih_pengawas" di guru/mode-pengawas).
 *
 * Hanya dipakai untuk membatasi akun role GURU — pemanggil (route handler)
 * tetap bertanggung jawab mengizinkan ADMIN tanpa lewat fungsi ini.
 */
export async function verifySesiOwnership(
  db: DbClient,
  sesiId: string,
  username: string
): Promise<boolean> {
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id, info_json')
    .eq('id', sesiId)
    .maybeSingle()

  if (!sesi) return false

  // Sesi susulan yang sudah diambil-alih admin untuk pengawas pengganti —
  // pengawas pengganti itu yang berhak, bukan pengawas asli di jadwal.
  if (sesi.info_json?.dibuka_oleh_admin) {
    return sesi.info_json?.pengawas_susulan === username
  }

  if (!sesi.jadwal_id) return false

  const { data: jadwal } = await db
    .from('jadwal')
    .select('pengawas')
    .eq('id', sesi.jadwal_id)
    .maybeSingle()

  return jadwal?.pengawas === username
}
