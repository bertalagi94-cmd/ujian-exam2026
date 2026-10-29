import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdPublik } from '@/lib/tenant'
import { cachedFetch } from '@/lib/cache'
import { ambilLogoAplikasi } from '@/lib/pengaturan-global'

export const dynamic = 'force-dynamic'

// Pengaturan publik (nama, logo, batas pelanggaran, dst.) PER YAYASAN.
// Yayasan ditentukan dari token (halaman setelah login) atau ?kode= (halaman
// login); lihat yayasanIdPublik di src/lib/tenant.ts. Tanpa keduanya dan
// saat mode multi-yayasan menyala, jawabannya KOSONG (bukan data yayasan lain).
export async function GET(req: NextRequest) {
  try {
    const yys = await yayasanIdPublik(req)
    if (!yys) {
      return NextResponse.json({ data: {} }, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    // In-memory cache 60 dtk per yayasan. Kunci memuat yayasanId.
    const result = await cachedFetch<Record<string, string>>(`pengaturan:public:${yys.id}`, 60, async () => {
      const db = tenantDb(yys.id)
      const { data, error } = await db
        .from('pengaturan')
        .select('key, value')
        .in('key', ['namaSekolah', 'tahunAjaran', 'kota', 'logoUrl', 'logoAplikasi', 'batasPelanggaran', 'jumlahOpsi', 'kunciJumlahOpsi', 'batas_durasi_essay_min_menit', 'batas_durasi_essay_max_menit'])

      if (error) return {}
      const map: Record<string, string> = {}
      data?.forEach(({ key, value }: { key: string; value: string }) => { map[key] = value ?? '' })

      // Cadangan logo sekolah: kalau 'logoUrl' di Pengaturan kosong, pakai logo
      // sekolah/jenjang pertama yang punya logo (diisi di Informasi Sekolah).
      if (!map.logoUrl) {
        const { data: sekolahLogo } = await db
          .from('sekolah')
          .select('logo_url')
          .neq('logo_url', '')
          .not('logo_url', 'is', null)
          .order('urutan')
          .order('created_at')
          .limit(1)
        const url = (sekolahLogo?.[0] as { logo_url?: string } | undefined)?.logo_url
        if (url) map.logoUrl = url
      }
      return map
    })

    // Logo aplikasi bersifat GLOBAL (diatur developer), bukan per sekolah: selalu
    // menimpa nilai 'logoAplikasi' lama di pengaturan sekolah, apa pun isinya.
    const logoAplikasi = await ambilLogoAplikasi()

    return NextResponse.json({ data: { ...result, logoAplikasi } }, {
      headers: {
        // Respons berdasarkan token: JANGAN masuk cache bersama (CDN), kalau
        // tidak yayasan A bisa menerima jawaban yayasan B pada URL yang sama.
        // Berdasarkan ?kode=: URL-nya sudah berbeda per yayasan, aman di-cache
        // CDN 60 dtk seperti sebelumnya.
        'Cache-Control': yys.dariToken
          ? 'private, no-store'
          : 'public, s-maxage=60, stale-while-revalidate=300',
        Vary: 'Authorization',
      },
    })
  } catch {
    return NextResponse.json({ data: {} }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
}
