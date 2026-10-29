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

/** Kelas yang menjadi tanggung jawab `username`. Kosong = bukan Admin Kelas. */
export async function getKelasAdminKelas(db: DbClient, username: string): Promise<KelasAdminKelas[]> {
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
