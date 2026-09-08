// Taruh di: src/app/api/siswa/ujian/essay/upload-foto/route.ts
// Upload 1 foto lembar jawaban (MODE KERTAS SAJA). Pola storage sama seperti
// src/app/api/guru/soal/upload/route.ts, disesuaikan bucket & path.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const sesiId = formData.get('sesiId') as string | null
    if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })
    if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

    const { data: sesi } = await db.from('sesi_ujian').select('status, info_json').eq('id', sesiId).single()
    if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
    if (sesi.status !== 'BERJALAN') {
      return NextResponse.json({ error: 'Sesi ujian sudah ditutup' }, { status: 409 })
    }
    if (sesi.info_json?.essay_mode_jawaban !== 'KERTAS') {
      return NextResponse.json({ error: 'Sesi ini tidak menggunakan mode jawaban kertas' }, { status: 400 })
    }

    const { data: siswaUjian } = await db
      .from('siswa_ujian')
      .select('status, status_essay')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .single()

    if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
    if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
      return NextResponse.json({ error: 'Akses ujian Anda sedang dikunci/menunggu reset.' }, { status: 403 })
    }
    if (siswaUjian.status_essay !== 'MENGERJAKAN') {
      return NextResponse.json({ error: 'Sesi essay belum dimulai atau sudah selesai.' }, { status: 409 })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Format file tidak didukung. Gunakan JPG, PNG, atau WebP.' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ukuran file maksimal 5MB' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const ext = file.name.split('.').pop() || 'jpg'
    // upsert:true — siswa boleh upload ulang (ganti foto) selama belum menekan Kirim
    const fileName = `jawaban-essay/${sesiId}_${user.nis}.${ext}`

    const { error: uploadError } = await db.storage
      .from('assets')
      .upload(fileName, buffer, { contentType: file.type, upsert: true })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = db.storage.from('assets').getPublicUrl(fileName)

    const { error: dbError } = await db.from('jawaban_essay_foto').upsert({
      sesi_id: sesiId,
      nis: user.nis!,
      foto_url: urlData.publicUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sesi_id,nis' })

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

    return NextResponse.json({ url: urlData.publicUrl })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload gagal' },
      { status: 500 }
    )
  }
}
