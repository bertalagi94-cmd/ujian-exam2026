/**
 * Helper cakupan data untuk akun Guru BK (role 'BK').
 *
 * Guru BK hanya boleh melihat siswa, pelanggaran, dan nilai dari KELAS BINAAN-nya
 * (tabel bk_kelas, diatur Admin di menu "Kelas Binaan BK"). Semua endpoint
 * /api/bk/* WAJIB memakai fungsi ini dan menyaring data di sisi server — jangan
 * hanya menyembunyikan di tampilan, supaya data kelas lain tidak bisa dibuka
 * lewat URL/panggilan API langsung.
 *
 * Fail-closed, sama seperti kepsek-scope.ts: query yang benar-benar gagal
 * MELEMPAR error (route tidak membungkusnya, jadi hasilnya 500), bukan diam-diam
 * mengembalikan scope kosong.
 *
 * Catatan arsitektur (sama dengan kepsek-scope.ts): `kelasList` berisi NAMA
 * kelas karena siswa.kelas / nilai.kelas menyimpan nama sebagai teks, bukan
 * kelas_id. Dua kelas dengan nama persis sama dalam satu yayasan tidak bisa
 * dibedakan di tingkat siswa/nilai.
 */
import { tenantDb } from '@/lib/tenant'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

export interface BkScope {
  kelasIds: string[]   // kelas.id yang dibina
  kelasList: string[]  // kelas.nama yang dibina (dipakai menyaring siswa/nilai)
  noScope: boolean     // true = belum ada kelas binaan yang ditetapkan Admin
}

export const PESAN_BK_BELUM_ADA_KELAS =
  'Anda belum ditetapkan sebagai guru BK untuk kelas mana pun. Hubungi Admin untuk mengatur Kelas Binaan BK.'

export async function getBkScope(username: string, yayasanId: string): Promise<BkScope> {
  const db = tenantDb(yayasanId)

  const { data: tugas, error: tugasError } = await db
    .from('bk_kelas')
    .select('kelas_id')
    .eq('username', username)
  if (tugasError) throw new Error(`Gagal memuat kelas binaan: ${tugasError.message}`)

  const kelasIds = [...new Set((tugas ?? []).map((t: { kelas_id: string }) => String(t.kelas_id)))]
  if (kelasIds.length === 0) return { kelasIds: [], kelasList: [], noScope: true }

  const { data: kelasRows, error: kelasError } = await db
    .from('kelas')
    .select('id, nama')
    .in('id', kelasIds)
  if (kelasError) throw new Error(`Gagal memuat daftar kelas binaan: ${kelasError.message}`)

  const kelasList = [...new Set((kelasRows ?? []).map((k: { nama: string }) => String(k.nama)))]
  if (kelasList.length === 0) return { kelasIds: [], kelasList: [], noScope: true }

  return { kelasIds, kelasList, noScope: false }
}

export interface SiswaBinaan {
  nis: string
  nama: string
  kelas: string
}

/**
 * Siswa AKTIF (bukan tester) di kelas binaan. Dipakai untuk menyaring tabel yang
 * hanya menyimpan NIS (pelanggaran, nilai) dan untuk menampilkan nama/kelas.
 * Dibaca halaman demi halaman supaya tidak terpotong batas 1000 baris.
 */
export async function ambilSiswaBinaan(yayasanId: string, kelasList: string[]): Promise<SiswaBinaan[]> {
  if (kelasList.length === 0) return []
  const db = tenantDb(yayasanId)
  const { data, error } = await ambilSemuaBaris<SiswaBinaan>((dari, sampai) =>
    db.from('siswa')
      .select('nis, nama, kelas')
      .in('kelas', kelasList)
      .eq('status', 'AKTIF')
      .neq('is_tester', 'YES')
      .order('nis', { ascending: true })
      .range(dari, sampai)
  )
  if (error) throw new Error(`Gagal memuat siswa kelas binaan: ${error.message}`)
  return data.map(s => ({ nis: String(s.nis), nama: String(s.nama), kelas: String(s.kelas) }))
}
