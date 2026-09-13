import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface Jadwal {
  id: string
  tanggal: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  pengawas: string
  durasi: number
  status: string
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const tanggal = searchParams.get('tanggal')
  if (!tanggal) return NextResponse.json({ error: 'Parameter tanggal diperlukan' }, { status: 400 })

  const { data: jadwalList, error } = await db
    .from('jadwal')
    .select('id, tanggal, sesi, jam_mulai, jam_selesai, mapel_id, kelas, pengawas, durasi, status')
    .eq('tanggal', tanggal)
    .order('sesi')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jadwalList?.length) return NextResponse.json({ data: [] })

  const list = jadwalList as Jadwal[]

  const mapelIds   = [...new Set(list.map(j => j.mapel_id).filter(Boolean))]
  const pengawasIds = [...new Set(list.map(j => j.pengawas).filter(Boolean))]
  const kelasList  = [...new Set(list.map(j => j.kelas).filter(Boolean))]

  const [{ data: mapelList }, { data: pengawasList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds.length ? mapelIds : ['__']),
    db.from('users').select('username, nama').in('username', pengawasIds.length ? pengawasIds : ['__']),
  ])

  // Ambil sekolah per kelas (join kelas → sekolah)
  const { data: kelasRows } = await db
    .from('kelas')
    .select('nama, sekolah:sekolah_id(id, label, nama_sekolah, npsn, nama_kepsek, nip_kepsek, alamat, kota, tahun_ajaran, logo_url)')
    .in('nama', kelasList.length ? kelasList : ['__'])

  type SekolahRow = { id: string; label: string; nama_sekolah: string; npsn: string; nama_kepsek: string; nip_kepsek: string; alamat: string; kota: string; tahun_ajaran: string; logo_url: string }
  const kelasSekolahMap: Record<string, SekolahRow | null> = Object.fromEntries(
    ((kelasRows ?? []) as unknown as { nama: string; sekolah: SekolahRow | null }[]).map(k => [k.nama, k.sekolah])
  )

  const mapelMap    = Object.fromEntries(
    ((mapelList ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama])
  )
  const pengawasMap = Object.fromEntries(
    ((pengawasList ?? []) as { username: string; nama: string }[]).map(p => [p.username, p.nama])
  )

  // ── Enrich jumlah soal PG & Essay (untuk cetak Berita Acara / Daftar Hadir) ──
  // kelas_id di tabel soal / soal_essay / paket_essay SELALU berupa id asli
  // dari tabel kelas (mis. "KLS_xxx"), sedangkan jadwal.kelas menyimpan NAMA
  // kelas (mis. "10") — jadi perlu resolve id -> nama dulu, sama seperti pola
  // di src/lib/soal-status.ts & src/lib/rangkuman.ts.
  const { data: semuaKelasRaw } = await db.from('kelas').select('id, nama')
  const idKeNamaKelas = Object.fromEntries(
    ((semuaKelasRaw ?? []) as { id: string; nama: string }[]).map(k => [k.id, String(k.nama)])
  )
  const buildKeySoal = (mapelId: string, kelasNama: string) =>
    `${mapelId}__${String(kelasNama).trim().toUpperCase()}`

  const jumlahPgMap: Record<string, number> = {}
  const jumlahEssayMap: Record<string, number> = {}
  const modeEssayMap: Record<string, string> = {}

  if (mapelIds.length) {
    const [{ data: soalPgList }, { data: soalEssayList }, { data: paketEssayList }] = await Promise.all([
      db.from('soal').select('mapel_id, kelas_id').in('mapel_id', mapelIds).eq('status', 'DISETUJUI'),
      db.from('soal_essay').select('mapel_id, kelas_id').in('mapel_id', mapelIds).eq('status', 'DISETUJUI'),
      db.from('paket_essay').select('mapel_id, kelas_id, mode_jawaban, tanggal')
        .in('mapel_id', mapelIds).eq('status', 'DISETUJUI').order('tanggal', { ascending: false }),
    ])

    for (const s of (soalPgList ?? []) as { mapel_id: string; kelas_id: string }[]) {
      const key = buildKeySoal(s.mapel_id, idKeNamaKelas[s.kelas_id] ?? s.kelas_id)
      jumlahPgMap[key] = (jumlahPgMap[key] ?? 0) + 1
    }
    for (const s of (soalEssayList ?? []) as { mapel_id: string; kelas_id: string }[]) {
      const key = buildKeySoal(s.mapel_id, idKeNamaKelas[s.kelas_id] ?? s.kelas_id)
      jumlahEssayMap[key] = (jumlahEssayMap[key] ?? 0) + 1
    }
    // Ambil mode_jawaban dari paket_essay DISETUJUI terbaru per mapel+kelas
    // (jarang ada lebih dari satu paket disetujui untuk kombinasi yang sama,
    // tapi kalau ada, prioritaskan yang paling baru dibuat).
    for (const p of (paketEssayList ?? []) as { mapel_id: string; kelas_id: string; mode_jawaban: string }[]) {
      const key = buildKeySoal(p.mapel_id, idKeNamaKelas[p.kelas_id] ?? p.kelas_id)
      if (!modeEssayMap[key]) modeEssayMap[key] = p.mode_jawaban ?? 'DIGITAL'
    }
  }

  const result = await Promise.all(list.map(async (j) => {
    const { data: siswaList } = await db
      .from('siswa')
      .select('nis, nama')
      .eq('kelas', j.kelas)
      .eq('status', 'AKTIF')
      .order('nama')

    const sekolahKelas = kelasSekolahMap[j.kelas] ?? null
    const keySoal = buildKeySoal(j.mapel_id, j.kelas)

    return {
      ...j,
      nama_mapel:    mapelMap[j.mapel_id]  ?? j.mapel_id,
      nama_pengawas: pengawasMap[j.pengawas] ?? j.pengawas ?? '',
      siswa: siswaList ?? [],
      jumlah_soal_pg:    jumlahPgMap[keySoal] ?? 0,
      jumlah_soal_essay: jumlahEssayMap[keySoal] ?? 0,
      // 'DIGITAL' | 'KERTAS' | null (null kalau tidak ada essay sama sekali)
      mode_jawaban_essay: (jumlahEssayMap[keySoal] ?? 0) > 0 ? (modeEssayMap[keySoal] ?? 'DIGITAL') : null,
      sekolah: sekolahKelas ? {
        namaSekolah: sekolahKelas.nama_sekolah,
        npsn:        sekolahKelas.npsn,
        namaKepsek:  sekolahKelas.nama_kepsek,
        nipKepsek:   sekolahKelas.nip_kepsek,
        alamat:      sekolahKelas.alamat,
        kota:        sekolahKelas.kota,
        tahunAjaran: sekolahKelas.tahun_ajaran,
        logoUrl:     sekolahKelas.logo_url,
        label:       sekolahKelas.label,
      } : null,
    }
  }))

  return NextResponse.json({ data: result })
}
