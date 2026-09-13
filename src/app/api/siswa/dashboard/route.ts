import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'
import { hitungGrade } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const nis = user.nis!

  const [{ data: nilaiAll }, { data: jadwal }] = await Promise.all([
    db.from('nilai').select('*').eq('nis', nis).order('timestamp', { ascending: false }),
    db.from('jadwal').select('*').eq('kelas', user.kelas!).eq('status', 'AKTIF').order('tanggal').limit(5),
  ])

  // BUG FIX (rekap nilai siswa belum menyesuaikan fitur essay): sama seperti
  // /api/siswa/nilai, kartu statistik dashboard sebelumnya dihitung murni
  // dari `n.nilai` (PG-only). Peta essay-aktif dihitung untuk SELURUH
  // `nilaiAll` (bukan cuma 6 nilai terbaru yang ditampilkan di kartu
  // "Nilai Terbaru") supaya rata-rata/tertinggi/terendah ikut memakai nilai
  // gabungan begitu dirilis.
  //
  // BUG FIX (nilai remedial guru tidak masuk ke akun siswa): `nilaiFinal`
  // sekarang juga mengutamakan nilai_edit (remedial) kalau ada, PERSIS
  // urutan prioritas & alasan di /api/siswa/nilai/route.ts — nilai_total
  // (PG+Essay) tetap tidak dipakai sebelum dirilis, tapi nilai_edit boleh
  // dipakai kapan saja karena itu keputusan final guru.
  const essayAktifMapAll = await petakanEssayAktifPerSesi(db, (nilaiAll ?? []).map(n => n.sesi_id))
  const nilaiFinalUntukSiswa = (n: NonNullable<typeof nilaiAll>[number]) => {
    const essayAktif = n.sesi_id ? (essayAktifMapAll.get(n.sesi_id) ?? false) : false
    const essayDirilis = n.dirilis === true
    const adaRemedial = n.nilai_edit !== null && n.nilai_edit !== undefined
    if (adaRemedial) return n.nilai_edit as number
    return (essayAktif && essayDirilis && n.nilai_total != null) ? n.nilai_total : (n.nilai || 0)
  }
  const nums = (nilaiAll ?? []).map(nilaiFinalUntukSiswa)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  // Enrich nilai with mapel names
  const recentNilai = (nilaiAll ?? []).slice(0, 6)
  const mapelIds = [...new Set(recentNilai.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // FIX (keamanan, sama seperti /api/siswa/nilai): endpoint ini juga
  // mengirim seluruh kolom tabel `nilai` ke client SISWA tanpa mengecek
  // `dirilis`, jadi nilai_essay/nilai_total bisa terlihat di dashboard
  // sebelum guru menekan tombol rilis. Mask sama seperti di
  // /api/siswa/nilai/route.ts.
  const enrichedNilai = recentNilai.map(r => {
    const essayDirilis = r.dirilis === true
    const essayAktif = r.sesi_id ? (essayAktifMapAll.get(r.sesi_id) ?? false) : false
    const adaRemedial = r.nilai_edit !== null && r.nilai_edit !== undefined
    const nilaiEfektifSiswa = (essayAktif && essayDirilis && r.nilai_total != null) ? r.nilai_total : r.nilai
    const nilaiFinal = adaRemedial ? (r.nilai_edit as number) : nilaiEfektifSiswa
    const gradeFinal = adaRemedial
      ? (r.grade_edit ?? hitungGrade(nilaiFinal))
      : (essayDirilis && essayAktif && r.nilai_total != null ? hitungGrade(r.nilai_total) : r.grade)
    const lulusFinal = adaRemedial
      ? (r.lulus_edit ?? (nilaiFinal >= r.kkm))
      : (essayDirilis && essayAktif && r.nilai_total != null ? r.nilai_total >= r.kkm : r.lulus)
    return {
      ...r,
      nilai_essay: essayDirilis ? r.nilai_essay : null,
      nilai_total: essayDirilis ? r.nilai_total : null,
      dinilai_pada: essayDirilis ? r.dinilai_pada : null,
      dinilai_oleh: essayDirilis ? r.dinilai_oleh : null,
      nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
      essay_belum_dirilis: essayAktif && !essayDirilis,
      ada_remedial: adaRemedial,
      nilai_final: nilaiFinal,
      grade_final: gradeFinal,
      lulus_final: lulusFinal,
    }
  })

  // Enrich jadwal
  const jMapelIds = [...new Set((jadwal ?? []).map(j => j.mapel_id).filter(Boolean))]
  const { data: jMapelList } = await db.from('mapel').select('id, nama').in('id', jMapelIds.length ? jMapelIds : ['__'])
  const jMapelMap = Object.fromEntries((jMapelList ?? []).map(m => [m.id, m.nama]))
  const enrichedJadwal = (jadwal ?? []).map(j => ({
    ...j,
    nama_mapel: jMapelMap[j.mapel_id] ?? j.mapel_id,
  }))

  return NextResponse.json({
    stats,
    nilaiTerbaru: enrichedNilai,
    jadwalMendatang: enrichedJadwal,
  })
}
