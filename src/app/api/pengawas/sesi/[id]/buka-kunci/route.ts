import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { hitungBatasWaktuPg } from '@/lib/deadline-pg'
import { catatAktivitas } from '@/lib/aktivitas'

// POST /api/pengawas/sesi/[id]/buka-kunci
// Body: { nis: string, alasan?: string }
//
// "Izinkan ujian lagi": pengawas membuka kunci permanen siswa (TERKUNCI).
// SANKSI = waktu TIDAK ditambah. siswa_ujian.waktu_mulai_awal (referensi
// timer tunggal) sengaja tidak disentuh, jadi siswa hanya mendapat SISA waktu
// ujian yang berjalan; waktu selama terkunci hangus.
//
// Yang terjadi:
//  1. Nilai 0 akibat penguncian dihapus (belum ada nilai PG) atau, bila PG sudah
//     selesai, nilai PG dihitung ulang dari benar/total asli.
//  2. siswa_ujian -> AKTIF, reset_terpakai 0, waktu_selesai null.
//  3. Pelanggaran lama ditandai DIABAIKAN (BUKAN dihapus) -> riwayat tetap
//     terbaca guru; hitungan level pelanggaran mulai dari awal.
//  4. Satu baris riwayat_buka_kunci dicatat (dibaca guru pengampu & wali kelas).
//
// Ditolak (409) bila: sesi tidak berjalan, siswa tidak terkunci, waktu ujian
// sudah habis, atau nilai asli siswa sudah ikut dinolkan (minta Admin).
const PREFIX_NILAI_NOL_OTOMATIS = 'Ujian dihentikan otomatis karena pelanggaran'
const PREFIX_NILAI_NOL_PG = 'Ujian dihentikan karena pelanggaran'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireRoleAktif(req, ['GURU', 'BK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const sesiId = params.id

  let body: { nis?: string; alasan?: string }
  try { body = await req.json() } catch { body = {} }
  const nis = String(body.nis ?? '').trim()
  const alasan = String(body.alasan ?? '').trim().slice(0, 300)
  if (!nis) return NextResponse.json({ error: 'NISN diperlukan' }, { status: 400 })

  if (auth.user.role !== 'ADMIN') {
    const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
    if (!sah) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian').select('id, status, durasi, mapel_id, kelas').eq('id', sesiId).maybeSingle()
  if (!sesi) return NextResponse.json({ error: 'Sesi ujian tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah tidak berjalan, siswa tidak bisa dibuka kembali.' }, { status: 409 })
  }

  const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).maybeSingle()
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  const { data: su, error: suErr } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal')
    .eq('sesi_id', sesiId).eq('nis', nis).maybeSingle()
  if (suErr) return NextResponse.json({ error: 'Data siswa belum dapat dibaca. Coba lagi.' }, { status: 503 })
  if (!su) return NextResponse.json({ error: 'Siswa belum terdaftar di sesi ini' }, { status: 404 })
  if (su.status !== 'TERKUNCI') {
    return NextResponse.json({ error: `${siswa.nama} tidak sedang terkunci.` }, { status: 409 })
  }

  // Sisa waktu = sisa jadwal ujian siswa ini (tanpa tambahan).
  const batas = hitungBatasWaktuPg(su.waktu_mulai_awal, sesi.durasi)
  const sisaMs = batas ? batas.deadlineMs - Date.now() : 0
  if (!batas || sisaMs <= 60_000) {
    return NextResponse.json(
      { error: `Waktu ujian ${siswa.nama} sudah habis, jadi tidak bisa diizinkan ujian lagi.` },
      { status: 409 }
    )
  }
  const sisaDetik = Math.floor(sisaMs / 1000)

  // Nilai: hanya nilai 0 otomatis (placeholder) yang boleh dihapus.
  const { data: nilaiRow } = await db
    .from('nilai').select('id, nilai, dirilis, dikirim_ke_wali, catatan_guru, benar, total, kkm')
    .eq('sesi_id', sesiId).eq('nis', nis).maybeSingle()
  let nilaiNolDihapus = false
  let nilaiDipulihkan = false
  if (nilaiRow) {
    const catatan = String(nilaiRow.catatan_guru ?? '')
    const belumFinal = !nilaiRow.dirilis && !nilaiRow.dikirim_ke_wali
    const placeholder = Number(nilaiRow.nilai) === 0 && belumFinal && catatan.startsWith(PREFIX_NILAI_NOL_OTOMATIS)
    // Siswa sudah selesai PG lalu terkunci saat essay: nilai PG-nya dinolkan
    // oleh sistem, tapi benar/total/kkm asli tetap tersimpan -> bisa dihitung ulang.
    const pgDinolkan = belumFinal && catatan.startsWith(PREFIX_NILAI_NOL_PG) &&
      Number(nilaiRow.total) > 0 && nilaiRow.kkm != null

    if (placeholder) {
      const { error: delErr } = await db.from('nilai').delete().eq('id', nilaiRow.id)
      if (delErr) return NextResponse.json({ error: 'Gagal membuka kunci. Coba lagi.' }, { status: 500 })
      nilaiNolDihapus = true
    } else if (pgDinolkan) {
      const nilaiPg = Math.round((Number(nilaiRow.benar) / Number(nilaiRow.total)) * 100)
      const gradePg = nilaiPg >= 90 ? 'A' : nilaiPg >= 80 ? 'B' : nilaiPg >= 70 ? 'C' : nilaiPg >= 60 ? 'D' : 'E'
      const { error: updNilaiErr } = await db.from('nilai').update({
        nilai: nilaiPg,
        grade: gradePg,
        lulus: nilaiPg >= Number(nilaiRow.kkm),
        nilai_essay: null,
        nilai_total: null,
        catatan_guru: 'Sempat terkunci karena pelanggaran saat fase essay, lalu diizinkan ujian lagi oleh pengawas. Nilai PG dipulihkan dari jawaban asli.',
      }).eq('id', nilaiRow.id).eq('dikirim_ke_wali', false)
      if (updNilaiErr) return NextResponse.json({ error: 'Gagal membuka kunci. Coba lagi.' }, { status: 500 })
      nilaiDipulihkan = true
    } else {
      const olehAdmin = catatan.startsWith('Dikunci permanen oleh ADMIN')
      return NextResponse.json(
        { error: olehAdmin
            ? `${siswa.nama} dikunci oleh Admin, jadi hanya Admin yang dapat membukanya.`
            : `${siswa.nama} sudah memiliki nilai yang tidak bisa dipulihkan dari sini. Mohon hubungi Admin.` },
        { status: 409 }
      )
    }
  }

  // Salinan pelanggaran untuk riwayat.
  const { data: pel } = await db
    .from('pelanggaran').select('id, jenis, level, created_at')
    .eq('sesi_id', sesiId).eq('nis', nis).neq('status', 'DIABAIKAN')
    .order('created_at', { ascending: true })
  const daftarPel = pel ?? []

  const { count: sebelumnya } = await db
    .from('riwayat_buka_kunci').select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId).eq('nis', nis)

  // Buka kunci (bersyarat: hanya jika masih TERKUNCI -> aman dari klik ganda).
  const { data: dibuka, error: upErr } = await db
    .from('siswa_ujian')
    .update({ status: 'AKTIF', reset_terpakai: 0, reset_gagal: 0, reset_terkunci_sampai: null, waktu_selesai: null })
    .eq('sesi_id', sesiId).eq('nis', nis).eq('status', 'TERKUNCI')
    .select('nis')
  if (upErr) return NextResponse.json({ error: 'Gagal membuka kunci. Coba lagi.' }, { status: 500 })
  if (!dibuka || dibuka.length === 0) {
    return NextResponse.json({ error: `${siswa.nama} sudah dibuka oleh pengawas lain.` }, { status: 409 })
  }

  await db.from('pelanggaran').update({ status: 'DIABAIKAN' })
    .eq('sesi_id', sesiId).eq('nis', nis).neq('status', 'DIABAIKAN')

  const { error: rwErr } = await db.from('riwayat_buka_kunci').insert({
    sesi_id: sesiId,
    nis,
    kelas: sesi.kelas,
    mapel_id: sesi.mapel_id,
    dibuka_oleh: auth.user.username,
    alasan: alasan || null,
    buka_ke: (sebelumnya ?? 0) + 1,
    jumlah_pelanggaran: daftarPel.length,
    rincian_pelanggaran: daftarPel.map(p => ({ jenis: p.jenis, level: p.level, waktu: p.created_at })),
    sisa_detik: sisaDetik,
    nilai_nol_dihapus: nilaiNolDihapus || nilaiDipulihkan,
  })
  if (rwErr) console.error('[buka-kunci] gagal mencatat riwayat:', rwErr.message)

  catatAktivitas(db, auth.user.username, 'BUKA_KUNCI_SISWA',
    `${nis} sesi ${sesiId}, sisa ${Math.floor(sisaDetik / 60)} menit${alasan ? ', alasan: ' + alasan : ''}`)

  return NextResponse.json({
    success: true,
    sisa_menit: Math.floor(sisaDetik / 60),
    message: `${siswa.nama} boleh ujian lagi dengan sisa waktu ${Math.floor(sisaDetik / 60)} menit.`,
  })
}
