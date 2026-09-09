import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()
  const nis = user.nis!

  const [{ data: nilaiAll }, { data: jadwal }] = await Promise.all([
    db.from('nilai').select('*').eq('nis', nis).order('timestamp', { ascending: false }),
    db.from('jadwal').select('*').eq('kelas', user.kelas!).eq('status', 'AKTIF').order('tanggal').limit(5),
  ])

  const nums = (nilaiAll ?? []).map(n => n.nilai || 0)
  const stats = {
    totalUjian: nums.length,
    rataRata: nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
  }

  // Enrich nilai with mapel names
  const recentNilai = (nilaiAll ?? []).slice(0, 6)
  const mapelIds = [...new Set(recentNilai.map(r => r.mapel_id).filter(Boolean))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))

  // FIX (keamanan, sama seperti /api/siswa/nilai): endpoint ini juga
  // mengirim seluruh kolom tabel `nilai` ke client SISWA tanpa mengecek
  // `dirilis`, jadi nilai_essay/nilai_total bisa terlihat di dashboard
  // sebelum guru menekan tombol rilis. Mask sama seperti di
  // /api/siswa/nilai/route.ts.
  const essayAktifMap = await petakanEssayAktifPerSesi(db, recentNilai.map(r => r.sesi_id))

  const enrichedNilai = recentNilai.map(r => {
    const essayDirilis = r.dirilis === true
    const essayAktif = r.sesi_id ? (essayAktifMap.get(r.sesi_id) ?? false) : false
    return {
      ...r,
      nilai_essay: essayDirilis ? r.nilai_essay : null,
      nilai_total: essayDirilis ? r.nilai_total : null,
      dinilai_pada: essayDirilis ? r.dinilai_pada : null,
      dinilai_oleh: essayDirilis ? r.dinilai_oleh : null,
      nama_mapel: mapelMap[r.mapel_id] ?? r.mapel_id,
      essay_belum_dirilis: essayAktif && !essayDirilis,
    }
  })

  // Enrich jadwal
  const jMapelIds = [...new Set((jadwal ?? []).map(j => j.mapel_id).filter(Boolean))]
  const { data: jMapelList } = await db.from('mapel').select('id, nama').in('id', jMapelIds.length ? jMapelIds : ['__'])
  const jMapelMap = Object.fromEntries((jMapelList ?? []).map(m => [m.id, m.nama]))
  const enrichedJadwal = (jadwal ?? []).map(j => ({
    ...j,
    nama_mapel: jMapelMap[j.mapel_id] ?? j.mapel_id,
  }))

  return NextResponse.json({
    stats,
    nilaiTerbaru: enrichedNilai,
    jadwalMendatang: enrichedJadwal,
  })
}
