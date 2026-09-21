// Taruh di: src/app/api/siswa/ujian/essay/info/route.ts
// GET ?sesiId=... — data untuk halaman info essay (sebelum tombol "Mulai")
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // FIX BUG P0: sertakan paket_essay_id — lihat FIX di essay/soal/route.ts &
  // essay/jawab/route.ts. "Jumlah soal" yang ditampilkan di halaman info ini
  // harus dihitung dari paket yang sama dengan yang benar-benar akan
  // dikerjakan siswa di halaman soal, bukan dihitung ulang dari
  // mapel+kelas+DISETUJUI setiap kali (yang bisa berbeda kalau ada >1 paket
  // DISETUJUI, atau status paket berubah setelah ujian dimulai).
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, status, info_json, akses_mulai_essay_dibuka, paket_essay_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  // FIX BUG (siswa yang sudah menyelesaikan ujian dilempar ke layar fullscreen
  // essay dengan pesan teknis "tidak memiliki soal essay"): kalau siswa ini
  // sendiri sudah berada di status akhir (sudah mengirim essay, atau memang
  // tidak mengerjakan essay karena difinalisasi otomatis), jangan lanjut ke
  // pengecekan essay_aktif sama sekali — beri tahu langsung bahwa ujian sudah
  // selesai. Ini jadi lapis pertahanan kedua; perbaikan utamanya ada di
  // /api/siswa/jadwal (essayPendingByJadwal) yang seharusnya sudah tidak
  // mengarahkan siswa ke sini lagi kalau sesi memang tidak punya essay.
  if (siswaUjian.status_essay === 'SUDAH_KIRIM' || siswaUjian.status_essay === 'TIDAK_MENGERJAKAN') {
    return NextResponse.json(
      { error: 'Ujian ini sudah Anda selesaikan. Silakan kembali ke beranda.', sudahSelesai: true },
      { status: 409 }
    )
  }

  // FIX BUG (pesan teknis membingungkan untuk siswa): sesi yang memang tidak
  // pernah mengaktifkan essay untuk mapel ini seharusnya tidak pernah membuat
  // siswa sampai ke halaman ini (lihat fix di /api/siswa/jadwal). Kalau tetap
  // sampai di sini (mis. navigasi manual/link lama), tetap tolak tapi dengan
  // pesan yang tidak menakut-nakuti siswa yang sebetulnya sudah beres.
  if (!sesi.info_json?.essay_aktif) {
    return NextResponse.json(
      { error: 'Ujian ini tidak memiliki sesi essay. Silakan kembali ke beranda.', sudahSelesai: true },
      { status: 400 }
    )
  }

  // FIX: samakan dengan guard di essay/mulai, essay/soal, essay/jawab, dan
  // essay/upload-foto — sebelumnya endpoint ini TIDAK memeriksa status
  // TERKUNCI/RESET sama sekali, jadi siswa yang sudah dikunci permanen atau
  // sedang menunggu kode reset pengawas tetap bisa mengambil info essay
  // (nama mapel, jumlah soal, durasi, instruksi guru) padahal seharusnya
  // sudah diblokir total, sama seperti endpoint essay lainnya.
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }

  // FIX BUG (essay/info tidak memeriksa status sesi): sebelumnya endpoint ini
  // sama sekali tidak mengecek `sesi.status`, padahal essay/mulai dan
  // essay/soal sudah sama-sama menolak begitu sesi.status !== 'BERJALAN'.
  // Kombinasi ini membuat siswa bisa terjebak: /api/siswa/jadwal (atau
  // navigasi manual dengan sesiId lama) mengarahkannya ke halaman info essay,
  // halaman info berhasil dimuat sepenuhnya (nama mapel, durasi, instruksi),
  // tapi begitu menekan "Mulai" baru ditolak oleh essay/mulai — state ganjil
  // di mana siswa merasa "ujian belum selesai" padahal tidak ada lagi yang
  // bisa dia lakukan. Sekarang ditolak sedini mungkin, di sini, dengan pesan
  // yang jelas kenapa (bukan sekadar gagal diam-diam di tombol Mulai).
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json(
      { error: 'Sesi ujian ini sudah ditutup, fase essay tidak bisa dilanjutkan lagi. Nilai Anda akan diproses oleh sistem/guru.' },
      { status: 409 }
    )
  }

  // Siswa harus sudah submit PG (ditandai status_essay sudah di-set jadi
  // BELUM_MULAI oleh selesai/route.ts) sebelum boleh melihat halaman info essay.
  if (!siswaUjian.status_essay || siswaUjian.status_essay === null) {
    return NextResponse.json({ error: 'Selesaikan soal pilihan ganda terlebih dahulu' }, { status: 403 })
  }

  // FIX BUG P0 (lanjutan): resolusi kelasId hanya dibutuhkan untuk jalur
  // fallback (sesi lama yang belum punya paket_essay_id ter-snapshot).
  const { data: kelasRow } = sesi.paket_essay_id
    ? { data: null }
    : await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX BUG P0: jumlah soal SEKARANG dihitung dari paket_essay_id yang
  // sudah di-snapshot ke sesi ini kalau tersedia — sama persis dengan query
  // yang dipakai essay/soal/route.ts untuk mengambil daftar soalnya, dan
  // essay/mulai/route.ts untuk menghitung jumlahSoalEssay. Sebelumnya di
  // sini SELALU memakai mapel+kelas+DISETUJUI, sehingga kalau ada >1 paket
  // DISETUJUI untuk mapel+kelas yang sama, angka yang ditampilkan di
  // halaman info bisa berbeda dari jumlah soal yang sebenarnya siswa
  // kerjakan (mis. "Jumlah soal: 10" padahal yang benar-benar ditampilkan
  // di halaman soal cuma 5, karena essay/soal sudah membaca paket yang
  // lebih spesifik).
  const jumlahSoalQuery = sesi.paket_essay_id
    ? db.from('soal_essay').select('id', { count: 'exact', head: true }).eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI')
    : db.from('soal_essay').select('id', { count: 'exact', head: true }).eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI')

  const [{ data: jadwal }, { data: mapel }, { count: jumlahSoal }] = await Promise.all([
    db.from('jadwal').select('pengawas').eq('id', sesi.jadwal_id).single(),
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    jumlahSoalQuery,
  ])

  let namaGuru: string | null = null
  if (jadwal?.pengawas) {
    const { data: guru } = await db.from('users').select('nama').eq('username', jadwal.pengawas).single()
    namaGuru = guru?.nama ?? jadwal.pengawas
  }

  return NextResponse.json({
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    namaGuru,
    jumlahSoal: jumlahSoal ?? 0,
    durasiMenit: sesi.info_json.essay_durasi_menit,
    modeJawaban: sesi.info_json.essay_mode_jawaban, // 'DIGITAL' | 'KERTAS'
    instruksi: sesi.info_json.essay_instruksi ?? null,
    statusEssay: siswaUjian.status_essay, // kalau sudah 'MENGERJAKAN', frontend lanjut ke halaman soal, bukan info lagi
    // Toggle global per sesi (lihat 11_akses_mulai_essay.sql) — selama false,
    // tombol "Mulai" di halaman essay siswa harus nonaktif menunggu
    // pengawas membuka akses. Kalau siswa sudah MENGERJAKAN (sudah lolos
    // gerbang ini sebelumnya), field ini tidak lagi relevan buat frontend.
    aksesMulaiDibuka: !!sesi.akses_mulai_essay_dibuka,
  })
}
