import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { cacheDelPrefix } from '@/lib/cache'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })

    const db = tenantDb(yayasanIdDari(auth.user))
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = file.name.split('.').pop() || 'png'
    // Multi-yayasan: folder per yayasan agar logo tidak saling menimpa
    // (yayasan awal tetap tanpa folder, alamat lama tidak berubah).
    const yid = yayasanIdDari(auth.user)
    const folder = yid === 'YYS_AWAL' ? '' : `${yid}/`
    const fileName = `${folder}logo_sekolah.${ext}`

    // Upload ke Supabase Storage bucket "assets"
    const { error: uploadError } = await db.storage
      .from('assets')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = db.storage.from('assets').getPublicUrl(fileName)
    // Tambahkan parameter cache-busting (timestamp) agar browser tidak menampilkan
    // logo lama dari cache saat logo diganti dengan file berekstensi/nama yang sama.
    const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`

    // Simpan URL ke tabel pengaturan
    await db.from('pengaturan').upsert(
      { key: 'logoUrl', value: publicUrl, deskripsi: 'URL Logo Sekolah' },
      { onConflict: 'yayasan_id,key' }
    )

    cacheDelPrefix('pengaturan:')

    return NextResponse.json({ url: publicUrl })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload gagal' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    const db = tenantDb(yayasanIdDari(auth.user))

    // Hapus file dari storage (coba semua ekstensi umum)
    const exts = ['png', 'jpg', 'jpeg', 'svg', 'webp']
    const yidHapus = yayasanIdDari(auth.user)
    const folderHapus = yidHapus === 'YYS_AWAL' ? '' : `${yidHapus}/`
    for (const ext of exts) {
      await db.storage.from('assets').remove([`${folderHapus}logo_sekolah.${ext}`])
    }

    // Kosongkan logoUrl di pengaturan
    await db.from('pengaturan').upsert(
      { key: 'logoUrl', value: '', deskripsi: 'URL Logo Sekolah' },
      { onConflict: 'yayasan_id,key' }
    )

    cacheDelPrefix('pengaturan:')

    return NextResponse.json({ message: 'Logo berhasil dihapus' })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gagal menghapus' },
      { status: 500 }
    )
  }
}
