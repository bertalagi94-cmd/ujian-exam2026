// src/lib/admin-kelas.ts
//
// ── ADMIN KELAS ─────────────────────────────────────────────────────────────
// Guru (role GURU) yang ditunjuk Super Admin untuk memvalidasi paket soal pada
// kelas tertentu. Sumber kebenaran: tabel admin_kelas (migrasi 50).
//
// PRINSIP FAIL-CLOSED (sama seperti guru-scope.ts): query yang GAGAL melempar
// error (endpoint jadi 500), tidak pernah ditafsirkan sebagai "tidak punya
// kelas" ataupun "boleh semua".
import type { SupabaseClient } from '@supabase/supabase-js'

type DbClient = SupabaseClient<any>

export interface KelasAdminKelas {
  id: string
  nama: string
}

export const KUNCI_ADMIN_KELAS_AKTIF = 'admin_kelas_aktif'

/**
 * Saklar per yayasan (tabel pengaturan). Default MATI: sekolah kecil tidak
 * perlu Admin Kelas dan semua validasi dikerjakan Super Admin.
 */
export async function adminKelasAktif(db: DbClient): Promise<boolean> {
  const { data, error } = await db
    .from('pengaturan').select('value').eq('key', KUNCI_ADMIN_KELAS_AKTIF).maybeSingle()
  if (error) throw new Error(`Gagal membaca pengaturan Admin Kelas: ${error.message}`)
  return String(data?.value ?? '').toLowerCase() === 'true'
}

/**
 * Kelas yang menjadi tanggung jawab `username`. Kosong = bukan Admin Kelas,
 * ATAU fitur Admin Kelas sedang dimatikan Super Admin (penugasan tetap
 * tersimpan, hanya tidak berlaku).
 */
export async function getKelasAdminKelas(db: DbClient, username: string): Promise<KelasAdminKelas[]> {
  if (!(await adminKelasAktif(db))) return []
  const { data: rows, error } = await db
    .from('admin_kelas')
    .select('kelas_id')
    .eq('username', username)
  if (error) throw new Error(`Gagal membaca penugasan Admin Kelas: ${error.message}`)

  const ids = (rows ?? []).map((r: any) => String(r.kelas_id))
  if (ids.length === 0) return []

  const { data: kelas, error: kelasError } = await db
    .from('kelas')
    .select('id, nama')
    .in('id', ids)
  if (kelasError) throw new Error(`Gagal membaca data kelas: ${kelasError.message}`)

  return (kelas ?? []).map((k: any) => ({ id: String(k.id), nama: String(k.nama) }))
}

/**
 * Aturan paket (mapel+kelas): satu paket hanya punya SATU kelas_id, jadi paket
 * boleh diproses kalau kelasnya termasuk wilayah Admin Kelas ini.
 */
export function paketDalamWilayah(kelasIdPaket: string | null | undefined, wilayah: KelasAdminKelas[]): boolean {
  if (!kelasIdPaket) return false
  return wilayah.some(k => k.id === kelasIdPaket)
}

/**
 * Antrean validasi Super Admin. Fitur mati → semua paket. Fitur aktif → hanya
 * paket di kelas TANPA Admin Kelas, ditambah paket di kelas ber-Admin-Kelas
 * yang tidak bisa diproses siapa pun di sana (pembuatnya satu-satunya Admin
 * Kelas kelas itu, dan tidak boleh memvalidasi paketnya sendiri).
 */
export async function antreanSuperAdmin<T extends { kelas_id: string; guru_id?: string | null }>(
  db: DbClient,
  pakets: T[]
): Promise<T[]> {
  if (!(await adminKelasAktif(db))) return pakets
  const peta = await petaPenanggungJawab(db)
  return pakets.filter(p => {
    const pj = peta.get(String(p.kelas_id))
    return !pj || (pj.size === 1 && !!p.guru_id && pj.has(String(p.guru_id)))
  })
}

/** kelas_id → kumpulan username Admin Kelas-nya (kelas tanpa penanggung jawab tidak ada di peta). */
export async function petaPenanggungJawab(db: DbClient): Promise<Map<string, Set<string>>> {
  const { data, error } = await db.from('admin_kelas').select('kelas_id, username')
  if (error) throw new Error(`Gagal membaca penugasan Admin Kelas: ${error.message}`)
  const peta = new Map<string, Set<string>>()
  for (const r of (data ?? []) as any[]) {
    const k = String(r.kelas_id)
    if (!peta.has(k)) peta.set(k, new Set())
    peta.get(k)!.add(String(r.username))
  }
  return peta
}

/** Apakah ADA kelas yang belum punya Admin Kelas (menentukan menu Validasi Soal Super Admin tampil). */
export async function adaKelasTanpaAdminKelas(db: DbClient): Promise<boolean> {
  const [{ data: kelas, error }, peta] = await Promise.all([
    db.from('kelas').select('id'),
    petaPenanggungJawab(db),
  ])
  if (error) throw new Error(`Gagal membaca data kelas: ${error.message}`)
  return (kelas ?? []).some((k: any) => !peta.has(String(k.id)))
}
