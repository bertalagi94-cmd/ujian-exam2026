import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper, normalisasiKodeSekolah } from '@/lib/tenant'
import { generateId } from '@/lib/utils'

// Panel Developer: daftar & pendaftaran yayasan (sekolah klien).
export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const [{ data: yayasan, error }, { data: kodeRows }] = await Promise.all([
    db.from('yayasan').select('id, kode, nama, status, catatan, created_at, aktif_at').order('created_at'),
    db.from('registrasi_kode').select('yayasan_id, used_at, expires_at'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sekarang = Date.now()
  const data = (yayasan ?? []).map((y: any) => {
    const kode = (kodeRows ?? []).filter((k: any) => k.yayasan_id === y.id)
    return {
      ...y,
      kode_aktif: kode.filter((k: any) => !k.used_at && new Date(k.expires_at).getTime() > sekarang).length,
      kode_terpakai: kode.filter((k: any) => k.used_at).length,
    }
  })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({}))
  const kode = normalisasiKodeSekolah(body.kode)
  const nama = String(body.nama ?? '').trim()
  if (!/^[A-Z0-9]{3,20}$/.test(kode)) {
    return NextResponse.json({ error: 'Kode Sekolah harus 3–20 karakter huruf besar/angka, tanpa spasi' }, { status: 400 })
  }
  if (!nama) return NextResponse.json({ error: 'Nama sekolah/yayasan wajib diisi' }, { status: 400 })

  const db = createAdminClient()
  const { data, error } = await db.from('yayasan').insert({
    id: generateId('YYS'),
    kode, nama,
    status: 'MENUNGGU',
    catatan: String(body.catatan ?? '').slice(0, 500),
    created_by: auth.user.username,
  }).select('id, kode, nama, status').single()

  if (error) {
    const bentrok = (error as any).code === '23505'
    return NextResponse.json(
      { error: bentrok ? 'Kode Sekolah sudah dipakai yayasan lain' : error.message },
      { status: bentrok ? 409 : 500 }
    )
  }
  return NextResponse.json({ data }, { status: 201 })
}
