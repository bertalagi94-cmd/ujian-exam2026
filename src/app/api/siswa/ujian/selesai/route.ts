import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { ambilDataSesiUntukPenilaian, hitungHasilPenilaian } from '@/lib/penilaian-ujian'

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
  // FIX (fitur essay): tambah status_essay ke select supaya kita tahu, di
  // SEMUA jalur (early-return maupun jalur submit baru), apakah siswa ini
  // masih perlu diarahkan ke fase essay sebelum nilai PG-nya boleh dibuka.
  const { data: siswaUjianCheck } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal, status_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  // FIX (kkm hilang di response duplikat/early-return — ditemukan dari 2 load
  // test terpisah, 56+7 kejadian): sesiCache di bawah sebelumnya baru diambil
  // SETELAH kedua early-return ini, jadi kalau siswa memanggil endpoint ini
  // lagi untuk sesi yang SAMA (submit ganda, retry jaringan, refresh halaman
  // hasil), response-nya kehilangan field `kkm` walau field lain (nilai,
  // grade, lulus, dst) tetap ada — client yang menampilkan KKM di halaman
  // hasil jadi menampilkan undefined. Diambil di sini (SEBELUM early-return)
  // supaya kkm selalu konsisten ada di response, di jalur manapun. Aman untuk
  // performa: ini query yang sama yang sudah di-cache 5 menit per sesi_id
  // (lihat komentar "FIX PERFORMA" di bawah), jadi memindahkannya ke sini
  // tidak menambah beban — cache-nya tetap dipakai bersama oleh semua siswa.
  const sesiCache = await ambilDataSesiUntukPenilaian(db, sesiId)
  const kkmUntukEarlyReturn = sesiCache?.kkm ?? 75

  // FIX (fitur essay): sesi punya essay kalau info_json.essay_aktif = true
  // (disalin dari jadwal saat sesi dibuka — lihat 07_essay.sql &
  // HANDOFF.md poin 1). Dipakai di SEMUA jalur di bawah untuk memutuskan
  // apakah nilai PG boleh langsung dibuka atau harus menunggu essay dikirim.
  const essayAktif = !!sesiCache?.sesi?.info_json?.essay_aktif

  // Helper: apakah fase essay siswa ini sudah "selesai" (sudah kirim, atau
  // ditandai tidak mengerjakan oleh guru)? Kalau ya, nilai PG boleh dibuka
  // di jalur early-return (mis. refresh halaman hasil setelah essay dikirim).
  const essaySudahSelesai = (statusEssay: string | null | undefined) =>
    statusEssay === 'SUDAH_KIRIM' || statusEssay === 'TIDAK_MENGERJAKAN'

  if (siswaUjianCheck && (siswaUjianCheck.status === 'TERKUNCI' || siswaUjianCheck.status === 'RESET')) {
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, nilai, grade, benar, total, lulus')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (nilaiSudahAda) {
      // FIX (fitur essay): kalau sesi ini punya essay dan siswa belum
      // menyelesaikan fase essay, JANGAN buka nilai PG — arahkan ke fase
      // essay dulu (sesuai desain: nilai baru tampil setelah essay dikirim).
      if (essayAktif && !essaySudahSelesai(siswaUjianCheck.status_essay)) {
        return NextResponse.json({ id: nilaiSudahAda.id, lanjutEssay: true, kkm: kkmUntukEarlyReturn })
      }
      return NextResponse.json({
        id: nilaiSudahAda.id,
        nilai: nilaiSudahAda.nilai,
        grade: nilaiSudahAda.grade,
        benar: nilaiSudahAda.benar,
        total: nilaiSudahAda.total,
        lulus: nilaiSudahAda.lulus,
        kkm: kkmUntukEarlyReturn,
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
    // FIX (fitur essay): sama seperti early-return TERKUNCI/RESET di atas —
    // kalau essay masih menggantung, jangan bocorkan nilai PG di sini.
    if (essayAktif && !essaySudahSelesai(siswaUjianCheck?.status_essay)) {
      return NextResponse.json({ id: nilaiExist.id, lanjutEssay: true, kkm: kkmUntukEarlyReturn })
    }
    return NextResponse.json({
      id: nilaiExist.id,
      nilai: nilaiExist.nilai,
      grade: nilaiExist.grade,
      benar: nilaiExist.benar,
      total: nilaiExist.total,
      lulus: nilaiExist.lulus,
      kkm: kkmUntukEarlyReturn,
    })
  }

  // (sesiCache sudah diambil di atas, sebelum kedua early-return, supaya
  // field `kkm` tersedia konsisten di semua jalur response — lihat komentar
  // FIX di atas. Query & cache-nya sama seperti sebelumnya, cuma dipindah.)
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
  const { benar, total, nilai: nilaiAngka, grade, lulus } = hitungHasilPenilaian(jawabanSiswa, kunciMap, totalSoal, kkm)

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

  // FIX (fitur essay): kalau sesi ini punya essay, JANGAN tandai siswa_ujian
  // SELESAI di sini — siswa harus melalui fase essay dulu. Fase essay yang
  // akan menandai status = SELESAI (lihat src/app/api/siswa/ujian/essay/kirim/route.ts).
  // Di sini kita hanya menandai status_essay = BELUM_MULAI supaya endpoint
  // .../essay/info tahu siswa sudah boleh melihat halaman info essay.
  const updateSiswaUjian = essayAktif
    ? { status_essay: 'BELUM_MULAI' }
    : { status: 'SELESAI', waktu_selesai: new Date().toISOString() }

  // Simpan nilai + update status — PARALEL
  // FIX: pakai upsert+ignoreDuplicates (bukan insert biasa) supaya kalau ada
  // race condition (misal klik 2x atau retry jaringan) tidak menghasilkan
  // error/duplikat baris nilai — konsisten dengan UNIQUE(sesi_id, nis) di skema.
  await Promise.all([
    db.from('nilai').upsert(nilaiData, { onConflict: 'sesi_id,nis', ignoreDuplicates: true }),
    db.from('siswa_ujian')
      .update(updateSiswaUjian)
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

  // FIX (fitur essay): kalau sesi punya essay, JANGAN kirim nilai/grade/lulus
  // ke client sekarang — sesuai desain, nilai PG baru boleh tampil setelah
  // essay dikirim (lihat .../essay/kirim/route.ts). Cukup beri sinyal
  // `lanjutEssay` supaya frontend redirect ke halaman info essay.
  if (essayAktif) {
    return NextResponse.json({ id: nilaiIdFinal, lanjutEssay: true, kkm })
  }

  // FIX: sertakan `kkm` di response — sebelumnya tidak dikirim ke client,
  // jadi halaman hasil ujian siswa tidak bisa menampilkan KKM atau menjelaskan
  // dengan jelas kenapa siswa dinyatakan lulus/tidak lulus.
  return NextResponse.json({ id: nilaiIdFinal, nilai: nilaiAngka, grade, benar, total, lulus, kkm })
}
