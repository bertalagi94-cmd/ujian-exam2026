/**
 * Memastikan setiap nama kelas yang dipakai siswa punya baris di tabel `kelas`.
 *
 * Latar belakang: `siswa.kelas` adalah teks bebas, sedangkan scope Kepsek/Guru
 * (src/lib/kepsek-scope.ts, guru-scope.ts) mengambil daftar kelas dari tabel
 * `kelas` lewat `sekolah_id`. Import Excel dulu hanya menulis ke `siswa`, jadi
 * siswa yang masuk lewat import tidak pernah cocok dengan baris `kelas` mana
 * pun dan tidak terlihat oleh Kepsek/Guru sama sekali.
 *
 * Aturan di sini:
 *   - Nama dibandingkan tanpa peduli huruf besar/kecil dan spasi ganda.
 *   - Kalau kelas sudah ada, pakai ejaan yang sudah tersimpan di tabel `kelas`.
 *   - Kalau belum ada, buat baris baru dengan nama huruf besar (sama seperti
 *     tambah siswa manual).
 *   - `sekolah_id` baris baru diisi otomatis HANYA kalau yayasan punya tepat
 *     satu sekolah. Kalau lebih dari satu, dibiarkan kosong (admin harus
 *     menetapkannya di menu Kelas) dan dilaporkan lewat `tanpaSekolah`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateId } from '@/lib/utils'

type AnyClient = SupabaseClient<any>

/** Rapikan nama kelas: trim, spasi ganda jadi satu, huruf besar. */
export function rapikanNamaKelas(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export interface HasilPastikanKelas {
  /** kunci (hasil rapikanNamaKelas) -> nama kelas yang dipakai di tabel `kelas` */
  peta: Map<string, string>
  /** nama kelas yang baru dibuat */
  dibuat: string[]
  /** subset `dibuat` yang sekolah_id-nya kosong (yayasan multi-sekolah) */
  tanpaSekolah: string[]
}

/**
 * @param db  client hasil tenantDb(yayasanId) — wajib ber-scope yayasan.
 * @param namaMentah  nama kelas apa adanya dari input (boleh ada duplikat/kosong).
 */
export async function pastikanKelasAda(
  db: AnyClient,
  namaMentah: unknown[]
): Promise<HasilPastikanKelas> {
  const peta = new Map<string, string>()
  const diminta = [...new Set(namaMentah.map(rapikanNamaKelas).filter(Boolean))]
  if (diminta.length === 0) return { peta, dibuat: [], tanpaSekolah: [] }

  const { data: ada, error: errKelas } = await db.from('kelas').select('nama')
  if (errKelas) throw new Error(`Gagal memuat daftar kelas: ${errKelas.message}`)

  for (const row of (ada ?? []) as { nama: string }[]) {
    const kunci = rapikanNamaKelas(row.nama)
    // Kalau ada beberapa ejaan untuk kunci yang sama, utamakan yang sudah huruf besar.
    if (!peta.has(kunci) || row.nama === kunci) peta.set(kunci, row.nama)
  }

  const belum = diminta.filter((k) => !peta.has(k))
  if (belum.length === 0) return { peta, dibuat: [], tanpaSekolah: [] }

  const { data: sekolah, error: errSekolah } = await db.from('sekolah').select('id')
  if (errSekolah) throw new Error(`Gagal memuat daftar sekolah: ${errSekolah.message}`)
  const sekolahId: string | null = sekolah?.length === 1 ? String(sekolah[0].id) : null

  const baris = belum.map((nama) => ({
    id: generateId('KLS'),
    nama,
    jurusan: '-',
    wali_kelas: null,
    jumlah: 0,
    sekolah_id: sekolahId,
  }))

  // ignoreDuplicates: kalau request lain keburu membuat kelas yang sama,
  // lewati saja (unique index yayasan_id+nama), bukan error.
  const { error: errInsert } = await db
    .from('kelas')
    .upsert(baris, { onConflict: 'yayasan_id,nama', ignoreDuplicates: true })
  if (errInsert) throw new Error(`Gagal membuat kelas baru: ${errInsert.message}`)

  for (const nama of belum) peta.set(nama, nama)

  return { peta, dibuat: belum, tanpaSekolah: sekolahId ? [] : belum }
}

/** Pesan peringatan untuk admin kalau ada kelas baru tanpa sekolah. */
export function pesanKelasTanpaSekolah(namaKelas: string[]): string {
  return (
    `Kelas baru dibuat otomatis tanpa sekolah: ${namaKelas.join(', ')}. ` +
    `Yayasan ini punya lebih dari satu sekolah, jadi tentukan sekolahnya di menu Kelas. ` +
    `Sebelum itu, Kepsek dan Guru belum bisa melihat siswa di kelas tersebut.`
  )
}
