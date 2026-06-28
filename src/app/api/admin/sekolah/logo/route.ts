import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Upload logo per sekolah atau logo aplikasi global
// Query param: ?type=sekolah&id=SKL_xxx  atau  ?type=aplikasi
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'sekolah'
  const sekolahId = searchParams.get('id')

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })

  const db = createAdminClient()
  const ext = file.name.split('.').pop() ?? 'png'
  const fileName = type === 'aplikasi'
    ? `logo-aplikasi.${ext}`
    : `logo-${sekolahId}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  // Pakai bucket "assets" — bucket inilah yang sudah dibuat (Public) di
  // Supabase Storage. Sebelumnya kode ini memanggil bucket "uploads" yang
  // tidak pernah dibuat, sehingga upload selalu gagal dengan error
  // "Bucket not found" walau preview lokal di browser tetap tampil.
  const { error: uploadError } = await db.storage
    .from('assets')
    .upload(fileName, arrayBuffer, { contentType: file.type, upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: urlData } = db.storage.from('assets').getPublicUrl(fileName)
  const url = urlData.publicUrl

  if (type === 'aplikasi') {
    await db.from('pengaturan').upsert({ key: 'logoAplikasi', value: url })
  } else if (sekolahId) {
    await db.from('sekolah').update({ logo_url: url }).eq('id', sekolahId)
  }

  return NextResponse.json({ url })
}

export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'sekolah'
  const sekolahId = searchParams.get('id')

  const db = createAdminClient()

  if (type === 'aplikasi') {
    await db.from('pengaturan').update({ value: '' }).eq('key', 'logoAplikasi')
  } else if (sekolahId) {
    await db.from('sekolah').update({ logo_url: '' }).eq('id', sekolahId)
  }

  return NextResponse.json({ message: 'Logo berhasil dihapus' })
}
