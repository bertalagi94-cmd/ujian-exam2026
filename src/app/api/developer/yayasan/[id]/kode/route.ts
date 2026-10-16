import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import {
  requireDeveloper, buatKodeRegistrasi, hashKodeRegistrasi, MASA_BERLAKU_KODE_HARI,
} from '@/lib/tenant'

// Buat Kode Registrasi sekali pakai. Kode asli HANYA tampil di respons ini
// (database hanya menyimpan hash-nya) — developer harus langsung menyalinnya.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { data: yys } = await db.from('yayasan').select('id, kode, nama, status').eq('id', params.id).maybeSingle()
  if (!yys) return NextResponse.json({ error: 'Yayasan tidak ditemukan' }, { status: 404 })
  if (yys.status === 'NONAKTIF') return NextResponse.json({ error: 'Yayasan nonaktif' }, { status: 400 })

  const kode = buatKodeRegistrasi()
  const kedaluwarsa = new Date(Date.now() + MASA_BERLAKU_KODE_HARI * 86400_000).toISOString()
  const { error } = await db.from('registrasi_kode').insert({
    yayasan_id: yys.id,
    kode_hash: hashKodeRegistrasi(kode),
    expires_at: kedaluwarsa,
    created_by: auth.user.username,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data: { kode_registrasi: kode, kode_sekolah: yys.kode, nama: yys.nama, berlaku_sampai: kedaluwarsa },
  }, { status: 201 })
}
