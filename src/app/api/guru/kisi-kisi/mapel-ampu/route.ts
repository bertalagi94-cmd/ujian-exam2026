import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/guru/kisi-kisi/mapel-ampu
// Mengembalikan daftar mapel dan kelas yang diampu guru ini.
// Strategi: ambil mapel dengan guru_id = username guru,
// lalu parse kolom kelas_list (format: "10,11,12") untuk mendapat daftar kelas.
// Kelas di-lookup dari tabel kelas berdasarkan nama (karena id kelas = nama kelas).
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  // 1. Ambil semua mapel yang diampu guru ini
  const { data: mapelList, error } = await db
    .from('mapel')
    .select('id, nama, kelas_list')
    .eq('guru_id', user.username)
    .order('nama')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mapelList?.length) return NextResponse.json({ data: [] })

  // 2. Kumpulkan semua nama kelas unik dari kelas_list
  const semuaNamaKelas = new Set<string>()
  for (const m of mapelList) {
    if (m.kelas_list) {
      m.kelas_list.split(',').map((k: string) => k.trim()).filter(Boolean).forEach((k: string) => semuaNamaKelas.add(k))
    }
  }

  // 3. Coba ambil dari tabel kelas (ada id & nama) — kelas yang sudah punya record
  let kelasDbMap: Record<string, { id: string; nama: string }> = {}
  if (semuaNamaKelas.size > 0) {
    const namaArr = Array.from(semuaNamaKelas)

    // Coba cari berdasarkan nama
    const { data: kelasByNama } = await db
      .from('kelas')
      .select('id, nama')
      .in('nama', namaArr)

    // Coba juga berdasarkan id (karena di beberapa setup, id kelas = nama kelas)
    const { data: kelasById } = await db
      .from('kelas')
      .select('id, nama')
      .in('id', namaArr)

    const combined = [...(kelasByNama ?? []), ...(kelasById ?? [])]
    // Deduplicate by id
    const seen = new Set<string>()
    for (const k of combined) {
      if (!seen.has(k.id)) {
        seen.add(k.id)
        kelasDbMap[k.nama] = { id: k.id, nama: k.nama }
        // juga index by id in case id != nama
        kelasDbMap[k.id] = { id: k.id, nama: k.nama }
      }
    }
  }

  // 4. Susun hasil: per mapel → list kelas
  const result = mapelList.map(m => {
    const namaKelasList = m.kelas_list
      ? m.kelas_list.split(',').map((k: string) => k.trim()).filter(Boolean)
      : []

    const kelasList = namaKelasList.map((namaKelas: string) => {
      // Cari di DB, kalau tidak ada fallback pakai nama sebagai id
      const found = kelasDbMap[namaKelas]
      return found
        ? { id: found.id, nama: found.nama }
        : { id: namaKelas, nama: namaKelas }  // fallback: nama kelas = id kelas
    })

    return {
      id: m.id,
      nama: m.nama,
      kelas: kelasList,
    }
  }).filter(m => m.kelas.length > 0)

  return NextResponse.json({ data: result })
}
