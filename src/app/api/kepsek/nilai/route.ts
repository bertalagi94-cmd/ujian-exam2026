import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const kelas = searchParams.get('kelas')
  const mapelId = searchParams.get('mapel_id')

  // Mode "opsi": kembalikan daftar kombinasi kelas+mapel yang sudah punya nilai,
  // supaya dropdown filter di halaman hanya menampilkan pilihan yang valid (ada datanya).
  if (searchParams.get('mode') === 'opsi') {
    const { data: nilaiRows, error } = await db.from('nilai').select('kelas, mapel_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const kelasSet = new Set<string>()
    const comboSet = new Set<string>()
    for (const n of ((nilaiRows ?? []) as { kelas: string; mapel_id: string }[])) {
      if (n.kelas) kelasSet.add(n.kelas)
      if (n.kelas && n.mapel_id) comboSet.add(`${n.kelas}__${n.mapel_id}`)
    }

    const mapelIds = [...new Set([...comboSet].map(c => c.split('__')[1]))]
    const { data: mapelListRaw } = mapelIds.length ? await db.from('mapel').select('id, nama').in('id', mapelIds) : { data: [] }
    const mapelMap = Object.fromEntries(((mapelListRaw ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama]))

    const kelasList = [...kelasSet].sort()
    const mapelPerKelas: Record<string, { id: string; nama: string }[]> = {}
    for (const combo of comboSet) {
      const [k, m] = combo.split('__')
      if (!mapelPerKelas[k]) mapelPerKelas[k] = []
      mapelPerKelas[k].push({ id: m, nama: mapelMap[m] ?? m })
    }
    for (const k of Object.keys(mapelPerKelas)) {
      mapelPerKelas[k].sort((a, b) => a.nama.localeCompare(b.nama))
    }

    return NextResponse.json({ kelasList, mapelPerKelas })
  }

  if (!kelas || !mapelId) {
    return NextResponse.json({ error: 'Parameter kelas dan mapel_id wajib diisi' }, { status: 400 })
  }

  const { data, error } = await db
    .from('nilai')
    .select('*')
    .eq('kelas', kelas)
    .eq('mapel_id', mapelId)
    .order('nilai', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { id: string; nis: string; nilai: number; grade: string; benar: number; total: number; lulus: boolean; kkm: number; timestamp: string }[]

  const nisSet = [...new Set(rows.map(r => r.nis))]
  const [{ data: siswaList }, { data: mapelRow }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisSet.length ? nisSet : ['__']).neq('is_tester', 'YES'),
    db.from('mapel').select('id, nama').eq('id', mapelId).maybeSingle(),
  ])
  const siswaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))

  const enriched = rows
    .filter(r => siswaMap[r.nis]) // exclude tester
    .map((r, i) => ({ ...r, nama_siswa: siswaMap[r.nis] ?? r.nis, rank: i + 1 }))

  const nums = enriched.map(r => r.nilai)
  const summary = {
    jumlahSiswa: enriched.length,
    rataRata: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0,
    nilaiTertinggi: nums.length ? Math.max(...nums) : 0,
    nilaiTerendah: nums.length ? Math.min(...nums) : 0,
    jumlahLulus: enriched.filter(r => r.lulus).length,
    jumlahTidakLulus: enriched.filter(r => !r.lulus).length,
  }

  return NextResponse.json({
    data: enriched,
    summary,
    nama_mapel: (mapelRow as { id: string; nama: string } | null)?.nama ?? mapelId,
  })
}
