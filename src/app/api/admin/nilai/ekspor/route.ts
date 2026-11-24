// /api/admin/nilai/ekspor — data untuk fitur "Unduh Massal Hasil Ujian" (admin).
//
// GET  : daftar kombinasi KELAS × MAPEL yang sudah punya nilai (= mapel yang sudah
//        diujikan), lengkap dengan jumlah siswa. Dipakai untuk menampilkan pilihan.
// POST : { kelas, mapel_nama } → seluruh baris nilai untuk SATU kombinasi tsb
//        (tanpa pagination). Klien memanggilnya satu per satu untuk tiap kombinasi
//        yang dipilih, lalu menyusun file Excel/ZIP di browser.
//
// Hanya ADMIN (bukan KEPSEK/guru). Siswa tester tidak ikut diekspor.
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'
import { catatAktivitas } from '@/lib/aktivitas'

export const dynamic = 'force-dynamic'

const UKURAN_HALAMAN = 1000   // batas baris per request bawaan database
const BATAS_BARIS = 100_000   // pengaman kalau data tak wajar besar
const UKURAN_POTONGAN = 150   // ukuran daftar untuk filter .in(...) agar URL tidak kepanjangan

function potong<T>(arr: T[], ukuran: number): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

// Membaca semua baris hasil query yang dibatasi 1000 baris per request.
async function ambilSemua(
  buat: (dari: number, sampai: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
): Promise<{ rows: any[]; error?: string }> {
  const rows: any[] = []
  for (let dari = 0; dari < BATAS_BARIS; dari += UKURAN_HALAMAN) {
    const { data, error } = await buat(dari, dari + UKURAN_HALAMAN - 1)
    if (error) return { rows, error: error.message }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < UKURAN_HALAMAN) break
  }
  return { rows }
}

async function nisTester(db: any): Promise<Set<string>> {
  const { data } = await db.from('siswa').select('nis').eq('is_tester', 'YES')
  return new Set((data ?? []).map((s: any) => String(s.nis)))
}

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db: any = tenantDb(yayasanIdDari(auth.user))

  const [nilai, mapelRes, tester] = await Promise.all([
    ambilSemua((d, s) => db.from('nilai').select('id, kelas, mapel_id, nis').order('id').range(d, s)),
    db.from('mapel').select('id, nama'),
    nisTester(db),
  ])
  if (nilai.error) return NextResponse.json({ error: nilai.error }, { status: 500 })
  if (mapelRes.error) return NextResponse.json({ error: mapelRes.error.message }, { status: 500 })

  const namaMapel = new Map<string, string>((mapelRes.data ?? []).map((m: any) => [String(m.id), String(m.nama)]))

  const peta = new Map<string, { kelas: string; mapel_nama: string; jumlah: number }>()
  for (const r of nilai.rows) {
    if (!r.kelas || !r.mapel_id || tester.has(String(r.nis))) continue
    const nama = namaMapel.get(String(r.mapel_id))
    if (!nama) continue // mapel sudah dihapus: tidak bisa diberi nama, lewati
    const kunci = `${r.kelas}\u0000${nama}`
    const ada = peta.get(kunci)
    if (ada) ada.jumlah++
    else peta.set(kunci, { kelas: String(r.kelas), mapel_nama: nama, jumlah: 1 })
  }

  const data = [...peta.values()].sort((a, b) =>
    a.kelas.localeCompare(b.kelas, 'id', { numeric: true }) ||
    a.mapel_nama.localeCompare(b.mapel_nama, 'id', { numeric: true })
  )
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db: any = tenantDb(yayasanIdDari(auth.user))

  let body: { kelas?: unknown; mapel_nama?: unknown; catat?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }
  const kelas = typeof body.kelas === 'string' ? body.kelas.trim() : ''
  const mapelNama = typeof body.mapel_nama === 'string' ? body.mapel_nama.trim() : ''
  if (!kelas || !mapelNama || kelas.length > 100 || mapelNama.length > 200) {
    return NextResponse.json({ error: 'kelas dan mapel_nama diperlukan' }, { status: 400 })
  }

  // Satu nama mapel bisa punya beberapa mapel_id (diampu beberapa guru) — ambil semuanya.
  const { data: mapelRows, error: errMapel } = await db.from('mapel').select('id, nama').eq('nama', mapelNama)
  if (errMapel) return NextResponse.json({ error: errMapel.message }, { status: 500 })
  const mapelIds = (mapelRows ?? []).map((m: any) => String(m.id))
  if (mapelIds.length === 0) return NextResponse.json({ data: [] })

  const nilai = await ambilSemua((d, s) =>
    db.from('nilai').select('*').eq('kelas', kelas).in('mapel_id', mapelIds).order('id').range(d, s)
  )
  if (nilai.error) return NextResponse.json({ error: nilai.error }, { status: 500 })
  if (nilai.rows.length === 0) return NextResponse.json({ data: [] })

  // Nama siswa (+ buang tester)
  const nisUnik = [...new Set(nilai.rows.map((r: any) => String(r.nis)))]
  const namaSiswa = new Map<string, string>()
  const tester = new Set<string>()
  for (const bagian of potong(nisUnik, UKURAN_POTONGAN)) {
    const { data, error } = await db.from('siswa').select('nis, nama, is_tester').in('nis', bagian)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const s of data ?? []) {
      namaSiswa.set(String(s.nis), String(s.nama))
      if (s.is_tester === 'YES') tester.add(String(s.nis))
    }
  }

  // Apakah sesi ini punya essay aktif (pakai helper yang sama dengan Rekap Nilai)
  const sesiUnik = [...new Set(nilai.rows.map((r: any) => r.sesi_id).filter(Boolean))] as string[]
  const essayAktif = new Map<string, boolean>()
  for (const bagian of potong(sesiUnik, UKURAN_POTONGAN)) {
    const peta = await petakanEssayAktifPerSesi(db, bagian)
    peta.forEach((v, k) => essayAktif.set(k, v))
  }

  const data = nilai.rows
    .filter((r: any) => !tester.has(String(r.nis)))
    .map((r: any) => ({
      nis: String(r.nis),
      nama_siswa: namaSiswa.get(String(r.nis)) ?? String(r.nis),
      kelas: String(r.kelas),
      nama_mapel: mapelNama,
      benar: r.benar ?? null,
      total: r.total ?? null,
      nilai: r.nilai ?? null,
      grade: r.grade ?? null,
      kkm: r.kkm ?? null,
      timestamp: r.timestamp ?? null,
      essay_aktif: r.sesi_id ? (essayAktif.get(r.sesi_id) ?? false) : false,
      nilai_essay: r.nilai_essay ?? null,
      nilai_total: r.nilai_total ?? null,
      dirilis: r.dirilis === true,
      nilai_edit: r.nilai_edit ?? null,
      grade_edit: r.grade_edit ?? null,
    }))
    .sort((a: any, b: any) => a.nama_siswa.localeCompare(b.nama_siswa, 'id'))

  // Jejak audit: cukup satu catatan per unduhan (klien mengirim catat:true pada
  // kombinasi pertama saja), bukan satu per kombinasi.
  if (body.catat === true) {
    catatAktivitas(db, auth.user.username, 'UNDUH_NILAI_MASSAL', 'Admin memulai unduh massal hasil ujian siswa')
  }

  return NextResponse.json({ data })
}
