import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { data, error } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', user.kelas!)
    .order('tanggal', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) {
    // FIX: sertakan zonaWaktu juga di jalur ini, biar frontend tetap
    // konsisten memakai zona waktu sekolah walau jadwalnya kosong.
    const zonaKosong = await getZonaWaktuSekolah()
    return NextResponse.json({ data: [], zonaWaktu: { utcOffsetJam: zonaKosong.utcOffsetJam } })
  }

  const mapelIds = [...new Set(data.map(j => j.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // Cek apakah siswa ini SUDAH mengikuti (sudah submit jawaban) untuk
  // masing-masing jadwal — supaya kartu jadwalnya bisa langsung tampilkan
  // hasilnya, bukan cuma status sesi (yang masih "Berjalan" selama pengawas
  // belum menutup sesi, padahal siswa ini sendiri sudah selesai).
  const jadwalIds = data.map(j => j.id)
  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id')
    .in('jadwal_id', jadwalIds)

  const sesiIds = (sesiList ?? []).map(s => s.id)
  const sesiToJadwal = Object.fromEntries((sesiList ?? []).map(s => [s.id, s.jadwal_id]))

  let nilaiByJadwal: Record<string, { id: string }> = {}
  if (sesiIds.length > 0) {
    const { data: nilaiList } = await db
      .from('nilai')
      .select('id, sesi_id')
      .in('sesi_id', sesiIds)
      .eq('nis', user.nis!)

    for (const n of nilaiList ?? []) {
      const jadwalId = sesiToJadwal[n.sesi_id]
      if (jadwalId) nilaiByJadwal[jadwalId] = { id: n.id }
    }
  }

  // FIX (fitur essay): sebelumnya `sudah_ikut` HANYA berdasarkan ada/tidaknya
  // baris `nilai` — tapi sejak fitur essay, baris `nilai` (PG) sudah dibuat
  // SAAT PG disubmit walau siswa belum menyelesaikan fase essay (lihat
  // src/app/api/siswa/ujian/selesai/route.ts). Tanpa fix ini, begitu siswa
  // submit PG lalu me-refresh browser SEBELUM mengirim essay, jadwal ini
  // langsung dianggap "sudah diikuti" dan hilang dari daftar ujian hari ini —
  // siswa terjebak tanpa jalan kembali ke fase essay-nya (karena endpoint
  // /validasi menolak re-entry begitu baris nilai ada). Di sini kita cari
  // tahu, untuk tiap jadwal, apakah ada sesi dengan status_essay yang MASIH
  // menggantung (BELUM_MULAI/MENGERJAKAN) — kalau ada, sertakan sesiId-nya
  // supaya frontend bisa langsung melompat ke halaman essay tanpa kode ujian.
  const essayPendingByJadwal: Record<string, string> = {}
  if (sesiIds.length > 0) {
    const { data: siswaUjianEssayList } = await db
      .from('siswa_ujian')
      .select('sesi_id, status_essay')
      .in('sesi_id', sesiIds)
      .eq('nis', user.nis!)
    for (const su of siswaUjianEssayList ?? []) {
      if (su.status_essay === 'BELUM_MULAI' || su.status_essay === 'MENGERJAKAN') {
        const jadwalId = sesiToJadwal[su.sesi_id]
        if (jadwalId) essayPendingByJadwal[jadwalId] = su.sesi_id
      }
    }
  }

  // FIX: sinkronkan status — jadwal yang tanggalnya sudah lewat tapi masih AKTIF
  // di-override ke SELESAI agar konsisten dengan tampilan guru
  const zona = await getZonaWaktuSekolah()
  const today = tanggalHariIni(zona)

  return NextResponse.json({
    data: data.map(j => {
      const tanggal = j.tanggal?.slice(0, 10) ?? j.tanggal
      // Override status jika tanggal sudah lewat dan status masih AKTIF
      const status = (j.status === 'AKTIF' && tanggal < today) ? 'SELESAI' : j.status
      const hasilSiswa = nilaiByJadwal[j.id] ?? null
      const sesiIdEssayPending = essayPendingByJadwal[j.id] ?? null
      return {
        ...j,
        status,                                          // ← FIX
        nama_mapel: mapelMap[j.mapel_id] ?? j.mapel_id,
        // Diisi kalau siswa ini sudah submit jawaban untuk jadwal ini —
        // dipakai di UI untuk menampilkan "Anda sudah mengikuti ujian ini"
        // + link ke menu Nilai, alih-alih cuma status sesi yang masih
        // "Berjalan" sampai pengawas menutupnya. Nilai/benar-salah SENGAJA
        // tidak diulang di sini — sudah ada di menu Nilai, biar tidak dobel.
        sudah_ikut: !!hasilSiswa && !sesiIdEssayPending,
        nilai_id: hasilSiswa?.id ?? null,
        // FIX (fitur essay): lihat komentar di atas.
        essayPending: !!sesiIdEssayPending,
        sesiIdEssayPending,
      }
    }),
    // FIX: kirim zona waktu sekolah ke client — sebelumnya tidak pernah
    // dikirim, sehingga frontend selalu fallback ke WIB (+7) walaupun
    // sekolah sebenarnya WITA (+8) / WIT (+9). Akibatnya, tepat setelah
    // tengah malam di zona WITA/WIT, siswa melihat jadwal hari ini sebagai
    // "jadwal terdekat" (mendatang) alih-alih "hari ini", padahal pengawas
    // (yang menghitung dengan zona asli) sudah bisa membuka sesinya.
    zonaWaktu: { utcOffsetJam: zona.utcOffsetJam },
  })
}
