import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { cachedFetch } from '@/lib/cache'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ error: 'NIS tidak sesuai' }, { status: 403 })

  // FIX BUG #1b: cek status siswa SEBELUM cek nilai. Sebelumnya endpoint ini
  // hanya peduli "apakah nilai sudah ada?" sehingga siswa yang sudah dikunci
  // Admin (TERKUNCI) atau sedang menunggu kode reset (RESET) tetap bisa submit
  // dan jawabannya tetap dihitung. Sekarang ditolak — kecuali nilai SUDAH ada
  // (misal hasil kunci_permanen) sehingga early-return di bawah tetap berfungsi
  // untuk menampilkan hasil yang sudah final.
  //
  // FIX PERFORMA (load test 25 Jun 2026, 05.37): query ini sebelumnya dipecah
  // jadi 2 round-trip terpisah ke tabel siswa_ujian (satu untuk `status`, satu
  // lagi belakangan untuk `waktu_mulai_awal`). Sekarang digabung jadi SATU
  // query — keduanya dari baris yang sama, tidak ada alasan dipisah.
  const { data: siswaUjianCheck } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (siswaUjianCheck && (siswaUjianCheck.status === 'TERKUNCI' || siswaUjianCheck.status === 'RESET')) {
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, nilai, grade, benar, total, lulus')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (nilaiSudahAda) {
      return NextResponse.json({
        id: nilaiSudahAda.id,
        nilai: nilaiSudahAda.nilai,
        grade: nilaiSudahAda.grade,
        benar: nilaiSudahAda.benar,
        total: nilaiSudahAda.total,
        lulus: nilaiSudahAda.lulus,
      })
    }

    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset. Ujian tidak bisa diselesaikan sekarang.' },
      { status: 403 }
    )
  }

  // Cek dulu apakah sudah pernah submit — early return
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (nilaiExist) {
    return NextResponse.json({
      id: nilaiExist.id,
      nilai: nilaiExist.nilai,
      grade: nilaiExist.grade,
      benar: nilaiExist.benar,
      total: nilaiExist.total,
      lulus: nilaiExist.lulus,
    })
  }

  // FIX PERFORMA (load test 25 Jun 2026, 05.37): data di bawah ini — sesi,
  // ID kelas, KKM mapel, paket soal yang dipakai, jumlah soal, dan kunci semua
  // soal di paket — SAMA untuk SEMUA siswa di sesi ujian yang sama. Sebelumnya
  // semua ini di-query ULANG dari Supabase setiap kali SATU siswa submit.
  // Saat banyak siswa submit hampir bersamaan (mis. mendekati waktu habis),
  // ini jadi puluhan query IDENTIK menghantam DB berbarengan → antrian/kontensi
  // → latency melonjak (load test mencatat respons sampai ~65 detik) →
  // sebagian request timeout/connection drop ("Submit selesai gagal").
  //
  // Sekarang di-cache 5 menit per sesi_id (memakai cachedFetch yang sama
  // dengan src/app/api/public/pengaturan/route.ts) — jadi cuma di-query SEKALI
  // per sesi, dipakai bersama oleh semua siswa yang submit dalam 5 menit itu.
  // Trade-off: kalau admin mengubah paket/kunci soal di tengah sesi berjalan,
  // perubahan baru terasa maks. 5 menit kemudian — sama seperti trade-off yang
  // sudah diterima di endpoint pengaturan.
  const sesiCache = await cachedFetch(`selesai:sesi:${sesiId}`, 300, async () => {
    const { data: sesi } = await db
      .from('sesi_ujian')
      .select('mapel_id, kelas, durasi')
      .eq('id', sesiId)
      .single()
    if (!sesi) return null

    // FIX: sesi.kelas = nama kelas, tapi paket_soal.kelas_id = ID dari tabel kelas
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const [{ data: mapel }, { data: paketData }] = await Promise.all([
      db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
      db.from('paket_soal')
        .select('id, jumlah_soal')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)   // ← FIX: pakai kelasId bukan sesi.kelas
        .eq('status', 'DISETUJUI')
        .limit(1)
        .single(),
    ])

    const [{ count: totalSoalCount }, { data: soalList }] = await Promise.all([
      db.from('soal')
        .select('*', { count: 'exact', head: true })
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketData?.id ?? ''),
      // Ambil kunci SEMUA soal di paket ini sekaligus (bukan per-siswa
      // berdasarkan soal yang dia jawab) — supaya satu hasil cache ini bisa
      // dipakai untuk menghitung nilai siswa MANAPUN di sesi ini, bukan cuma
      // siswa yang memicu query pertama kali.
      db.from('soal')
        .select('id, kunci')
        .eq('mapel_id', sesi.mapel_id)
        .eq('paket_id', paketData?.id ?? '')
        .eq('status', 'DISETUJUI'),
    ])

    return {
      sesi,
      kkm: mapel?.kkm ?? 75,
      totalSoal: totalSoalCount ?? paketData?.jumlah_soal ?? 0,
      kunciMap: Object.fromEntries((soalList ?? []).map(s => [s.id, s.kunci])) as Record<string, string>,
    }
  })

  if (!sesiCache) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  const { sesi, kkm, totalSoal, kunciMap } = sesiCache

  // ── VALIDASI WAKTU SERVER ─────────────────────────────────────────────────
  // Cek apakah submit masih dalam jendela waktu yang sah.
  // waktu_mulai_awal adalah referensi tunggal yang tidak pernah berubah
  // (bahkan setelah reset pelanggaran). Toleransi 60 detik untuk mengakomodasi
  // jeda jaringan wajar saat auto-submit timeout.
  if (siswaUjianCheck?.waktu_mulai_awal && sesi.durasi) {
    const batasWaktu = new Date(siswaUjianCheck.waktu_mulai_awal).getTime() + sesi.durasi * 60 * 1000
    const toleransiMs = 60 * 1000 // 60 detik grace period untuk jeda jaringan
    if (Date.now() > batasWaktu + toleransiMs) {
      return NextResponse.json(
        { error: 'Waktu ujian Anda sudah habis. Jawaban yang sudah tersimpan akan dinilai secara otomatis oleh sistem.' },
        { status: 409 }
      )
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Jawaban siswa ini TETAP harus di-query per-siswa (berbeda untuk tiap
  // siswa, tidak bisa di-cache bersama).
  const { data: jawabanSiswa } = await db
    .from('jawaban').select('soal_id, jawaban').eq('sesi_id', sesiId).eq('nis', nis)

  // Hitung nilai — kunciMap sudah didapat dari cache di atas, tidak perlu
  // query soal lagi di sini.
  let benar = 0
  const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)

  if (jawabanSiswa?.length) {
    for (const j of jawabanSiswa) {
      if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
    }
  }

  const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
  const lulus = nilaiAngka >= kkm

  const nilaiData = {
    id: generateId('NIL'),
    sesi_id: sesiId,
    nis,
    mapel_id: sesi.mapel_id,
    kelas: sesi.kelas,
    benar,
    total,
    nilai: nilaiAngka,
    grade,
    lulus,
    kkm,
    timestamp: new Date().toISOString(),
  }

  // Simpan nilai + update status — PARALEL
  // FIX: pakai upsert+ignoreDuplicates (bukan insert biasa) supaya kalau ada
  // race condition (misal klik 2x atau retry jaringan) tidak menghasilkan
  // error/duplikat baris nilai — konsisten dengan UNIQUE(sesi_id, nis) di skema.
  await Promise.all([
    db.from('nilai').upsert(nilaiData, { onConflict: 'sesi_id,nis', ignoreDuplicates: true }),
    db.from('siswa_ujian')
      .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
      .eq('sesi_id', sesiId)
      .eq('nis', nis),
  ])

  // FIX: ignoreDuplicates berarti kalau ada race (klik 2x / retry jaringan)
  // dan baris untuk (sesi_id, nis) ini SUDAH ada duluan dari request lain,
  // insert kita di-skip diam-diam — nilaiData.id yang kita generate di atas
  // BUKAN id yang benar-benar tersimpan di tabel. Ambil ulang id sebenarnya
  // supaya link "lihat rincian" yang dikirim ke client selalu valid.
  const { data: nilaiTersimpan } = await db
    .from('nilai')
    .select('id')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()
  const nilaiIdFinal = nilaiTersimpan?.id ?? nilaiData.id

  return NextResponse.json({ id: nilaiIdFinal, nilai: nilaiAngka, grade, benar, total, lulus })
}
