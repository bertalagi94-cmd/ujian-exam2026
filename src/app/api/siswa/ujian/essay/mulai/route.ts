// Taruh di: src/app/api/siswa/ujian/essay/mulai/route.ts
// POST { sesiId } — mulai timer essay (idempotent: kalau sudah MENGERJAKAN, kembalikan waktu_mulai_essay yang sudah ada, jangan reset timer)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, waktu_mulai_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }

  if (siswaUjian.status_essay === 'SUDAH_KIRIM' || siswaUjian.status_essay === 'TIDAK_MENGERJAKAN') {
    return NextResponse.json({ error: 'Essay sudah selesai dikerjakan' }, { status: 409 })
  }

  // Idempotent: kalau sudah pernah mulai (mis. refresh halaman), JANGAN reset
  // waktu_mulai_essay — ini referensi timer yang tidak boleh berubah, sama
  // seperti pola waktu_mulai_awal untuk PG.
  if (siswaUjian.status_essay === 'MENGERJAKAN' && siswaUjian.waktu_mulai_essay) {
    return NextResponse.json({ waktuMulaiEssay: siswaUjian.waktu_mulai_essay })
  }

  // Gerbang toggle "Akses Soal Essay" (lihat 11_akses_mulai_essay.sql) —
  // dicek ULANG di server (bukan cuma disabled di tombol UI) supaya tidak
  // bisa di-bypass dengan memanggil endpoint ini langsung sebelum pengawas
  // menyalakan aksesnya.
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('status, akses_mulai_essay_dibuka, mapel_id, kelas')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // FIX BUG (essay bisa dimulai walau sesi sudah ditutup): sebelumnya
  // endpoint ini hanya mengecek status siswa (TERKUNCI/RESET) dan gerbang
  // akses_mulai_essay_dibuka, TIDAK PERNAH mengecek sesi_ujian.status.
  // Padahal endpoint autosave (essay/jawab/route.ts) dan endpoint soal
  // (essay/soal/route.ts — lihat fix terkait di bawah) sama-sama menolak
  // kalau sesi.status !== 'BERJALAN'. Akibatnya siswa bisa mendapat
  // status_essay = 'MENGERJAKAN' + waktu_mulai_essay untuk sesi yang
  // sebenarnya sudah ditutup (SELESAI/dibatalkan), lalu macet total karena
  // tidak bisa autosave/kirim jawaban sama sekali. Sekarang dicek di sini
  // juga, konsisten dengan endpoint lain.
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json(
      { error: 'Sesi ujian sudah tidak berjalan, essay tidak bisa dimulai.' },
      { status: 409 }
    )
  }

  if (!sesi.akses_mulai_essay_dibuka) {
    return NextResponse.json(
      { error: 'Menunggu pengawas membuka akses mulai essay.' },
      { status: 403 }
    )
  }

  // FIX BUG P2 (essay bisa dimulai walau 0 soal DISETUJUI): endpoint toggle
  // (guru/mode-pengawas/toggle-akses-mulai-essay/route.ts) memang menolak
  // MENYALAKAN akses_mulai_essay_dibuka kalau soal DISETUJUI untuk mapel+
  // kelas ini masih 0 — tapi itu hanya dicek SEKALI saat toggle dinyalakan.
  // Kalau guru menghapus/membatalkan approval SEMUA soal essay SETELAH
  // toggle sudah menyala (mis. sedang direvisi ulang), sesi tetap punya
  // akses_mulai_essay_dibuka = true sementara soalnya sudah kosong — tanpa
  // pertahanan kedua di sini, siswa tetap lolos ke status MENGERJAKAN lalu
  // terjebak di halaman essay kosong (tidak ada soal untuk dikerjakan,
  // hanya bisa menekan Selesai/Kirim tanpa jawaban apa pun). Cek ulang
  // jumlah soal DISETUJUI persis sebelum mengizinkan status MENGERJAKAN,
  // sama seperti resolusi kelasId di endpoint essay lain (info/soal/
  // koreksi-essay).
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  const { count: jumlahSoalEssay } = await db
    .from('soal_essay')
    .select('id', { count: 'exact', head: true })
    .eq('mapel_id', sesi.mapel_id)
    .eq('kelas_id', kelasId)
    .eq('status', 'DISETUJUI')

  if (!jumlahSoalEssay || jumlahSoalEssay === 0) {
    return NextResponse.json(
      { error: 'Belum ada soal essay yang disetujui untuk mapel ini. Hubungi guru/pengawas Anda.' },
      { status: 409 }
    )
  }

  // FIX (race condition kecil): tambahkan guard .eq('status_essay', ...) yang
  // sebelumnya tidak ada — kalau dua request /mulai nyaris bersamaan lolos
  // pengecekan idempotent di atas bersamaan (baca status_essay yang sama-sama
  // masih BELUM_MULAI SEBELUM salah satu sempat menulis), keduanya akan
  // menulis waktu_mulai_essay masing-masing dengan selisih milidetik — siapa
  // yang menulis TERAKHIR yang menang, walau keduanya "berhasil" dari sisi
  // response masing-masing. Guard ini membuat HANYA update yang baris
  // status_essay-nya BENAR-BENAR masih BELUM_MULAI (atau null, untuk data
  // lama) yang benar-benar mengubah baris; kita cek `count`/`data` hasil
  // update untuk tahu apakah update ini yang "menang". Dampaknya tetap
  // sangat kecil (beda milidetik), tapi sekarang deterministik: request yang
  // kalah akan mengambil ulang waktu_mulai_essay yang sudah tersimpan,
  // bukan menimpanya.
  const waktuMulaiEssay = new Date().toISOString()
  const { data: updated, error } = await db
    .from('siswa_ujian')
    .update({ status_essay: 'MENGERJAKAN', waktu_mulai_essay: waktuMulaiEssay })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .or('status_essay.eq.BELUM_MULAI,status_essay.is.null')
    .select('waktu_mulai_essay')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!updated || updated.length === 0) {
    // Request ini kalah race — baris sudah diubah request lain barusan.
    // Ambil ulang waktu_mulai_essay yang sebenarnya tersimpan supaya timer
    // di client tetap konsisten dengan server.
    const { data: siswaUjianTerbaru } = await db
      .from('siswa_ujian')
      .select('waktu_mulai_essay')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .single()
    return NextResponse.json({ waktuMulaiEssay: siswaUjianTerbaru?.waktu_mulai_essay ?? waktuMulaiEssay })
  }

  return NextResponse.json({ waktuMulaiEssay: updated[0].waktu_mulai_essay })
}
