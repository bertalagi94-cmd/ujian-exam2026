import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { finalisasiNilaiPaksa } from '@/lib/finalisasi-nilai'

interface Ctx { params: { id: string } }

// POST /api/admin/sesi/[id]/tutup-paksa
//
// GAP YANG DIPERBAIKI: sebelumnya HANYA pengawas asli (atau pengawas susulan
// yang ditugaskan admin) yang bisa menutup sesi ujian — lewat
// POST /api/guru/mode-pengawas/tutup (lihat verifySesiOwnership di sana).
// Kalau sesi lupa/tidak ditutup berjam-jam bahkan sampai besok (mis. pengawas
// sakit, lupa, atau sudah tidak bisa dihubungi), TIDAK ADA cara bagi admin
// untuk menutupnya lewat UI — sesi tetap berstatus BERJALAN selamanya, dan
// ini pada gilirannya memblokir fitur admin lain (restore, ganti pengaturan
// batas-submit, dll — lihat masing-masing endpoint) karena semuanya menolak
// beroperasi selama ada sesi_ujian berstatus BERJALAN.
//
// Endpoint ini memberi admin jalan keluar: menutup sesi APAPUN secara paksa,
// dengan logika finalisasi nilai yang SAMA PERSIS dengan penutupan oleh
// pengawas (siswa yang masih AKTIF/RESET dinilai otomatis dari jawaban yang
// sempat tersinkron — lihat src/lib/finalisasi-nilai.ts), supaya tidak ada
// siswa yang hilang dari rekap nilai tanpa jejak.
//
// FIX (hasil update database tidak pernah diperiksa): sebelumnya SETIAP
// `.update(...)` di endpoint ini (sesi_ujian, jadwal, siswa_ujian) dipanggil
// tanpa membaca `error` sama sekali, dan hasil `finalisasiNilaiPaksa(...)`
// juga tidak pernah dicek — endpoint SELALU membalas "berhasil" ke admin
// apapun yang sebenarnya terjadi di database. Skenario nyata yang bisa
// terjadi: sesi_ujian & siswa_ujian berhasil diubah jadi SELESAI, tapi
// finalisasiNilaiPaksa gagal menyimpan baris `nilai` (mis. gangguan jaringan
// ke Supabase) — siswa jadi "SELESAI" tanpa nilai, hilang dari rekap tanpa
// ada yang tahu. Sekarang setiap langkah tulis diperiksa error-nya, dan
// response ke admin mencerminkan apa yang BENAR-BENAR berhasil — bukan
// transactional penuh (di luar scope perubahan minimal ini, perlu SQL
// function/RPC untuk itu), tapi setidaknya admin tidak lagi dibohongi oleh
// pesan sukses palsu.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id

  const { data: sesi, error: errSesiFetch } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, status, mapel_id, kelas, waktu_mulai, info_json')
    .eq('id', sesiId)
    .single()

  if (errSesiFetch || !sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ini sudah tidak berstatus BERJALAN' }, { status: 400 })
  }

  const { error: errUpdateSesi } = await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
    // Digabung dengan info_json yang sudah ada (mis. pengawas_susulan untuk
    // sesi susulan) — jangan sampai penutupan paksa ini menghapus jejak data
    // lain yang sudah tersimpan di sesi ini. Ditandai eksplisit ini
    // penutupan paksa oleh admin (bukan pengawas), supaya kalau perlu
    // ditelusuri nanti jelas kenapa sesi ini berakhir tanpa pengawas
    // menutupnya sendiri.
    info_json: {
      ...(sesi.info_json ?? {}),
      ditutup_paksa_oleh_admin: auth.user.username,
      ditutup_paksa_pada: new Date().toISOString(),
    },
  }).eq('id', sesiId)

  // FIX: kalau langkah PALING PENTING ini (menutup sesi) gagal, hentikan di
  // sini dan laporkan apa adanya — melanjutkan ke langkah berikutnya
  // (menutup siswa & finalisasi nilai) untuk sesi yang gagal ditutup hanya
  // akan menciptakan data tidak konsisten yang lebih membingungkan.
  if (errUpdateSesi) {
    return NextResponse.json(
      { error: `Gagal menutup sesi: ${errUpdateSesi.message}` },
      { status: 500 }
    )
  }

  let peringatan: string[] = []

  if (sesi.jadwal_id) {
    const { error: errJadwal } = await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
    // FIX: sesi sudah terlanjur SELESAI di atas — kalau update jadwal ini
    // gagal, itu tidak seserius kegagalan finalisasi nilai (jadwal murni
    // metadata tampilan), jadi tetap lanjut, tapi peringatannya dilaporkan
    // ke admin alih-alih didiamkan seperti sebelumnya.
    if (errJadwal) {
      peringatan.push(`Sesi berhasil ditutup, tapi status jadwal gagal diperbarui: ${errJadwal.message}`)
    }
  }

  // Sama seperti /api/guru/mode-pengawas/tutup: siswa yang masih AKTIF/RESET
  // saat sesi ditutup paksa harus tetap dinilai dari jawaban yang sempat
  // tersinkron, bukan dibiarkan menggantung tanpa baris nilai.
  const { data: siswaBelumSelesai, error: errFetchSiswa } = await db
    .from('siswa_ujian')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  if (errFetchSiswa) {
    return NextResponse.json({
      message: 'Sesi berhasil ditutup, TAPI gagal mengambil daftar siswa yang belum selesai — finalisasi nilai TIDAK dijalankan. Cek manual di halaman koreksi/nilai untuk sesi ini.',
      error: errFetchSiswa.message,
      peringatan,
    }, { status: 207 })
  }

  const { error: errUpdateSiswa } = await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])

  if (errUpdateSiswa) {
    return NextResponse.json({
      message: 'Sesi berhasil ditutup, TAPI gagal mengubah status siswa yang masih AKTIF/RESET — finalisasi nilai TIDAK dijalankan untuk mereka. Cek manual di halaman koreksi/nilai untuk sesi ini.',
      error: errUpdateSiswa.message,
      peringatan,
    }, { status: 207 })
  }

  const nisPerluDinilai = (siswaBelumSelesai ?? []).map(s => s.nis)
  const hasilFinalisasi = await finalisasiNilaiPaksa(db, sesiId, nisPerluDinilai)

  // FIX: hasil finalisasi sekarang benar-benar diperiksa. Kalau gagal, admin
  // diberi tahu secara eksplisit (status 207 — sebagian berhasil) alih-alih
  // dibohongi dengan pesan sukses seperti sebelumnya, supaya bisa segera
  // ditindaklanjuti manual (lihat halaman koreksi nilai untuk sesi ini).
  if (!hasilFinalisasi.ok) {
    return NextResponse.json({
      message: `Sesi & status siswa berhasil ditutup, TAPI finalisasi nilai otomatis GAGAL untuk ${nisPerluDinilai.length} siswa. Nilai mereka HARUS diinput/diperiksa manual — jangan anggap sudah selesai.`,
      error: hasilFinalisasi.error,
      jumlahSiswaSeharusnyaDinilai: nisPerluDinilai.length,
      peringatan,
    }, { status: 207 })
  }

  return NextResponse.json({
    message: peringatan.length
      ? 'Sesi berhasil ditutup paksa oleh admin, dengan catatan.'
      : 'Sesi berhasil ditutup paksa oleh admin',
    jumlahSiswaDinilaiOtomatis: hasilFinalisasi.jumlahDinilai,
    peringatan: peringatan.length ? peringatan : undefined,
  })
}
