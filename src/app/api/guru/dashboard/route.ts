import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { hitungGrade } from '@/lib/utils'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = tenantDb(yayasanIdDari(auth.user))
  const guruId = user.username

  // Kartu & diagram donat beranda guru dihitung PER PAKET (bukan per soal),
  // jadi cukup satu query: seluruh paket milik guru ini, terbaru dulu. Hitungan
  // per status diambil dari hasilnya, dan 5 teratas dipakai untuk daftar
  // "Paket Soal Terbaru". Jumlah paket per guru kecil (puluhan), jadi aman.
  const { data: paketGuru } = await db
    .from('paket_soal')
    .select('id, mapel_id, kelas_id, status, tanggal, catatan, jumlah_soal')
    .eq('guru_id', guruId)
    .order('tanggal', { ascending: false })

  const semuaPaket = paketGuru ?? []
  const hitungPaket = (status: string) => semuaPaket.filter(p => p.status === status).length
  const totalPaket = semuaPaket.length
  const paketDisetujui = hitungPaket('DISETUJUI')
  const paketMenunggu = hitungPaket('MENUNGGU')
  const paketDitolak = hitungPaket('DITOLAK')
  const paketDraft = hitungPaket('DRAFT')

  // Enrich paket with mapel & kelas names (semua paket: dipakai juga oleh
  // detail diagram donat saat sebuah segmen diklik).
  const mapelIds = [...new Set(semuaPaket.map(p => p.mapel_id).filter(Boolean))]
  const kelasIds = [...new Set(semuaPaket.map(p => p.kelas_id).filter(Boolean))]
  const [{ data: mapelList }, { data: kelasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__none__']),
    db.from('kelas').select('id, nama').in('id', kelasIds.length ? kelasIds : ['__none__']),
  ])
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, String(k.nama)]))

  const enrichedSemua = semuaPaket.map(p => ({
    ...p,
    nama_mapel: mapelMap[p.mapel_id] ?? p.mapel_id,
    nama_kelas: kelasMap[p.kelas_id] ?? p.kelas_id,
  }))
  const enrichedPaket = enrichedSemua.slice(0, 5)

  // Get nilai for mapels taught by this guru
  const { data: guruMapel } = await db.from('mapel').select('id').eq('guru_id', guruId)
  const mapelGuruIds = (guruMapel ?? []).map(m => m.id)

  // BUG FIX (statistik dashboard tidak konsisten dengan halaman Nilai):
  // sebelumnya query ini pakai .limit(50), lalu limit yang sama itu juga
  // dipakai untuk menghitung stats.totalNilai dan stats.rataRataNilai.
  // Akibatnya begitu guru punya >50 baris nilai, "Rekap Nilai" di dashboard
  // mentok di 50 (padahal jumlah sebenarnya lebih banyak) dan "Rata-rata
  // Nilai" hanya mencerminkan 50 submission TERBARU — bukan rata-rata
  // sesungguhnya — sehingga tidak akan pernah sama dengan angka di halaman
  // /guru/nilai (yang menghitung dari SELURUH data, tanpa limit). Guru bisa
  // mengira datanya hilang atau bingung angka mana yang benar.
  //
  // FIX: ambil SELURUH baris nilai (tanpa limit) untuk keperluan hitung
  // stats, sama seperti /api/guru/nilai. Limit hanya diterapkan belakangan,
  // khusus untuk daftar tampilan "Nilai Terbaru" (nilaiTerbaru) yang memang
  // cuma pratinjau ringkas — tidak memengaruhi angka statistik.
  const { data: nilaiAll } = await db
    .from('nilai')
    .select('nilai, nis, mapel_id, grade, kelas, timestamp, sesi_id, nilai_total, dirilis')
    .in('mapel_id', mapelGuruIds.length ? mapelGuruIds : ['__none__'])
    .order('timestamp', { ascending: false })

  // BUG FIX (rekap nilai guru belum menyesuaikan fitur essay): sama seperti
  // /api/guru/nilai, "Rata-rata Nilai" di dashboard ini sebelumnya dihitung
  // murni dari `nilai` PG-only. Widget "Nilai Terbaru" di bawah juga
  // sebelumnya selalu menampilkan grade/nilai PG walau essay-nya sudah
  // dinilai & dirilis — sekarang keduanya memakai nilai efektif yang sama.
  const essayAktifMap = await petakanEssayAktifPerSesi(db, (nilaiAll ?? []).map(n => n.sesi_id))
  const nilaiEfektif = (n: { sesi_id: string | null; dirilis?: boolean | null; nilai_total?: number | null; nilai: number }) => {
    const essayAktif = n.sesi_id ? (essayAktifMap.get(n.sesi_id) ?? false) : false
    return (essayAktif && n.dirilis === true && n.nilai_total != null) ? n.nilai_total : (n.nilai || 0)
  }

  const rataRataNilai = nilaiAll?.length
    ? Math.round((nilaiAll).reduce((s, r) => s + nilaiEfektif(r), 0) / nilaiAll.length)
    : 0

  // Enrich recent nilai — limit HANYA di sini, untuk widget pratinjau saja.
  const recent = (nilaiAll ?? []).slice(0, 8)
  const nisSet = [...new Set(recent.map(r => r.nis))]
  const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet)
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))

  const nilaiTerbaru = recent.map(r => {
    const efektif = nilaiEfektif(r)
    return {
      ...r,
      nilai: efektif,
      grade: efektif === r.nilai ? r.grade : hitungGrade(efektif),
      nama_siswa: siswaMap[r.nis] ?? r.nis,
      nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
    }
  })

  return NextResponse.json({
    stats: {
      totalPaket,
      paketDisetujui,
      paketMenunggu,
      paketDitolak,
      paketDraft,
      totalNilai: nilaiAll?.length ?? 0,
      rataRataNilai,
    },
    paketTerbaru: enrichedPaket,
    // Seluruh paket (ringkas) untuk detail diagram donat di beranda guru.
    paketSemua: enrichedSemua.map(p => ({
      id: p.id,
      nama_mapel: p.nama_mapel,
      nama_kelas: p.nama_kelas,
      status: p.status,
      jumlah_soal: p.jumlah_soal ?? 0,
      catatan: p.status === 'DITOLAK' ? (p.catatan ?? null) : null,
    })),
    nilaiTerbaru,
  })
}
