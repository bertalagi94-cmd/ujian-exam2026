// Taruh di: src/app/api/guru/mode-pengawas/kode-darurat-essay/route.ts
// GET ?sesiId=... — tampilkan KODE DARURAT essay untuk sesi ini (hanya untuk
// pengawas sah sesi) beserta cakupan amplop terenkripsinya.
//
// Kode ini SATU-SATUNYA tempat kode darurat pernah ditampilkan. Ia tidak
// pernah dikirim ke perangkat siswa lewat jaringan — sampai ke siswa lewat
// jalur manusia (dibacakan/ditulis di papan) HANYA saat internet mati.
//
// Selain kode, endpoint ini melaporkan siapa yang SUDAH memegang amplop dan
// siapa yang BELUM. Siswa yang belum memegang amplop (mis. tidak pernah online
// sejak login sampai selesai PG) tidak akan bisa membuka essay dengan kode ini
// — pengawas perlu menanganinya secara manual (kode tidak akan berfungsi).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { hitungKodeDarurat } from '@/lib/essay-amplop-server'
import { PANJANG_KODE_DARURAT } from '@/lib/essay-amplop-shared'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const sesiId = new URL(req.url).searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, status, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // Hanya pengawas sah (asli atau pengganti susulan) — sama seperti toggle akses essay.
  const sah = await verifySesiOwnership(db, sesiId, user.username)
  if (!sah) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })

  if (!sesi.info_json?.essay_aktif) {
    return NextResponse.json({ error: 'Sesi ini tidak memiliki fitur essay' }, { status: 400 })
  }
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi sudah tidak berjalan.' }, { status: 409 })
  }

  // Siswa yang sudah login ke sesi ini vs siswa yang sudah memegang amplop.
  const [{ data: siswaUjian }, { data: amplopRows }] = await Promise.all([
    db.from('siswa_ujian').select('nis, status, status_essay').eq('sesi_id', sesiId),
    db.from('essay_amplop_offline')
      .select('nis, rekonsiliasi_at, dibuka_offline_at')
      .eq('sesi_id', sesiId),
  ])

  const punyaAmplop = new Set((amplopRows ?? []).map(r => r.nis))
  const login = siswaUjian ?? []

  // Siswa yang masih relevan untuk dicek: belum selesai essay & tidak
  // terkunci. Yang sudah selesai/mengerjakan essay tidak butuh amplop lagi.
  const perluAmplop = login.filter(s =>
    !['SUDAH_KIRIM', 'TIDAK_MENGERJAKAN', 'MENGERJAKAN'].includes(s.status_essay ?? '')
  )
  const nisBelum = perluAmplop.filter(s => !punyaAmplop.has(s.nis)).map(s => s.nis)

  let belumAmplop: { nis: string; nama: string }[] = []
  if (nisBelum.length > 0) {
    const { data: namaRows } = await db.from('siswa').select('nis, nama').in('nis', nisBelum)
    const namaMap = new Map((namaRows ?? []).map(r => [r.nis, r.nama]))
    belumAmplop = nisBelum.map(nis => ({ nis, nama: namaMap.get(nis) ?? nis }))
  }

  const res = NextResponse.json({
    kode: hitungKodeDarurat(sesiId),
    panjangKode: PANJANG_KODE_DARURAT,
    jumlahLogin: login.length,
    jumlahPerluAmplop: perluAmplop.length,
    jumlahSudahAmplop: perluAmplop.length - nisBelum.length,
    belumAmplop,
    jumlahBukaOffline: (amplopRows ?? []).filter(r => r.dibuka_offline_at).length,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
