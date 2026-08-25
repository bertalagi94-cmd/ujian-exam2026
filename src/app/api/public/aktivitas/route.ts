import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function getTodayAndTomorrow() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Makassar' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = fmt(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { today, tomorrow: fmt(tomorrow) }
}

export async function GET() {
  try {
    const db = createAdminClient()
    const { today, tomorrow } = getTodayAndTomorrow()

    // ── 0. Peta kelas → sekolah, untuk melabeli setiap baris di bawah. ──
    // Halaman ini publik (belum ada login), jadi tidak ada satu "sekolah
    // aktif" yang bisa dijadikan filter — sebelumnya endpoint ini
    // menggabungkan data SEMUA sekolah tanpa keterangan asalnya, sehingga
    // ujian/jadwal/juara dari sekolah/jenjang berbeda tampil seolah satu
    // sekolah. Sekarang setiap baris diberi label sekolah/jenjangnya.
    const [{ data: kelasRows }, { data: sekolahRows }] = await Promise.all([
      db.from('kelas').select('id, nama, sekolah_id'),
      db.from('sekolah').select('id, label, nama_sekolah'),
    ])

    const sekolahLabelMap: Record<string, string> = {}
    ;(sekolahRows ?? []).forEach((s: { id: string; label: string; nama_sekolah: string }) => {
      sekolahLabelMap[s.id] = s.label || s.nama_sekolah || '-'
    })

    // kelas.id -> label sekolah (dipakai untuk juaraPerKelas, tidak ambigu)
    const kelasIdToSekolahLabel: Record<string, string> = {}
    // kelas.nama -> label sekolah (dipakai untuk sesi_ujian/jadwal/nilai,
    // yang menyimpan NAMA kelas bukan id — lihat catatan di
    // guru/wali-kelas/route.ts. CATATAN: kalau ada nama kelas yang sama
    // persis dipakai di lebih dari satu sekolah, pemetaan by-nama ini bisa
    // ambigu — memilih kecocokan pertama. Ini hanya memengaruhi label
    // tampilan, bukan data ujian/nilai itu sendiri.
    const kelasNamaToSekolahLabel: Record<string, string> = {}
    ;(kelasRows ?? []).forEach((k: { id: string; nama: string; sekolah_id: string | null }) => {
      const label = k.sekolah_id ? (sekolahLabelMap[k.sekolah_id] ?? '-') : '-'
      kelasIdToSekolahLabel[k.id] = label
      if (!(k.nama in kelasNamaToSekolahLabel)) kelasNamaToSekolahLabel[k.nama] = label
    })

    // ── 1. Ujian sedang berlangsung (sesi_ujian BERJALAN) ──
    const { data: sesiAktif } = await db
      .from('sesi_ujian')
      .select('id, mapel_id, kelas, waktu_mulai, info_json')
      .eq('status', 'BERJALAN')
      .order('waktu_mulai', { ascending: false })

    // Ambil detail mapel dan pengawas dari jadwal
    const ujianBerlangsung: Array<{
      id: string
      mapel: string
      kelas: string
      sekolah: string
      pengawas: string
      waktu_mulai: string
    }> = []

    if (sesiAktif && sesiAktif.length > 0) {
      // Ambil semua mapel_id yang dibutuhkan
      const mapelIds = [...new Set(sesiAktif.map((s: { mapel_id: string }) => s.mapel_id).filter(Boolean))]
      const { data: mapelData } = await db
        .from('mapel')
        .select('id, nama')
        .in('id', mapelIds)

      const mapelMap: Record<string, string> = {}
      mapelData?.forEach((m: { id: string; nama: string }) => { mapelMap[m.id] = m.nama })

      // Ambil jadwal untuk dapat pengawas
      const { data: jadwalAktif } = await db
        .from('jadwal')
        .select('id, mapel_id, kelas, pengawas')
        .eq('tanggal', today)
        .eq('status', 'BERJALAN')

      // Ambil username pengawas
      const pengawasIds = [...new Set((jadwalAktif || []).map((j: { pengawas: string }) => j.pengawas).filter(Boolean))]
      const { data: pengawasData } = await db
        .from('users')
        .select('username, nama')
        .in('username', pengawasIds)

      const pengawasMap: Record<string, string> = {}
      pengawasData?.forEach((u: { username: string; nama: string }) => { pengawasMap[u.username] = u.nama })

      // Build lookup jadwal by mapel+kelas
      const jadwalLookup: Record<string, string> = {}
      jadwalAktif?.forEach((j: { mapel_id: string; kelas: string; pengawas: string }) => {
        jadwalLookup[`${j.mapel_id}|${j.kelas}`] = pengawasMap[j.pengawas] || j.pengawas || '-'
      })

      for (const sesi of sesiAktif) {
        const key = `${sesi.mapel_id}|${sesi.kelas}`
        ujianBerlangsung.push({
          id: sesi.id,
          mapel: mapelMap[sesi.mapel_id] || sesi.mapel_id || '-',
          kelas: sesi.kelas || '-',
          sekolah: kelasNamaToSekolahLabel[sesi.kelas] ?? '-',
          pengawas: jadwalLookup[key] || '-',
          waktu_mulai: sesi.waktu_mulai,
        })
      }
    }

    // ── 2. Jadwal hari ini & besok ──
    const { data: jadwalRaw } = await db
      .from('jadwal')
      .select('id, tanggal, jam_mulai, jam_selesai, mapel_id, kelas, status')
      .in('tanggal', [today, tomorrow])
      .order('tanggal', { ascending: true })
      .order('jam_mulai', { ascending: true })

    const jadwalMapelIds = [...new Set((jadwalRaw || []).map((j: { mapel_id: string }) => j.mapel_id).filter(Boolean))]
    const { data: jadwalMapelData } = jadwalMapelIds.length > 0
      ? await db.from('mapel').select('id, nama').in('id', jadwalMapelIds)
      : { data: [] }

    const jadwalMapelMap: Record<string, string> = {}
    jadwalMapelData?.forEach((m: { id: string; nama: string }) => { jadwalMapelMap[m.id] = m.nama })

    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
    const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des']

    function formatTanggal(tgl: string) {
      const d = new Date(tgl + 'T00:00:00')
      return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`
    }

    const jadwalList = (jadwalRaw || []).map((j: {
      id: string
      tanggal: string
      jam_mulai: string
      jam_selesai: string
      mapel_id: string
      kelas: string
      status: string
    }) => ({
      id: j.id,
      tanggal: formatTanggal(j.tanggal),
      tanggal_raw: j.tanggal,
      jam: `${j.jam_mulai} – ${j.jam_selesai}`,
      mapel: jadwalMapelMap[j.mapel_id] || j.mapel_id || '-',
      kelas: j.kelas,
      sekolah: kelasNamaToSekolahLabel[j.kelas] ?? '-',
      status: j.status,
      isToday: j.tanggal === today,
    }))

    // ── 3. Juara umum per kelas ──
    // Ambil semua kelas yang ada
    const kelasList = kelasRows ?? []

    const juaraPerKelas: Array<{
      kelas: string
      sekolah: string
      nama_siswa: string
      nilai_rata: number
    }> = []

    if (kelasList.length > 0) {
      for (const kls of kelasList) {
        // Ambil siswa di kelas ini dengan nilai rata-rata tertinggi.
        // FIX: sebelumnya query ini pakai `.eq('kelas', kls.id)`, padahal
        // kolom nilai.kelas menyimpan NAMA kelas (bukan id) — sama seperti
        // sesi_ujian.kelas dan jadwal.kelas (lihat catatan di
        // guru/wali-kelas/route.ts). Akibatnya query ini nyaris tidak
        // pernah cocok dan "Juara Umum" nyaris selalu kosong. Sekarang
        // pakai kls.nama.
        const { data: nilaiKelas } = await db
          .from('nilai')
          .select('nis, nilai')
          .eq('kelas', kls.nama)

        if (!nilaiKelas || nilaiKelas.length === 0) continue

        // Hitung rata-rata per siswa
        const perSiswa: Record<string, { total: number; count: number }> = {}
        for (const n of nilaiKelas) {
          if (!perSiswa[n.nis]) perSiswa[n.nis] = { total: 0, count: 0 }
          perSiswa[n.nis].total += Number(n.nilai)
          perSiswa[n.nis].count += 1
        }

        // Cari siswa dengan rata-rata tertinggi
        let bestNis = ''
        let bestAvg = -1
        for (const [nis, stat] of Object.entries(perSiswa)) {
          const avg = stat.total / stat.count
          if (avg > bestAvg) { bestAvg = avg; bestNis = nis }
        }

        if (!bestNis) continue

        // Ambil nama siswa
        const { data: siswaData } = await db
          .from('siswa')
          .select('nama')
          .eq('nis', bestNis)
          .single()

        juaraPerKelas.push({
          kelas: kls.nama,
          sekolah: kelasIdToSekolahLabel[kls.id] ?? '-',
          nama_siswa: siswaData?.nama || bestNis,
          nilai_rata: Math.round(bestAvg * 10) / 10,
        })
      }
    }

    return NextResponse.json({
      ujianBerlangsung,
      jadwal: jadwalList,
      juaraPerKelas,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('aktivitas public error:', err)
    return NextResponse.json({ ujianBerlangsung: [], jadwal: [], juaraPerKelas: [] })
  }
}
