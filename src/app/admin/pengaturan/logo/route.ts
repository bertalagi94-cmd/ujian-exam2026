import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })

    const db = createAdminClient()
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const ext = file.name.split('.').pop() || 'png'
    const fileName = `logo_sekolah.${ext}`

    // Upload ke Supabase Storage bucket "assets"
    const { error: uploadError } = await db.storage
      .from('assets')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = db.storage.from('assets').getPublicUrl(fileName)
    const publicUrl = urlData.publicUrl

    // Simpan URL ke tabel pengaturan
    await db.from('pengaturan').upsert(
      { key: 'logoUrl', value: publicUrl, deskripsi: 'URL Logo Sekolah' },
      { onConflict: 'key' }
    )

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
    const db = createAdminClient()

    // Hapus file dari storage (coba semua ekstensi umum)
    const exts = ['png', 'jpg', 'jpeg', 'svg', 'webp']
    for (const ext of exts) {
      await db.storage.from('assets').remove([`logo_sekolah.${ext}`])
    }

    // Kosongkan logoUrl di pengaturan
    await db.from('pengaturan').upsert(
      { key: 'logoUrl', value: '', deskripsi: 'URL Logo Sekolah' },
      { onConflict: 'key' }
    )

    return NextResponse.json({ message: 'Logo berhasil dihapus' })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gagal menghapus' },
      { status: 500 }
    )
  }
}
