// src/lib/persetujuan-paket.ts
//
// Inti persetujuan paket soal (PG & Essay) yang dipakai BERSAMA oleh:
//   - Super Admin   : /api/admin/soal, /api/admin/soal-essay
//   - Admin Kelas   : /api/guru/admin-kelas/soal, /api/guru/admin-kelas/soal-essay
//
// Logika dipindahkan APA ADANYA dari kedua route admin (bukan ditulis ulang):
//   1. paket harus ditemukan lewat query ber-scope yayasan (RPC tidak ter-scope),
//   2. tolak kalau sesi mapel+kelas sudah mulai (cekSesiMapelKelasSudahMulai),
//   3. ubah status lewat RPC atomik set_status_paket_* (row lock + unique index),
//   4. petakan error database ke status HTTP yang tepat.
// Lihat komentar "FIX" di sejarah admin/soal/route.ts untuk latar belakang tiap langkah.
import type { SupabaseClient } from '@supabase/supabase-js'
import { cekSesiMapelKelasSudahMulai, pesanBankSoalTerkunci } from '@/lib/sesi-kelas'

type DbClient = SupabaseClient<any>

export type JenisPaket = 'PG' | 'ESSAY'
export type AksiPaket = 'SETUJUI' | 'TOLAK' | 'BATAL_SETUJUI'

export const STATUS_DARI_AKSI: Record<AksiPaket, string> = {
  SETUJUI: 'DISETUJUI',
  TOLAK: 'DITOLAK',
  BATAL_SETUJUI: 'DRAFT',
}

export function aksiValid(a: unknown): a is AksiPaket {
  return a === 'SETUJUI' || a === 'TOLAK' || a === 'BATAL_SETUJUI'
}

export function pesanSukses(status: string): string {
  return status === 'DISETUJUI' ? 'disetujui' : status === 'DITOLAK' ? 'ditolak' : 'dikembalikan ke draft'
}

export interface PaketRingkas {
  mapel_id: string
  kelas_id: string
  guru_id?: string | null
}

export type HasilUbahStatus =
  | { ok: true; paket: PaketRingkas; status: string }
  | { ok: false; httpStatus: number; error: string }

/** Cari paket ber-scope yayasan (null = tidak ada / bukan milik yayasan ini). */
export async function ambilPaketRingkas(
  db: DbClient,
  jenis: JenisPaket,
  paketId: string
): Promise<PaketRingkas | null> {
  const { data } = await db
    .from(jenis === 'ESSAY' ? 'paket_essay' : 'paket_soal')
    .select('mapel_id, kelas_id, guru_id')
    .eq('id', paketId)
    .single()
  return data ?? null
}

/**
 * Jalankan guard + RPC. `paketTerambil` boleh diisi pemanggil yang SUDAH memuat
 * paket (mis. Admin Kelas, yang perlu kelas_id-nya untuk cek wilayah) agar tidak
 * query dua kali.
 *
 * `izinkan` dipanggil SETELAH paket ditemukan dan SEBELUM guard/RPC; kembalikan
 * string pesan untuk menolak (403), atau null untuk lanjut.
 */
export async function ubahStatusPaket(
  db: DbClient,
  jenis: JenisPaket,
  opts: {
    paketId: string
    aksi: AksiPaket
    catatan?: string | null
    paketTerambil?: PaketRingkas | null
    izinkan?: (paket: PaketRingkas) => string | null
  }
): Promise<HasilUbahStatus> {
  const newStatus = STATUS_DARI_AKSI[opts.aksi]

  const paket = opts.paketTerambil ?? (await ambilPaketRingkas(db, jenis, opts.paketId))
  if (!paket) return { ok: false, httpStatus: 404, error: 'Paket tidak ditemukan' }

  const ditolak = opts.izinkan?.(paket)
  if (ditolak) return { ok: false, httpStatus: 403, error: ditolak }

  const sesiSudahMulai = await cekSesiMapelKelasSudahMulai(db, paket.mapel_id, paket.kelas_id)
  if (sesiSudahMulai) {
    return {
      ok: false,
      httpStatus: 409,
      error: pesanBankSoalTerkunci(jenis === 'ESSAY' ? 'Essay' : 'PG', sesiSudahMulai, 'mengubah'),
    }
  }

  const { error: rpcError } = await db.rpc(
    jenis === 'ESSAY' ? 'set_status_paket_essay' : 'set_status_paket_soal',
    { p_paket_id: opts.paketId, p_new_status: newStatus, p_catatan: opts.catatan || null }
  )

  if (rpcError) {
    // PT409: status paket sudah berubah sejak halaman dimuat (migrasi 37).
    if (rpcError.code === 'PT409') return { ok: false, httpStatus: 409, error: rpcError.message }
    // unique_violation: ada paket lain yang baru disetujui untuk mapel+kelas yang sama.
    if (rpcError.code === '23505') {
      return {
        ok: false,
        httpStatus: 409,
        error: 'Ada paket lain yang baru saja disetujui untuk mapel & kelas yang sama. Muat ulang halaman dan coba lagi.',
      }
    }
    return { ok: false, httpStatus: 500, error: rpcError.message }
  }

  return { ok: true, paket, status: newStatus }
}

/**
 * Tambahkan nama_guru / nama_mapel / nama_kelas ke daftar paket (PG atau Essay).
 * Dipakai bersama oleh daftar validasi Super Admin dan Admin Kelas.
 */
export async function perkayaPaket(db: DbClient, pakets: any[]): Promise<any[]> {
  if (!pakets.length) return []
  const guruIds = [...new Set(pakets.map(p => p.guru_id).filter(Boolean))]
  const mapelIds = [...new Set(pakets.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(pakets.map(p => p.kelas_id).filter(Boolean))]

  const [{ data: guruList }, { data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('users').select('username, nama').in('username', guruIds),
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
  ])

  const guruMap = Object.fromEntries((guruList ?? []).map((g: any) => [g.username, g.nama]))
  const mapelMap = Object.fromEntries((mapelList ?? []).map((m: any) => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map((k: any) => [k.id, String(k.nama)]))

  return pakets.map(p => ({
    ...p,
    nama_guru: guruMap[p.guru_id] ?? p.guru_id,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))
}
