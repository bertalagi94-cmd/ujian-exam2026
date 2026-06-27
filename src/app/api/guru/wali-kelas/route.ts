import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/guru/wali-kelas
// Body: { aksi: 'kembalikan', nilai_id: string, catatan?: string }
// Wali kelas mengembalikan nilai ke guru pengampu untuk direvisi
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()
  const { aksi, nilai_id, catatan } = body as { aksi: string; nilai_id: string; catatan?: string }

  if (aksi !== 'kembalikan') {
    return NextResponse.json({ error: 'Aksi tidak dikenali' }, { status: 400 })
  }

  // Verifikasi guru ini adalah wali kelas dari kelas yang berkaitan
  const { data: kelasWali } = await db
    .from('kelas')
    .select('id, nama')
    .eq('wali_kelas', user.username)
    .single()

  if (!kelasWali) {
    return NextResponse.json({ error: 'Anda bukan wali kelas' }, { status: 403 })
  }

  // Ambil nilai dan pastikan nilai ini milik kelas yang diwali
  const { data: nilaiRow } = await db
    .from('nilai')
    .select('id, kelas, dikirim_ke_wali')
    .eq('id', nilai_id)
    .single()

  if (!nilaiRow || nilaiRow.kelas !== kelasWali.nama) {
    return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
  }

  if (!nilaiRow.dikirim_ke_wali) {
    return NextResponse.json({ error: 'Nilai belum dikirim oleh guru' }, { status: 400 })
  }

  const { error } = await db
    .from('nilai')
    .update({
      dikirim_ke_wali: false,
      dikembalikan: true,
      catatan_guru: catatan ?? null,
      dikirim_at: null,
    })
    .eq('id', nilai_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Nilai berhasil dikembalikan ke guru untuk direvisi' })
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const guruUsername = user.username

  // Cek apakah guru ini adalah wali kelas (ada di kolom wali_kelas di tabel kelas)
  const { data: kelasWali, error: kelasError } = await db
    .from('kelas')
    .select('*')
    .eq('wali_kelas', guruUsername)
    .single()

  if (kelasError || !kelasWali) {
    return NextResponse.json({ isWaliKelas: false, kelas: null, mapelList: [], siswaList: [], nilaiRekap: [] })
  }

  const kelasId = kelasWali.id
  // Kolom `siswa.kelas`, `jadwal.kelas`, dan `nilai.kelas` menyimpan NAMA kelas
  // (bukan id), sesuai dengan cara insert di admin/siswa/route.ts (kelas: kelasNama).
  // Gunakan kelasWali.nama agar query menghasilkan data yang benar.
  const kelasNama = kelasWali.nama

  // Ambil semua siswa di kelas ini — selalu ambil, meski belum ada mapel
  const { data: siswaList } = await db
    .from('siswa')
    .select('nis, nama, status')
    .eq('kelas', kelasNama)
    .eq('status', 'AKTIF')
    .order('nama')

  const totalSiswa = siswaList?.length ?? 0

  // ─────────────────────────────────────────────────────────────────────────
  // PERBAIKAN:
  // Sebelumnya daftar mapel diambil HANYA dari tabel `kelas_mapel`, yang
  // ternyata hanya pernah diisi lewat fitur Import/Restore (lihat
  // scripts/import-data.js, admin/import, admin/restore). Saat admin
  // membuat jadwal ujian secara normal lewat menu "Jadwal Ujian"
  // (POST /api/admin/jadwal), baris `kelas_mapel` TIDAK pernah dibuat.
  // Akibatnya halaman Wali Kelas selalu menunjukkan "0 mata pelajaran"
  // meskipun jadwal ujian & nilai siswa sudah ada di database.
  //
  // Fix: turunkan daftar mapel langsung dari tabel `jadwal` dan `nilai`
  // untuk kelas ini (sumber data yang sebenarnya selalu terisi pada flow
  // normal), lalu ambil nama mapel dari tabel `mapel`. Tabel `kelas_mapel`
  // tetap dipakai sebagai tambahan (kalau ada, misal dari hasil import)
  // supaya tidak menghilangkan data lama, tapi BUKAN lagi satu-satunya
  // sumber.
  // ─────────────────────────────────────────────────────────────────────────

  // Ambil jadwal ujian untuk kelas ini (sumber utama mapel yang "aktif")
  const { data: jadwalList } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', kelasNama)
    .order('tanggal', { ascending: true })

  // Ambil nilai untuk semua siswa di kelas ini (sumber utama mapel yang sudah diujikan)
  // Ambil semua kolom yang dibutuhkan termasuk info pengiriman
  const { data: nilaiList } = await db
    .from('nilai')
    .select('id, nis, mapel_id, nilai, grade, lulus, sesi_id, timestamp, nilai_edit, grade_edit, lulus_edit, dikirim_ke_wali, dikirim_at, dikembalikan, catatan_guru')
    .eq('kelas', kelasNama)

  // Ambil relasi kelas_mapel kalau ada (kompatibilitas dengan data hasil import lama)
  const { data: kelasMapelList } = await db
    .from('kelas_mapel')
    .select('*')
    .eq('kelas_id', kelasId)

  // Gabungkan semua kemungkinan sumber mapel_id menjadi satu set unik
  const mapelIdSet = new Set<string>()
  ;(jadwalList ?? []).forEach((j: { mapel_id: string }) => j.mapel_id && mapelIdSet.add(j.mapel_id))
  ;(nilaiList ?? []).forEach((n: { mapel_id: string }) => n.mapel_id && mapelIdSet.add(n.mapel_id))
  ;(kelasMapelList ?? []).forEach((km: { mapel_id: string }) => km.mapel_id && mapelIdSet.add(km.mapel_id))

  const mapelIds = Array.from(mapelIdSet)

  // Belum ada mapel sama sekali (tidak ada jadwal, nilai, maupun kelas_mapel)
  if (mapelIds.length === 0) {
    const nilaiRekapKosong = (siswaList ?? []).map(s => ({ nis: s.nis, nama: s.nama }))
    return NextResponse.json({
      isWaliKelas: true,
      kelas: kelasWali,
      mapelList: [],
      siswaList: siswaList ?? [],
      nilaiRekap: nilaiRekapKosong,
    })
  }

  // Ambil nama mapel dari tabel master `mapel`
  const { data: mapelMasterList } = await db
    .from('mapel')
    .select('id, nama')
    .in('id', mapelIds)

  const mapelNamaMap = new Map<string, string>()
  ;(mapelMasterList ?? []).forEach((m: { id: string; nama: string }) => mapelNamaMap.set(m.id, m.nama))
  // Fallback ke nama_mapel dari kelas_mapel kalau master mapel tidak ketemu (data lama/import)
  ;(kelasMapelList ?? []).forEach((km: { mapel_id: string; nama_mapel?: string }) => {
    if (!mapelNamaMap.has(km.mapel_id) && km.nama_mapel) mapelNamaMap.set(km.mapel_id, km.nama_mapel)
  })

  // Per mapel: hitung sudah berapa yang ujian, belum siapa, status kirim
  const mapelEnriched = mapelIds.map(mapelId => {
    // Cari jadwal terkait mapel ini
    const jadwalMapel = (jadwalList ?? []).filter((j: { mapel_id: string }) => j.mapel_id === mapelId)
    const lastJadwal = jadwalMapel[jadwalMapel.length - 1] ?? null

    // Cari nilai untuk mapel ini
    const nilaiMapel = (nilaiList ?? []).filter((n: { mapel_id: string }) => n.mapel_id === mapelId)
    const sudahUjian = new Set(nilaiMapel.map((n: { nis: string }) => n.nis))

    // Siswa yang belum ujian
    const belumUjian = (siswaList ?? []).filter((s: { nis: string }) => !sudahUjian.has(s.nis))

    const rataRata = nilaiMapel.length
      ? Math.round(nilaiMapel.reduce((s: number, r: { nilai: number }) => s + (r.nilai || 0), 0) / nilaiMapel.length)
      : null

    // Status pengiriman: berapa sudah dikirim, berapa belum
    const sudahDikirim = nilaiMapel.filter((n: { dikirim_ke_wali: boolean }) => n.dikirim_ke_wali).length
    const adaDikembalikan = nilaiMapel.some((n: { dikembalikan: boolean }) => n.dikembalikan)

    return {
      mapel_id: mapelId,
      nama_mapel: mapelNamaMap.get(mapelId) ?? mapelId,
      jadwal: lastJadwal,
      sudahUjian: sudahUjian.size,
      totalSiswa,
      belumUjianSiswa: belumUjian.map((s: { nis: string; nama: string }) => ({ nis: s.nis, nama: s.nama })),
      rataRata,
      nilaiList: nilaiMapel,
      // Info pengiriman
      totalNilai: nilaiMapel.length,
      sudahDikirim,
      adaDikembalikan,
    }
  })

  // Rekap nilai per siswa per mapel (untuk tabel)
  // PENTING: di halaman wali kelas, hanya tampilkan nilai yang sudah dikirim guru (dikirim_ke_wali = true)
  // Gunakan nilai_edit jika ada (hasil remedial guru), jika tidak gunakan nilai asli
  const nilaiRekap = (siswaList ?? []).map((siswa: { nis: string; nama: string }) => {
    const row: Record<string, unknown> = { nis: siswa.nis, nama: siswa.nama }
    mapelIds.forEach(mapelId => {
      const n = (nilaiList ?? []).find((v: { nis: string; mapel_id: string; dikirim_ke_wali: boolean }) =>
        v.nis === siswa.nis && v.mapel_id === mapelId && v.dikirim_ke_wali
      ) as Record<string, unknown> | undefined

      if (!n) {
        row[mapelId] = null
      } else {
        // Jika ada nilai_edit, pakai itu. Jika tidak, pakai nilai asli
        const nilaiTampil = n.nilai_edit != null ? n.nilai_edit : n.nilai
        const gradeTampil = n.grade_edit != null ? n.grade_edit : n.grade
        const lulusTampil = n.lulus_edit != null ? n.lulus_edit : n.lulus
        row[mapelId] = {
          nilai: nilaiTampil,
          grade: gradeTampil,
          lulus: lulusTampil,
          nilai_id: n.id,
          dikembalikan: n.dikembalikan,
        }
      }
    })
    return row
  })

  return NextResponse.json({
    isWaliKelas: true,
    kelas: kelasWali,
    mapelList: mapelEnriched,
    siswaList,
    nilaiRekap,
  })
}
