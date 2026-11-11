import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'
import { hitungGrade } from '@/lib/utils'
import { saringJadwalSeagama, ambilInfoMapelBanyak } from '@/lib/agama'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = tenantDb(yayasanIdDari(auth.user))
  const nis = user.nis!

  const [{ data: nilaiAll }, { data: jadwalKelas }] = await Promise.all([
    db.from('nilai').select('*').eq('nis', nis).order('timestamp', { ascending: false }),
    db.from('jadwal').select('*').eq('kelas', user.kelas!).eq('status', 'AKTIF').order('tanggal').limit(5),
  ])
  // HEMAT QUERY: dulu ada TIGA query `mapel` terpisah untuk id yang hampir sama
  // (agama utk penyaringan jadwal, nama utk nilai terbaru, nama utk jadwal) dan
  // semuanya berurutan. Sekarang SATU query (nama + agama) untuk gabungan id nilai
  // terbaru + jadwal, dijalankan BERSAMAAN dengan peta essay-aktif (keduanya
  // tidak saling bergantung). Hasil identik; request ke Supabase berkurang 2.
  const recentNilai = (nilaiAll ?? []).slice(0, 6)
  const [infoMapel, essayAktifMapAll] = await Promise.all([
    ambilInfoMapelBanyak(db, [
      ...recentNilai.map(r => r.mapel_id),
      ...(jadwalKelas ?? []).map(j => j.mapel_id),
    ]),
    // BUG FIX (rekap nilai siswa belum menyesuaikan fitur essay): peta essay-aktif
    // dihitung untuk SELURUH `nilaiAll` (bukan cuma 6 nilai terbaru) supaya
    // rata-rata/tertinggi/terendah ikut memakai nilai gabungan begitu dirilis.
    petakanEssayAktifPerSesi(db, (nilaiAll ?? []).map(n => n.sesi_id)),
  ])
  const namaMapel = (id: string | null | undefined) => (id ? infoMapel.get(id)?.nama || id : id)

  // Jadwal mapel khusus agama lain tidak ditampilkan di dashboard siswa ini.
  const jadwal = jadwalKelas ? await saringJadwalSeagama(db, jadwalKelas, nis, infoMapel) : jadwalKelas

  // BUG FIX (rekap nilai siswa belum menyesuaikan fitur essay): sama seperti
  // /api/siswa/nilai, kartu statistik dashboard sebelumnya dihitung murni
  // dari `n.nilai` (PG-only). Peta essay-aktif (essayAktifMapAll, dihitung di
  // atas untuk SELURUH `nilaiAll`) dipakai di sini.
  //
  // BUG FIX (nilai remedial guru tidak masuk ke akun siswa): `nilaiFinal`
  // sekarang juga mengutamakan nilai_edit (remedial) kalau ada, PERSIS
  // urutan prioritas & alasan di /api/siswa/nilai/route.ts — nilai_total
  // (PG+Essay) tetap tidak dipakai sebelum dirilis, tapi nilai_edit boleh
  // dipakai kapan saja karena itu keputusan final guru.
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

  // Enrich nilai with mapel names (dari infoMapel di atas — tanpa query tambahan)

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
      nama_mapel: namaMapel(r.mapel_id),
      essay_belum_dirilis: essayAktif && !essayDirilis,
      ada_remedial: adaRemedial,
      nilai_final: nilaiFinal,
      grade_final: gradeFinal,
      lulus_final: lulusFinal,
    }
  })

  // Enrich jadwal (nama dari infoMapel yang sama)
  const enrichedJadwal = (jadwal ?? []).map(j => ({
    ...j,
    nama_mapel: namaMapel(j.mapel_id),
  }))

  return NextResponse.json({
    stats,
    nilaiTerbaru: enrichedNilai,
    jadwalMendatang: enrichedJadwal,
  })
}
