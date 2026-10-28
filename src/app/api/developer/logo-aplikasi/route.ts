import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'
import { cacheDelPrefix } from '@/lib/cache'
import { ambilLogoAplikasi, simpanLogoAplikasi } from '@/lib/pengaturan-global'

export const dynamic = 'force-dynamic'

// Logo aplikasi GLOBAL (halaman login & sidebar semua sekolah). Hanya akun
// developer yang boleh mengubahnya; admin sekolah hanya mengelola logo sekolahnya.

// Ekstensi ditentukan dari tipe MIME yang diizinkan, BUKAN dari nama file kiriman klien.
const EKSTENSI_GAMBAR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const SEMUA_EKSTENSI = Array.from(new Set(Object.values(EKSTENSI_GAMBAR)))
const MAKS_BYTES = 2 * 1024 * 1024
// Folder tersendiri di bucket 'assets' supaya tidak bentrok dengan folder per-yayasan.
const FOLDER = 'global'

export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error
  return NextResponse.json({ url: await ambilLogoAplikasi() })
}

export async function POST(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })

    const ext = EKSTENSI_GAMBAR[file.type]
    if (!ext) {
      return NextResponse.json({ error: 'Format logo tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.' }, { status: 400 })
    }
    if (file.size > MAKS_BYTES) {
      return NextResponse.json({ error: 'Ukuran logo maksimal 2MB' }, { status: 400 })
    }

    const db = createAdminClient()
    const fileName = `${FOLDER}/logo-aplikasi.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await db.storage
      .from('assets')
      .upload(fileName, buffer, { contentType: file.type, upsert: true })
    if (uploadError) throw new Error(uploadError.message)

    // Buang file logo lama berekstensi lain supaya tidak menumpuk (abaikan kalau gagal).
    const lain = SEMUA_EKSTENSI.filter(e => e !== ext).map(e => `${FOLDER}/logo-aplikasi.${e}`)
    await db.storage.from('assets').remove(lain).catch(() => undefined)

    const { data: urlData } = db.storage.from('assets').getPublicUrl(fileName)
    // Nama file tetap sama antar-upload (upsert), jadi tambahkan cache-busting.
    const url = `${urlData.publicUrl}?v=${Date.now()}`

    const { error: simpanError } = await simpanLogoAplikasi(url)
    if (simpanError) throw new Error(simpanError)

    cacheDelPrefix('pengaturan:')
    return NextResponse.json({ url })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload gagal' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  try {
    const db = createAdminClient()
    await db.storage.from('assets')
      .remove(SEMUA_EKSTENSI.map(e => `${FOLDER}/logo-aplikasi.${e}`))
      .catch(() => undefined)

    const { error } = await simpanLogoAplikasi('')
    if (error) throw new Error(error)

    cacheDelPrefix('pengaturan:')
    return NextResponse.json({ message: 'Logo aplikasi berhasil dihapus' })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menghapus' }, { status: 500 })
  }
}
