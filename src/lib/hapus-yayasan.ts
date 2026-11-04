// Penghapusan PERMANEN satu yayasan (sekolah) beserta SELURUH datanya.
// Dipakai hanya oleh Panel Developer (DELETE /api/developer/yayasan/[id]).
//
// PRINSIP
//   - Memakai ulang jalur penghapusan Reset per yayasan (reset-yayasan.ts) yang
//     sudah terkunci ke satu yayasan lewat tenantDb. Tidak ada TRUNCATE dan tidak
//     ada delete tanpa filter yayasan_id.
//   - Berbeda dari Reset: akun ADMIN dan semua kunci `pengaturan` ikut dihapus,
//     folder Storage `assets/<yayasan_id>/` (logo, gambar soal, dll.) ikut
//     dibersihkan, lalu baris `yayasan` itu sendiri dihapus.
//   - FAIL-CLOSED: begitu satu langkah gagal, proses berhenti dan baris `yayasan`
//     TIDAK dihapus. Proses aman diulang (idempotent) sampai tuntas.
//   - Yayasan awal (YYS_AWAL) tidak pernah boleh dihapus; folder Storage-nya
//     adalah akar bucket, sehingga menghapusnya bisa mengenai file yayasan lain.

import { createAdminClient } from '@/lib/supabase'
import {
  DELETE_ORDER,
  isMissingTableError,
  listBucketFiles,
  pkOf,
  removeFilesInChunks,
} from '@/lib/backup-restore-shared'
import {
  buatLingkupYayasan,
  hapusTabelYayasan,
  muatDaftarId,
  tabelTidakAman,
  tabelYangDiproses,
} from '@/lib/reset-yayasan'
import { YAYASAN_AWAL_ID } from '@/lib/tenant'

export interface HasilHapusYayasan {
  ok: boolean
  /** Tabel yang sudah dikosongkan untuk yayasan ini. */
  dihapus: string[]
  /** Jumlah file Storage yang dihapus dari folder yayasan. */
  fileDihapus: number
  errors: string[]
}

// id yayasan dipakai sebagai nama folder Storage; pastikan aman sebelum dipakai.
const POLA_ID_AMAN = /^[A-Za-z0-9_-]{3,64}$/

type DbTenant = ReturnType<typeof buatLingkupYayasan>['db']

// Hapus SEMUA baris tabel kecil (users, pengaturan) milik yayasan ini, termasuk
// yang dikecualikan oleh Reset (akun ADMIN, kunci maintenance/proses).
async function hapusSemuaBaris(db: DbTenant, tabel: string): Promise<string | null> {
  const pk = pkOf(tabel)[0]
  const { error } = await db.from(tabel).delete().not(pk, 'is', null)
  if (!error) return null
  if (isMissingTableError(error.message)) return null
  return `${tabel}: ${error.message}`
}

export async function hapusYayasanPermanen(yayasanId: string): Promise<HasilHapusYayasan> {
  const hasil: HasilHapusYayasan = { ok: false, dihapus: [], fileDihapus: 0, errors: [] }

  if (!yayasanId || yayasanId === YAYASAN_AWAL_ID) {
    hasil.errors.push('Yayasan awal tidak boleh dihapus')
    return hasil
  }
  if (!POLA_ID_AMAN.test(yayasanId)) {
    hasil.errors.push('Format id yayasan tidak valid')
    return hasil
  }

  const ls = buatLingkupYayasan(yayasanId)
  // guru_sekolah & metrik_sistem dilewati: guru_sekolah ikut terhapus CASCADE
  // saat users/sekolah dihapus, metrik_sistem adalah telemetri bersama.
  const tabel = tabelYangDiproses(DELETE_ORDER)

  const tidakAman = tabelTidakAman(tabel)
  if (tidakAman) {
    hasil.errors.push(`tabel "${tidakAman}" belum bisa dibatasi ke satu yayasan`)
    return hasil
  }

  // Ambil daftar sesi & nis SEKARANG, sebelum ada baris yang dihapus.
  const errDaftar = await muatDaftarId(ls, tabel)
  if (errDaftar) {
    hasil.errors.push(`Gagal membaca data yayasan: ${errDaftar}`)
    return hasil
  }

  // 1. Data tabel, urut dari anak ke induk (DELETE_ORDER sudah FK-safe).
  const storageSelesai = new Set<string>()
  for (const t of tabel) {
    const err = (t === 'users' || t === 'pengaturan')
      ? await hapusSemuaBaris(ls.db, t)
      : await hapusTabelYayasan(ls, t, { termasukSiswa: true, storageSelesai })
    if (err) {
      hasil.errors.push(err)
      return hasil // berhenti; yayasan belum dihapus, aman diulang
    }
    hasil.dihapus.push(t)
  }

  // 2. Storage: seluruh folder milik yayasan ini di bucket `assets`.
  // (Foto essay di bucket privat sudah dihapus lewat foto_url saat
  //  jawaban_essay_foto dikosongkan di langkah 1.)
  try {
    const admin = createAdminClient()
    const daftar = await listBucketFiles(admin, 'assets', yayasanId)
    if (daftar.error) {
      hasil.errors.push(`storage:${daftar.error}`)
      return hasil
    }
    if (!daftar.bucketMissing && daftar.paths.length > 0) {
      const err = await removeFilesInChunks(admin, 'assets', daftar.paths)
      if (err) {
        hasil.errors.push(`storage:${err}`)
        return hasil
      }
      hasil.fileDihapus = daftar.paths.length
    }
  } catch (e) {
    hasil.errors.push(`storage: ${e instanceof Error ? e.message : 'error'}`)
    return hasil
  }

  // 3. Terakhir: baris yayasan itu sendiri. Kalau masih ada baris yang merujuknya
  // (mis. siswa yang baru saja menyimpan data di tengah proses), FK menolak dan
  // pesan galatnya dikembalikan supaya developer bisa mengulang.
  const { error } = await createAdminClient().from('yayasan').delete().eq('id', yayasanId)
  if (error) {
    hasil.errors.push(`yayasan: ${error.message}`)
    return hasil
  }

  hasil.ok = true
  return hasil
}
