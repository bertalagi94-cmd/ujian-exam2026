import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'
import { computeStatusSoalMap, buildStatusSoalKey } from '@/lib/soal-status'

// GET /api/kepsek/guru-mapel
//
// FITUR BARU: Kepsek sebelumnya hanya melihat ANGKA total guru di dashboard,
// tanpa tahu detail guru mana mengampu mapel apa di kelas mana. Endpoint ini
// menyusun data tersebut per guru: daftar mapel yang diampu, kelas-kelas
// untuk tiap mapel, dan status kesiapan soal di kelas itu (status_soal),
// dihitung dengan logika YANG SAMA PERSIS dengan menu Jadwal Ujian di akun
// Admin (lihat src/lib/soal-status.ts — dipakai juga oleh
// src/app/api/admin/jadwal/route.ts dan src/lib/rangkuman.ts), supaya
// statusnya selalu konsisten di seluruh aplikasi.
//
// Sama seperti endpoint kepsek lain: dibatasi ke kelasScope (kelas-kelas di
// sekolah/jenjang yang ditugaskan ke akun Kepsek tersebut). ADMIN tidak
// dibatasi (kelasScope = null = semua kelas).
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  let kelasScope: string[] | null = null
  if (auth.user.role === 'KEPSEK') {
    const scope = await getKepsekScope(auth.user.username)
    if (scope.noScope) {
      return NextResponse.json({
        scopeWarning: 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin. Hubungi Admin untuk mengatur ini di menu Data Pengguna.',
        data: [],
        mapelTanpaGuru: [],
      })
    }
    kelasScope = scope.kelasList
    if (kelasScope.length === 0) {
      return NextResponse.json({ data: [], mapelTanpaGuru: [] })
    }
  }

  // 1. Ambil semua mapel (id, nama, guru_id, kelas_list, kkm).
  const { data: mapelRowsRaw, error: mapelError } = await db
    .from('mapel')
    .select('id, nama, guru_id, kelas_list, kkm')
    .order('nama')

  if (mapelError) return NextResponse.json({ error: mapelError.message }, { status: 500 })

  const mapelRows = (mapelRowsRaw ?? []) as {
    id: string; nama: string; guru_id: string | null; kelas_list: string | null; kkm: number | null
  }[]

  // 2. Untuk tiap mapel, ambil daftar kelas yang diampu, dipotong sesuai
  //    scope Kepsek (kalau ada). Mapel yang setelah dipotong tidak punya
  //    kelas tersisa di scope ini diabaikan (tidak relevan untuk Kepsek itu).
  const mapelDenganKelas = mapelRows
    .map(m => {
      const kelasArr = (m.kelas_list ?? '').split(',').map(s => s.trim()).filter(Boolean)
      const kelasDalamScope = kelasScope ? kelasArr.filter(k => kelasScope!.includes(k)) : kelasArr
      return { ...m, kelasDalamScope }
    })
    .filter(m => m.kelasDalamScope.length > 0)

  // 3. Hitung status_soal untuk SEMUA kombinasi (mapel_id, kelas) sekaligus,
  //    pakai helper terpusat yang sama dengan menu Jadwal Ujian Admin.
  const items = mapelDenganKelas.flatMap(m => m.kelasDalamScope.map(kelas => ({ mapel_id: m.id, kelas })))
  const statusMap = items.length > 0 ? await computeStatusSoalMap(items) : {}

  // 4. Resolve nama guru.
  const guruIds = [...new Set(mapelDenganKelas.map(m => m.guru_id).filter((g): g is string => !!g))]
  let guruMap: Record<string, { nama: string; status: string }> = {}
  if (guruIds.length > 0) {
    const { data: guruRows } = await db
      .from('users')
      .select('username, nama, status')
      .in('username', guruIds)
    guruMap = Object.fromEntries(
      ((guruRows ?? []) as { username: string; nama: string; status: string }[])
        .map(g => [g.username, { nama: g.nama, status: g.status }])
    )
  }

  // 5. Susun struktur per guru: { username, nama, statusAkun, mapel: [{ mapel_id, nama_mapel, kkm, kelas: [{ nama_kelas, status_soal }] }] }
  type KelasItem = { nama_kelas: string; status_soal: string }
  type MapelItem = { mapel_id: string; nama_mapel: string; kkm: number | null; kelas: KelasItem[] }
  type GuruItem = { username: string; nama: string; status: string; mapel: MapelItem[] }

  const guruResultMap: Record<string, GuruItem> = {}
  const mapelTanpaGuru: { mapel_id: string; nama_mapel: string; kelas: string[] }[] = []

  for (const m of mapelDenganKelas) {
    const kelasList: KelasItem[] = m.kelasDalamScope
      .map(kelas => ({
        nama_kelas: kelas,
        status_soal: statusMap[buildStatusSoalKey(m.id, kelas)] ?? 'BELUM_ADA',
      }))
      .sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas, 'id', { numeric: true }))

    if (!m.guru_id) {
      mapelTanpaGuru.push({ mapel_id: m.id, nama_mapel: m.nama, kelas: kelasList.map(k => k.nama_kelas) })
      continue
    }

    if (!guruResultMap[m.guru_id]) {
      const info = guruMap[m.guru_id]
      guruResultMap[m.guru_id] = {
        username: m.guru_id,
        nama: info?.nama ?? m.guru_id,
        status: info?.status ?? 'AKTIF',
        mapel: [],
      }
    }

    guruResultMap[m.guru_id].mapel.push({
      mapel_id: m.id,
      nama_mapel: m.nama,
      kkm: m.kkm ?? null,
      kelas: kelasList,
    })
  }

  // 6. Guru AKTIF yang ada di scope (lewat mapel) tapi belum sempat tampil
  //    karena tidak ada satupun mapel-nya yang lolos filter (jaga-jaga,
  //    seharusnya tidak terjadi karena loop di atas sudah cover semua guru
  //    yang punya minimal 1 mapel+kelas di scope) — tidak perlu langkah
  //    tambahan di sini, guruResultMap sudah lengkap dari loop di atas.

  const data = Object.values(guruResultMap)
    .map(g => ({
      ...g,
      mapel: g.mapel.sort((a, b) => a.nama_mapel.localeCompare(b.nama_mapel, 'id')),
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))

  return NextResponse.json({ data, mapelTanpaGuru })
}
