import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { verifySesiOwnership } from '@/lib/sesi-ownership'

// Fungsi generate kode reset 7 digit alfanumerik unik untuk siswa
function generateKodeReset(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// POST /api/pengawas/sesi/[id]/reset-siswa
// Body: { nis: string }
// Reset status siswa yang di-reset agar harus memasukkan kode 7 digit untuk masuk lagi
// Jawaban TIDAK dihapus
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id
  const { nis } = await req.json()

  if (!nis) return NextResponse.json({ error: 'NIS diperlukan' }, { status: 400 })

  // FIX: sebelumnya endpoint ini hanya mengecek role (GURU/ADMIN), tidak
  // mengecek apakah guru pemanggil memang pengawas sesi ini — sehingga guru
  // mana pun bisa mereset (atau bahkan mengunci permanen + nilai 0) siswa di
  // sesi ujian guru lain kalau memanggil API ini langsung. ADMIN tetap tidak
  // dibatasi.
  if (auth.user.role === 'GURU') {
    const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
    if (!sah) {
      return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
    }
  }

  // Ambil batasPelanggaran dari tabel pengaturan (default 3 jika tidak ada)
  const { data: settingData } = await db
    .from('pengaturan')
    .select('value')
    .eq('key', 'batasPelanggaran')
    .single()

  const batasPelanggaran = parseInt(settingData?.value ?? '3', 10) || 3

  // Ambil data siswa
  const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  // FIX BUG (kunci permanen prematur — siswa baru 1x melanggar tapi
  // langsung dikunci & diklaim "sudah 3 kali"): sebelumnya baris di bawah
  // ini menghitung `resetCount` dari tabel `log_reset`, memfilter lewat
  // `alasan LIKE 'sesi:${sesiId}%'`. Masalahnya, `log_reset` BUKAN tabel
  // khusus riwayat pelanggaran — tabel ini juga ketambahan baris dari aksi
  // admin lain di sesi yang sama (bypass_reset, reset_semua, kunci_permanen
  // — lihat src/app/api/admin/pelanggaran/route.ts), yang semuanya memakai
  // pola `alasan` yang sama sehingga ikut ke-hitung oleh LIKE di atas
  // walau BUKAN pelanggaran sungguhan. Akibatnya: kalau pengawas/admin
  // pernah pakai "Reset Semua Pelanggaran" 1-2 kali di sesi itu (misalnya
  // untuk membatalkan pelanggaran yang salah deteksi), riwayat di tabel
  // `pelanggaran` sudah bersih (0 baris) tapi `log_reset` tetap menyimpan
  // jejaknya — sehingga pelanggaran PERTAMA yang benar-benar terjadi
  // setelah itu bisa langsung membuat hitungan mencapai batasPelanggaran
  // dan mengunci siswa permanen di pelanggaran ke-1 yang sesungguhnya.
  //
  // Sekarang: hitung LANGSUNG dari tabel `pelanggaran` (sumber kebenaran
  // satu-satunya untuk "berapa kali siswa ini benar-benar melanggar di
  // sesi ini"), bukan dari log_reset. Endpoint /api/siswa/ujian/pelanggaran
  // sudah menetapkan `level` = urutan pelanggaran saat insert, jadi begitu
  // pengawas menindaklanjuti pelanggaran TERBARU, count baris pelanggaran
  // untuk sesi+nis ini SUDAH SAMA DENGAN level pelanggaran itu sendiri —
  // tidak perlu +1 lagi seperti perhitungan resetCount yang lama.
  const { count: jumlahPelanggaran } = await db
    .from('pelanggaran')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .neq('status', 'DIABAIKAN')

  const levelPelanggaranSaatIni = jumlahPelanggaran ?? 0

  // Jika jumlah pelanggaran ASLI siswa ini di sesi ini sudah mencapai
  // batasPelanggaran → langsung kunci permanen / nilai 0.
  if (levelPelanggaranSaatIni >= batasPelanggaran) {
    // Set status TERKUNCI permanen + tandai pelanggaran sudah ditindak (FIX BUG #1)
    await Promise.all([
      db.from('siswa_ujian')
        .update({ status: 'TERKUNCI' })
        .eq('sesi_id', sesiId)
        .eq('nis', nis),
      db.from('pelanggaran')
        .update({ status: 'SUDAH_DITINDAKLANJUTI' })
        .eq('sesi_id', sesiId)
        .eq('nis', nis)
        .eq('status', 'BELUM_DITINDAKLANJUTI'),
    ])

    // Simpan nilai 0 jika belum ada
    const { data: nilaiExist } = await db
      .from('nilai')
      .select('id')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (!nilaiExist) {
      const { data: sesi } = await db
        .from('sesi_ujian')
        .select('mapel_id, kelas')
        .eq('id', sesiId)
        .single()

      if (sesi) {
        const { data: mapel } = await db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single()
        await db.from('nilai').insert({
          id: generateId('NIL'),
          sesi_id: sesiId,
          nis,
          mapel_id: sesi.mapel_id,
          kelas: sesi.kelas,
          benar: 0,
          total: 0,
          nilai: 0,
          grade: 'E',
          lulus: false,
          kkm: mapel?.kkm ?? 75,
          timestamp: new Date().toISOString(),
        })

        // FIX BUG (status TERKUNCI tertimpa jadi SELESAI): sebelumnya baris ini
        // meng-update `status: 'SELESAI'`, menimpa `status: 'TERKUNCI'` yang
        // baru saja di-set di Promise.all() di atas. Akibatnya:
        //   - Polling client (cekStatusSesi di siswa/ujian/page.tsx) HANYA
        //     bereaksi pada siswa_status === 'TERKUNCI' (untuk menampilkan
        //     layar "Ujian Dihentikan") — status 'SELESAI' di level SISWA
        //     tidak ditangani sama sekali (yang dicek untuk 'SELESAI' adalah
        //     sesi_status, bukan siswa_status), jadi siswa yang seharusnya
        //     dikeluarkan permanen tetap melihat halaman ujian seperti biasa.
        //   - Guard di /api/siswa/ujian/sync ("TERKUNCI"/"RESET") ikut tidak
        //     berlaku lagi karena status sudah bukan TERKUNCI, sehingga siswa
        //     yang seharusnya terkunci masih bisa terus mengirim jawaban.
        // Sama seperti endpoint ADMIN (/api/admin/pelanggaran, action
        // kunci_permanen) yang sudah benar: JANGAN ubah status di sini,
        // cukup catat waktu selesainya saja — status tetap 'TERKUNCI'.
        await db.from('siswa_ujian')
          .update({ waktu_selesai: new Date().toISOString() })
          .eq('sesi_id', sesiId)
          .eq('nis', nis)
      }
    }

    return NextResponse.json({
      dikunci_permanen: true,
      jumlah_pelanggaran: levelPelanggaranSaatIni,
      message: `${siswa.nama} telah melanggar ${levelPelanggaranSaatIni} kali. Siswa di-logout permanen dan nilai menjadi 0.`,
    })
  }

  // Generate kode reset 7 digit unik untuk siswa ini
  const kodeReset = generateKodeReset()

  // Hapus kode reset lama yang belum digunakan untuk siswa ini
  await db.from('log_reset')
    .delete()
    .eq('nis', nis)
    .eq('digunakan', false)

  // Simpan kode reset baru di log_reset
  await db.from('log_reset').insert({
    nis,
    reset_oleh: auth.user?.username ?? 'pengawas',
    alasan: `sesi:${sesiId} — Reset karena pelanggaran`,
    password_baru: kodeReset,
    digunakan: false,
  })

  // Set status siswa ke RESET (harus memasukkan kode untuk lanjut)
  // FIX BUG #1: penindakan oleh Pengawas/Guru sebelumnya tidak pernah menandai
  // pelanggaran.status jadi SUDAH_DITINDAKLANJUTI (hanya endpoint admin yang
  // melakukan ini). Akibatnya menu Admin selalu menampilkan "belum ditindak"
  // walau siswa sudah di-reset dan lanjut ujian. Disamakan dengan endpoint admin.
  await Promise.all([
    db.from('siswa_ujian')
      .update({ status: 'RESET' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis),
    db.from('pelanggaran')
      .update({ status: 'SUDAH_DITINDAKLANJUTI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .eq('status', 'BELUM_DITINDAKLANJUTI'),
  ])

  return NextResponse.json({
    dikunci_permanen: false,
    kode_reset: kodeReset,
    nama_siswa: siswa.nama,
    reset_ke: levelPelanggaranSaatIni,
    batasPelanggaran,
    message: `Siswa ${siswa.nama} di-reset (${levelPelanggaranSaatIni}/${batasPelanggaran}). Berikan kode ${kodeReset} kepada siswa untuk melanjutkan ujian.`,
  })
}
