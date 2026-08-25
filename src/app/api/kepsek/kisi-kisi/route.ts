import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'

// GET /api/kepsek/kisi-kisi — kepala sekolah memantau semua kisi-kisi yang
// dibuat guru (read-only; tidak ada endpoint hapus/edit — itu kewenangan
// guru pemilik dan admin, lihat guru/kisi-kisi dan admin/kisi-kisi).
//
// FIX: sebelumnya endpoint ini mengambil SEMUA baris kisi_kisi tanpa
// filter, jadi kepsek di satu sekolah ikut melihat kisi-kisi milik
// sekolah/jenjang lain (peninggalan asumsi lama "1 aplikasi = 1 sekolah").
// Sekarang dibatasi ke kelasScope (kelas-kelas di sekolah/jenjang yang
// ditugaskan ke akun Kepsek tsb), sama seperti endpoint kepsek lain
// (lihat kelas/route.ts, guru-mapel/route.ts, dll).
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK'])
  if ('error' in auth) return auth.error
  const db = createAdminClient()

  const scope = await getKepsekScope(auth.user.username)
  if (scope.noScope) {
    return NextResponse.json({
      scopeWarning: 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin. Hubungi Admin untuk mengatur ini di menu Data Pengguna.',
      data: [],
    })
  }
  if (scope.kelasList.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // kepsek-scope.ts mengembalikan NAMA kelas (nama unik dipakai sebagai
  // scope), tapi kolom kisi_kisi.kelas_id menyimpan ID asli tabel `kelas`
  // (generateId('KLS'), lihat guru/kisi-kisi/route.ts) — bukan namanya.
  // Jadi perlu resolve nama → id dulu sebelum dipakai untuk filter,
  // sama seperti pola fix di siswa/kisi-kisi/route.ts.
  const { data: kelasScopeRows, error: kelasScopeError } = await db
    .from('kelas')
    .select('id')
    .in('nama', scope.kelasList)

  if (kelasScopeError) return NextResponse.json({ error: kelasScopeError.message }, { status: 500 })

  const kelasIdScope = (kelasScopeRows ?? []).map(k => k.id)
  if (kelasIdScope.length === 0) return NextResponse.json({ data: [] })

  const { data: kisiList, error } = await db
    .from('kisi_kisi')
    .select('*')
    .in('kelas_id', kelasIdScope)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kisiList?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(kisiList.map(k => k.mapel_id))]
  const kelasIds = [...new Set(kisiList.map(k => k.kelas_id))]
  const guruIds = [...new Set(kisiList.map(k => k.guru_id))]

  const [{ data: mapelList }, { data: kelasList }, { data: guruList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('kelas').select('id, nama').in('id', kelasIds),
    db.from('users').select('username, nama').in('username', guruIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const kelasMap = Object.fromEntries((kelasList ?? []).map(k => [k.id, k.nama]))
  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))

  const enriched = kisiList.map(k => ({
    ...k,
    nama_mapel: mapelMap[k.mapel_id] ?? k.mapel_id,
    nama_kelas: kelasMap[k.kelas_id] ?? k.kelas_id,
    nama_guru: guruMap[k.guru_id] ?? k.guru_id,
  }))

  return NextResponse.json({ data: enriched })
}
