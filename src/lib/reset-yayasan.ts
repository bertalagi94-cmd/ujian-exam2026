// Penghapusan data untuk fitur Reset, DIBATASI KE SATU YAYASAN.
//
// LATAR BELAKANG BUG
// Reset lama memakai createAdminClient() polos dan TRUNCATE untuk tabel besar,
// jadi satu admin yang menekan Reset menghapus data SEMUA yayasan di database
// itu (termasuk saat saklar MULTI_YAYASAN_ENABLED mati).
//
// CARA KERJA SEKARANG
//   1. Tabel yang punya kolom yayasan_id (TABEL_PER_YAYASAN di tenant.ts)
//      dihapus lewat tenantDb(yayasanId), yang otomatis menambah
//      `.eq('yayasan_id', ...)` pada setiap delete.
//   2. Tabel anak yang TIDAK punya yayasan_id (siswa_ujian, jawaban,
//      jawaban_essay*, skor_essay_siswa, essay_amplop_offline, log_reset)
//      dihapus berdasarkan daftar sesi_id / nis yang SEBELUMNYA diambil lewat
//      query ber-scope (sesi_ujian dan siswa milik yayasan ini). Pola ini sama
//      dengan yang diminta docs/MULTI_YAYASAN.md ("Pola kode").
//   3. Tidak ada TRUNCATE dan tidak ada delete tanpa filter. Tabel yang tidak
//      dikenal DITOLAK (fail-closed), bukan dihapus.
//   4. File Storage dibersihkan hanya untuk milik yayasan ini: folder soal
//      per yayasan, dan foto essay lewat foto_url baris yang akan dihapus.

import { ambilSemuaBaris } from '@/lib/ambil-semua'
import {
  KUNCI_PENGATURAN_DILINDUNGI_RESTORE,
  hapusFotoEssayFisik,
  isMissingTableError,
  listBucketFiles,
  pkOf,
  removeFilesInChunks,
  type Db,
} from '@/lib/backup-restore-shared'
import { KUNCI_MAINTENANCE } from '@/lib/maintenance'
import { TABEL_PER_YAYASAN, YAYASAN_AWAL_ID, tenantDb } from '@/lib/tenant'

/** Tabel anak yang terikat lewat sesi_id (dan punya kolom nis). */
const TABEL_ANAK_SESI: ReadonlySet<string> = new Set([
  'siswa_ujian',
  'jawaban',
  'jawaban_essay',
  'jawaban_essay_foto',
  'skor_essay_siswa',
  'essay_amplop_offline',
])

/** Tabel anak yang hanya terikat lewat nis. */
const TABEL_ANAK_NIS: ReadonlySet<string> = new Set(['log_reset'])

/**
 * Tabel yang sengaja TIDAK dihapus eksplisit pada reset per yayasan:
 *  - guru_sekolah : ikut terhapus oleh ON DELETE CASCADE saat `users` / `sekolah`
 *                   milik yayasan ini dihapus (migrasi 29).
 *  - metrik_sistem: telemetri server yang dipakai bersama semua yayasan.
 */
const TABEL_DILEWATI: ReadonlySet<string> = new Set(['guru_sekolah', 'metrik_sistem'])

// Ukuran potongan agar URL permintaan PostgREST tidak kepanjangan dan satu
// DELETE tidak terlalu besar.
const POTONG_SESI = 20
const POTONG_NIS = 100
const POTONG_PK = 100
const LIMIT_BATCH = 1000
const MAKS_PUTARAN_BATCH = 500

// Kunci pengaturan yang tidak boleh dihapus oleh reset kategori "pengaturan"/"semua":
//  - kunci penanda proses & maintenanceAktif: dipakai reset ini sendiri sampai
//    selesai, lalu dikembalikan oleh selesaiModeMaintenanceUntukProses().
//  - kunci maintenance lain (pesan, jadwal): milik Panel Developer.
const KUNCI_PENGATURAN_DIPERTAHANKAN = [
  ...new Set<string>([...KUNCI_PENGATURAN_DILINDUNGI_RESTORE, ...KUNCI_MAINTENANCE]),
]
const FILTER_KUNCI_DIPERTAHANKAN = `(${KUNCI_PENGATURAN_DIPERTAHANKAN.join(',')})`

function potong<T>(arr: T[], ukuran: number): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : 'error'
}

function errorTimeout(msg: string | undefined | null): boolean {
  return !!msg && /timeout|57014/i.test(msg)
}

export interface LingkupYayasan {
  yayasanId: string
  /** Client terkunci ke yayasan ini (tenantDb). Jangan ganti dengan client global. */
  db: Db
  /** id semua sesi_ujian milik yayasan ini (di-cache setelah pemanggilan pertama). */
  sesiIds(): Promise<string[]>
  /** nis semua siswa milik yayasan ini (di-cache setelah pemanggilan pertama). */
  nisSiswa(): Promise<string[]>
}

async function ambilKolom(db: Db, tabel: string, kolom: string): Promise<string[]> {
  // Nama kolom dinamis membuat tipe select() Supabase tidak bisa disimpulkan.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dariTabel = (): any => db.from(tabel)
  const { data, error } = await ambilSemuaBaris<Record<string, unknown>>((dari, sampai) =>
    dariTabel().select(kolom).order(kolom).range(dari, sampai)
  )
  if (error) throw new Error(`${tabel}: ${error.message}`)
  return data.map(r => String(r[kolom]))
}

export function buatLingkupYayasan(yayasanId: string): LingkupYayasan {
  if (!yayasanId) throw new Error('buatLingkupYayasan: yayasanId wajib diisi')
  const db = tenantDb(yayasanId)
  let sesi: Promise<string[]> | null = null
  let nis: Promise<string[]> | null = null
  return {
    yayasanId,
    db,
    sesiIds: () => (sesi ??= ambilKolom(db, 'sesi_ujian', 'id')),
    nisSiswa: () => (nis ??= ambilKolom(db, 'siswa', 'nis')),
  }
}

/**
 * Pastikan semua tabel yang akan dihapus dikenal dan bisa dibatasi ke satu
 * yayasan. Mengembalikan nama tabel pertama yang TIDAK aman, atau null.
 */
export function tabelTidakAman(tabel: string[]): string | null {
  for (const t of tabel) {
    if (TABEL_DILEWATI.has(t)) continue
    if (TABEL_PER_YAYASAN.has(t) || TABEL_ANAK_SESI.has(t) || TABEL_ANAK_NIS.has(t)) continue
    return t
  }
  return null
}

/** Tabel dari rencana reset yang benar-benar diproses (tanpa yang sengaja dilewati). */
export function tabelYangDiproses(tabel: string[]): string[] {
  return tabel.filter(t => !TABEL_DILEWATI.has(t))
}

/** Muat daftar sesi & nis di awal, SEBELUM ada baris yang dihapus. */
export async function muatDaftarId(
  ls: LingkupYayasan,
  tabel: string[]
): Promise<string | null> {
  try {
    if (tabel.some(t => TABEL_ANAK_SESI.has(t))) await ls.sesiIds()
    if (tabel.includes('siswa') || tabel.some(t => TABEL_ANAK_NIS.has(t))) await ls.nisSiswa()
    return null
  } catch (e) {
    return pesanError(e)
  }
}

/**
 * Cek aktivitas ujian KHUSUS yayasan ini (pengganti cekAktivitasUjian global,
 * yang melihat sesi/siswa semua yayasan sehingga reset yayasan A bisa tertolak
 * gara-gara ujian yayasan B).
 */
export async function cekAktivitasUjianYayasan(
  ls: LingkupYayasan
): Promise<{ adaSesi: boolean; adaSiswa: boolean; error?: string }> {
  try {
    const sesiBerjalan = await ls.db.from('sesi_ujian').select('id').eq('status', 'BERJALAN').limit(1)
    if (sesiBerjalan.error) return { adaSesi: false, adaSiswa: false, error: sesiBerjalan.error.message }
    const adaSesi = (sesiBerjalan.data?.length ?? 0) > 0

    let adaSiswa = false
    for (const bagian of potong(await ls.sesiIds(), 100)) {
      const { data, error } = await ls.db
        .from('siswa_ujian')
        .select('id')
        .eq('status', 'AKTIF')
        .in('sesi_id', bagian)
        .limit(1)
      if (error) return { adaSesi, adaSiswa: false, error: error.message }
      if ((data?.length ?? 0) > 0) {
        adaSiswa = true
        break
      }
    }
    return { adaSesi, adaSiswa }
  } catch (e) {
    return { adaSesi: false, adaSiswa: false, error: pesanError(e) }
  }
}

// ── Storage ─────────────────────────────────────────────────────────────────

// Gambar soal disimpan di assets/<yayasan>/soal/ (yayasan awal: assets/soal/,
// lihat api/guru/soal/upload). Hanya folder yayasan ini yang dibersihkan.
function targetStoragePerTabel(yayasanId: string, tabel: string): { bucket: string; prefix: string }[] {
  if (tabel === 'soal' || tabel === 'soal_essay') {
    const folder = yayasanId === YAYASAN_AWAL_ID ? '' : `${yayasanId}/`
    return [{ bucket: 'assets', prefix: `${folder}soal` }]
  }
  return []
}

async function bersihkanStorage(db: Db, target: { bucket: string; prefix: string }): Promise<string | null> {
  try {
    const terdaftar = await listBucketFiles(db, target.bucket, target.prefix)
    if (terdaftar.bucketMissing) return null // bucket tidak ada = tidak ada yang perlu dihapus
    if (terdaftar.error) return `storage:${terdaftar.error}`
    if (terdaftar.paths.length === 0) return null
    const err = await removeFilesInChunks(db, target.bucket, terdaftar.paths)
    return err ? `storage:${err}` : null
  } catch (e) {
    return `storage:${target.bucket}/${target.prefix}: ${pesanError(e)}`
  }
}

// ── Penghapusan ─────────────────────────────────────────────────────────────

// Hapus baris tabel anak untuk satu potongan nilai `kolom` (sesi_id atau nis).
async function hapusPotonganAnak(
  db: Db,
  tabel: string,
  kolom: 'sesi_id' | 'nis',
  nilai: string[]
): Promise<string | null> {
  if (tabel === 'jawaban_essay_foto') {
    // Hapus file fisiknya DULU (fail-closed): kalau gagal, baris dibiarkan supaya
    // foto_url tidak hilang sebelum filenya terhapus.
    const { data, error } = await ambilSemuaBaris<{ foto_url: string | null }>((dari, sampai) =>
      db.from(tabel).select('id, foto_url').in(kolom, nilai).order('id').range(dari, sampai)
    )
    if (error) return isMissingTableError(error.message) ? null : `${tabel}: ${error.message}`
    const errFoto = await hapusFotoEssayFisik(db, data.map(r => r.foto_url))
    if (errFoto) return `storage:${errFoto}`
  }
  const { error } = await db.from(tabel).delete().in(kolom, nilai)
  if (error) return isMissingTableError(error.message) ? null : `${tabel}: ${error.message}`
  return null
}

async function hapusTabelAnak(ls: LingkupYayasan, tabel: string, termasukSiswa: boolean): Promise<string | null> {
  try {
    if (TABEL_ANAK_SESI.has(tabel)) {
      for (const bagian of potong(await ls.sesiIds(), POTONG_SESI)) {
        const err = await hapusPotonganAnak(ls.db, tabel, 'sesi_id', bagian)
        if (err) return err
      }
    }
    // Siswa ikut dihapus → bersihkan juga sisa baris berdasarkan nis (mis. yatim
    // dari sesi yang sudah tidak ada), supaya NIS yang kelak dipakai ulang tidak
    // mewarisi data lama. log_reset hanya punya kolom nis.
    if (TABEL_ANAK_NIS.has(tabel) || termasukSiswa) {
      for (const bagian of potong(await ls.nisSiswa(), POTONG_NIS)) {
        const err = await hapusPotonganAnak(ls.db, tabel, 'nis', bagian)
        if (err) return err
      }
    }
    return null
  } catch (e) {
    return `${tabel}: ${pesanError(e)}`
  }
}

// Filter baris untuk tabel ber-yayasan_id (yayasan_id sendiri ditambahkan tenantDb).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function terapkanFilterBaris(q: any, tabel: string): any {
  if (tabel === 'users') return q.neq('role', 'ADMIN') // akun ADMIN tidak pernah dihapus
  const hasil = q.not(pkOf(tabel)[0], 'is', null)
  return tabel === 'pengaturan' ? hasil.not('key', 'in', FILTER_KUNCI_DIPERTAHANKAN) : hasil
}

// Dipakai kalau satu DELETE besar kena statement timeout: ambil pk per halaman
// lalu hapus per potongan. Tetap lewat tenantDb, jadi tetap hanya yayasan ini.
async function hapusBertahap(db: Db, tabel: string): Promise<string | null> {
  const pk = pkOf(tabel)[0]
  for (let putaran = 0; putaran < MAKS_PUTARAN_BATCH; putaran++) {
    const { data, error } = await terapkanFilterBaris(db.from(tabel).select(pk), tabel).limit(LIMIT_BATCH)
    if (error) return `${tabel}: ${error.message}`
    const kunci = ((data ?? []) as Record<string, unknown>[]).map(r => String(r[pk]))
    if (kunci.length === 0) return null
    for (const bagian of potong(kunci, POTONG_PK)) {
      const { error: errHapus } = await db.from(tabel).delete().in(pk, bagian)
      if (errHapus) return `${tabel}: ${errHapus.message}`
    }
  }
  return `${tabel}: masih ada sisa baris setelah ${MAKS_PUTARAN_BATCH} putaran, ulangi reset`
}

async function hapusTabelBerYayasan(db: Db, tabel: string): Promise<string | null> {
  const { error } = await terapkanFilterBaris(db.from(tabel).delete(), tabel)
  if (!error) return null
  if (isMissingTableError(error.message)) return null
  if (errorTimeout(error.message)) return hapusBertahap(db, tabel)
  return `${tabel}: ${error.message}`
}

/**
 * Hapus data satu tabel untuk yayasan di `ls`. Mengembalikan pesan error, atau
 * null kalau berhasil. `storageSelesai` mencegah folder Storage yang sama
 * dibersihkan dua kali (soal & soal_essay berbagi folder).
 */
export async function hapusTabelYayasan(
  ls: LingkupYayasan,
  tabel: string,
  opsi: { termasukSiswa: boolean; storageSelesai: Set<string> }
): Promise<string | null> {
  // Fail-closed: tabel yang tidak bisa dibatasi ke yayasan ini tidak disentuh.
  if (tabelTidakAman([tabel])) return `${tabel}: tidak dapat dibatasi ke satu yayasan, dilewati`
  if (TABEL_DILEWATI.has(tabel)) return null

  try {
    for (const t of targetStoragePerTabel(ls.yayasanId, tabel)) {
      const kunci = `${t.bucket}/${t.prefix}`
      if (opsi.storageSelesai.has(kunci)) continue
      const err = await bersihkanStorage(ls.db, t)
      if (err) return err
      opsi.storageSelesai.add(kunci)
    }

    if (TABEL_ANAK_SESI.has(tabel) || TABEL_ANAK_NIS.has(tabel)) {
      return await hapusTabelAnak(ls, tabel, opsi.termasukSiswa)
    }
    return await hapusTabelBerYayasan(ls.db, tabel)
  } catch (e) {
    return `${tabel}: ${pesanError(e)}`
  }
}
