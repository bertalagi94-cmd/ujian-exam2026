// Taruh di: src/app/api/siswa/ujian/essay/soal/route.ts
// GET ?sesiId=... — daftar soal essay untuk ditampilkan ke siswa (teks,
// gambar_url, urutan). TIDAK menyertakan bobot_maks/kunci karena essay
// tidak punya kunci otomatis dan bobot adalah rahasia guru.
// Guard: status_essay siswa harus sudah MENGERJAKAN (sudah menekan tombol
// "Mulai" di /api/siswa/ujian/essay/mulai) sebelum boleh mengambil soal ini,
// sama seperti pola guard di essay/info/route.ts.
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

  // FIX BUG P0 (soal yang dikerjakan siswa bisa beda dengan soal yang
  // dinilai guru): sebelumnya endpoint ini TIDAK membaca `paket_essay_id`
  // sama sekali, jadi soal diambil ulang dari mapel+kelas+DISETUJUI setiap
  // request. Kalau ada >1 paket essay DISETUJUI untuk mapel+kelas yang sama,
  // atau guru mengubah status paket SETELAH ujian dimulai, siswa bisa
  // mengerjakan soal yang berbeda dari paket yang sudah di-snapshot ke sesi
  // ini oleh essay/mulai/route.ts — dan guru/koreksi-essay/route.ts sudah
  // lebih dulu memakai snapshot itu. Sekarang disamakan: WAJIB pakai
  // paket_essay_id sesi ini kalau sudah ada.
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json, status, paket_essay_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (!sesi.info_json?.essay_aktif) {
    return NextResponse.json({ error: 'Sesi ini tidak memiliki soal essay' }, { status: 400 })
  }

  // FIX BUG (soal essay bisa diambil walau sesi sudah tidak berjalan):
  // sebelumnya guard di sini hanya mengecek status_essay siswa (di bawah),
  // TIDAK PERNAH mengecek sesi_ujian.status. Kalau siswa sudah berada di
  // status_essay = 'MENGERJAKAN' lalu pengawas menutup sesi (atau sesi
  // ditutup otomatis), endpoint ini masih mengembalikan soal seolah ujian
  // masih berlangsung — tidak konsisten dengan essay/jawab (autosave) dan
  // essay/mulai yang sama-sama menolak begitu sesi.status !== 'BERJALAN'.
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah tidak berjalan.' }, { status: 409 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
  }
  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Sesi essay belum dimulai. Tekan tombol Mulai terlebih dahulu.' }, { status: 403 })
  }

  // FIX BUG P0 (lanjutan): resolusi kelasId HANYA dibutuhkan untuk jalur
  // fallback (sesi lama yang belum punya paket_essay_id ter-snapshot).
  // Kalau sesi sudah punya paket_essay_id, kelasId tidak perlu dihitung
  // sama sekali — query langsung difilter ke paket itu.
  const { data: kelasRow } = sesi.paket_essay_id
    ? { data: null }
    : await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX BUG P0: soal essay yang ditampilkan ke siswa SEKARANG WAJIB berasal
  // dari paket_essay_id yang sudah di-snapshot ke sesi ini (sama persis
  // dengan query yang dipakai essay/mulai/route.ts saat menghitung
  // jumlahSoalEssay, dan guru/koreksi-essay/route.ts saat menilai). Fallback
  // ke mapel_id+kelas_id HANYA untuk sesi lama yang paket_essay_id-nya masih
  // NULL (belum pernah ada siswa yang memulai essay di sesi tsb) — begitu
  // ada satu siswa yang memulai, essay/mulai akan mengunci paket_essay_id-
  // nya, dan siswa berikutnya otomatis lewat jalur snapshot ini juga.
  const soalQuery = sesi.paket_essay_id
    ? db.from('soal_essay').select('id, teks, gambar_url, urutan').eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI')
    : db.from('soal_essay').select('id, teks, gambar_url, urutan').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI')

  const { data: soalList, error } = await soalQuery.order('urutan', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: soalList ?? [] })
}
