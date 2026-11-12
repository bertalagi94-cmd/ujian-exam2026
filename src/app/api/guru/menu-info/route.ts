import { NextRequest, NextResponse } from 'next/server'
import { requireRoleAktif } from '@/lib/status-akun'
import { cacheGet, cacheSet } from '@/lib/cache'
import { GET as getWaliKelas } from '../wali-kelas/route'
import { GET as getJadwalPengawasan } from '../jadwal-pengawasan/route'
import { GET as getAdminKelasSaya } from '../admin-kelas/saya/route'
import { GET as getRuangKhusus } from '../ruang-khusus/route'
import { GET as getAnalisisUjian } from '../analisis-ujian/route'

// GABUNGAN 5 request sidebar guru (wali-kelas, jadwal-pengawasan,
// admin-kelas/saya, ruang-khusus, analisis-ujian?only_kelas=1) menjadi SATU
// request. Logika tiap pengecekan TIDAK diubah: handler aslinya dipanggil
// langsung di dalam proses yang sama (tanpa 5x invokasi fungsi Vercel dan
// tanpa 5x cold start). Hasil di-cache 60 dtk per guru (per instance).
const TTL_DETIK = 60

type Info = {
  isWaliKelas: boolean
  hasPengawasan: boolean
  isAdminKelas: boolean
  adaRuang: boolean
  adaSesi: boolean
}

async function ambil(
  handler: (req: NextRequest) => Promise<Response>,
  asal: NextRequest,
  path: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const sub = new NextRequest(new URL(path, asal.url), { headers: asal.headers })
    const res = await handler(sub)
    if (!res.ok) return { ok: false, data: {} }
    return { ok: true, data: (await res.json()) as Record<string, unknown> }
  } catch {
    return { ok: false, data: {} }
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error

  const kunci = `guru-menu-info:${auth.user.yayasanId ?? ''}:${auth.user.username}`
  const dariCache = cacheGet<Info>(kunci)
  if (dariCache) return NextResponse.json(dariCache)

  const [wali, awas, adminKelas, ruang, analisis] = await Promise.all([
    ambil(getWaliKelas, req, '/api/guru/wali-kelas'),
    ambil(getJadwalPengawasan, req, '/api/guru/jadwal-pengawasan'),
    ambil(getAdminKelasSaya, req, '/api/guru/admin-kelas/saya'),
    ambil(getRuangKhusus, req, '/api/guru/ruang-khusus'),
    ambil(getAnalisisUjian, req, '/api/guru/analisis-ujian?only_kelas=1'),
  ])

  const dataAwas = awas.data as { hasJadwal?: boolean; data?: unknown[] }
  const info: Info = {
    isWaliKelas: !!(wali.data as { isWaliKelas?: boolean }).isWaliKelas,
    hasPengawasan: !!(dataAwas.hasJadwal || (dataAwas.data && dataAwas.data.length > 0)),
    isAdminKelas: !!(adminKelas.data as { isAdminKelas?: boolean }).isAdminKelas,
    adaRuang: !!(ruang.data as { adaRuang?: boolean }).adaRuang,
    adaSesi: !!(analisis.data as { adaSesi?: boolean }).adaSesi,
  }

  // Jangan simpan di cache kalau ada pengecekan yang gagal (mis. DB sibuk),
  // supaya percobaan berikutnya mengambil ulang.
  if (wali.ok && awas.ok && adminKelas.ok && ruang.ok && analisis.ok) {
    cacheSet(kunci, info, TTL_DETIK)
  }
  return NextResponse.json(info)
}
