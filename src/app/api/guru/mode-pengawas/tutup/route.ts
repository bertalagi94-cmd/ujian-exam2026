import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { finalisasiNilaiPaksa } from '@/lib/finalisasi-nilai'
import { adaSesiBerjalanLain } from '@/lib/sesi-utama'
import { setelahSesiDitutup } from '@/lib/ruang-khusus'

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU', 'BK'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { sesiId } = await req.json()

  // FIX: sebelumnya endpoint ini hanya mengecek role GURU, tidak mengecek
  // apakah guru pemanggil memang pengawas sesi ini — sehingga guru mana pun
  // bisa menutup (dan memicu auto-grade) sesi ujian milik guru lain kalau
  // memanggil API ini langsung.
  const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
  if (!sah) {
    return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('jadwal_id, status')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // FIX (audit: tidak ada cek status saat tutup sesi): sebelumnya sesi yang
  // sudah SELESAI tetap diproses ulang — `waktu_selesai` ditimpa dengan waktu
  // sekarang (menggeser jendela jawaban susulan dan jejak waktu tutup), dan
  // jadwal/siswa diubah lagi. Sama seperti admin/sesi/[id]/tutup-paksa: hanya
  // sesi BERJALAN yang boleh ditutup. Kalau penutupan sebelumnya gagal
  // sebagian (respons 207), pemulihannya lewat Finalisasi Ulang di menu Admin.
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ini sudah tidak berstatus BERJALAN (mungkin sudah ditutup).' }, { status: 409 })
  }

  // FIX (hasil update database tidak pernah diperiksa): sebelumnya endpoint
  // ini sama sekali tidak membaca `error` dari update sesi_ujian, jadwal,
  // maupun siswa_ujian, dan hasil finalisasiNilaiPaksa juga tidak dicek —
  // selalu membalas "Sesi berhasil ditutup" apapun yang sebenarnya terjadi
  // di database. Pola & alasan sama persis dengan perbaikan di
  // admin/sesi/[id]/tutup-paksa/route.ts (lihat komentar di sana) — endpoint
  // ini bahkan lebih sering dipakai (penutupan sesi normal oleh pengawas),
  // jadi risikonya lebih sering terpapar.
  // Update bersyarat `.eq('status', 'BERJALAN')` + `.select('id')`: kalau dua
  // permintaan tutup (mis. dobel klik, atau pengawas dan admin bersamaan) tiba
  // hampir serentak, hanya satu yang benar-benar mengubah baris; yang kalah
  // mendapat 409 dan tidak menjalankan finalisasi kedua kali.
  const { data: sesiTertutup, error: errUpdateSesi } = await db.from('sesi_ujian').update({
    status: 'SELESAI',
    waktu_selesai: new Date().toISOString(),
  }).eq('id', sesiId).eq('status', 'BERJALAN').select('id')

  if (errUpdateSesi) {
    return NextResponse.json(
      { error: `Gagal menutup sesi: ${errUpdateSesi.message}` },
      { status: 500 }
    )
  }
  if (!sesiTertutup || sesiTertutup.length === 0) {
    return NextResponse.json({ error: 'Sesi ini sudah tidak berstatus BERJALAN (mungkin sudah ditutup).' }, { status: 409 })
  }

  let peringatan: string[] = []

  // Sesi ruang khusus: lepas siswa yang tidak pernah masuk, tutup ruang bila sesi terakhir.
  await setelahSesiDitutup(db, sesiId)

  // Status jadwal baru SELESAI kalau tidak ada sesi lain (kelas ATAU ruang
  // khusus) yang masih BERJALAN untuk jadwal ini. Tanpa syarat ini, menutup
  // sesi kelas membuat siswa ruang khusus yang belum masuk melihat "ujian
  // ditutup" (halaman siswa menyaring berdasarkan jadwal.status).
  if (sesi.jadwal_id) {
    let masihAdaSesi = false
    try { masihAdaSesi = await adaSesiBerjalanLain(db, sesi.jadwal_id, sesiId) }
    catch (e) { peringatan.push(`Gagal memeriksa sesi lain pada jadwal ini: ${e instanceof Error ? e.message : String(e)}`); masihAdaSesi = true }
    if (!masihAdaSesi) {
      const { error: errJadwal } = await db.from('jadwal').update({ status: 'SELESAI' }).eq('id', sesi.jadwal_id)
      if (errJadwal) {
        peringatan.push(`Sesi berhasil ditutup, tapi status jadwal gagal diperbarui: ${errJadwal.message}`)
      }
    }
  }

  // FIX: sebelumnya siswa yang statusnya AKTIF/RESET saat sesi ditutup paksa
  // (mis. jaringan mati total sampai waktu habis, tidak pernah sempat
  // memanggil /api/siswa/ujian/selesai sendiri) hanya diubah statusnya jadi
  // SELESAI di bawah ini — TIDAK PERNAH mendapat baris di tabel `nilai`,
  // sehingga hilang dari rekap nilai guru/wali kelas tanpa jejak yang jelas.
  // Sekarang: catat dulu NIS siswa yang masih AKTIF/RESET (sebelum diupdate),
  // baru setelah statusnya diubah, hitung & simpan nilai otomatis mereka dari
  // jawaban yang sempat tersinkron ke server — lihat src/lib/finalisasi-nilai.ts.
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

  // FIX: tambahkan 'RESET' agar siswa yang sedang di-reset juga ikut diselesaikan
  const { error: errUpdateSiswa } = await db.from('siswa_ujian')
    .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
    .eq('sesi_id', sesiId)
    .in('status', ['AKTIF', 'RESET'])   // ← FIX: was .eq('status', 'AKTIF')

  if (errUpdateSiswa) {
    return NextResponse.json({
      message: 'Sesi berhasil ditutup, TAPI gagal mengubah status siswa yang masih AKTIF/RESET — finalisasi nilai TIDAK dijalankan untuk mereka. Cek manual di halaman koreksi/nilai untuk sesi ini.',
      error: errUpdateSiswa.message,
      peringatan,
    }, { status: 207 })
  }

  const nisPerluDinilai = (siswaBelumSelesai ?? []).map(s => s.nis)
  const hasilFinalisasi = await finalisasiNilaiPaksa(db, sesiId, nisPerluDinilai)

  if (!hasilFinalisasi.ok) {
    return NextResponse.json({
      message: `Sesi & status siswa berhasil ditutup, TAPI finalisasi nilai otomatis GAGAL untuk ${nisPerluDinilai.length} siswa. Nilai mereka HARUS diinput/diperiksa manual — jangan anggap sudah selesai.`,
      error: hasilFinalisasi.error,
      jumlahSiswaSeharusnyaDinilai: nisPerluDinilai.length,
      peringatan,
    }, { status: 207 })
  }

  return NextResponse.json({
    message: peringatan.length ? 'Sesi berhasil ditutup, dengan catatan.' : 'Sesi berhasil ditutup',
    jumlahSiswaDinilaiOtomatis: hasilFinalisasi.jumlahDinilai,
    peringatan: peringatan.length ? peringatan : undefined,
  })
}
