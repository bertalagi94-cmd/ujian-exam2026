import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper, multiYayasanAktif } from '@/lib/tenant'
import { cacheDelPrefix } from '@/lib/cache'
import { kirimWa } from '@/lib/wa'

export const dynamic = 'force-dynamic'

const PESAN: Record<string, [string, number]> = {
  TIDAK_DITEMUKAN: ['Pengajuan tidak ditemukan', 404],
  SUDAH_DIPUTUSKAN: ['Pengajuan ini sudah diputuskan sebelumnya', 409],
  USERNAME_DIPAKAI: ['Username pengajuan ini sudah dipakai akun lain. Tolak pengajuan dan minta sekolah mengajukan ulang dengan username berbeda', 409],
  KODE_BENTROK: ['Gagal membuat kode sekolah, coba lagi', 500],
}

async function beritahu(noHp: string | null, pesan: string) {
  if (!noHp) return
  try { await Promise.race([kirimWa(noHp, pesan), new Promise(r => setTimeout(r, 4000))]) } catch { /* abaikan */ }
}

// Setujui / tolak pengajuan. Body: { aksi: 'SETUJUI' } atau { aksi: 'TOLAK', alasan }.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({}))
  const aksi = String(body.aksi ?? '')
  const db = createAdminClient()

  const { data: p } = await db.from('pengajuan_sekolah')
    .select('id, nama_sekolah, no_hp, status').eq('id', params.id).maybeSingle()
  if (!p) return NextResponse.json({ error: PESAN.TIDAK_DITEMUKAN[0] }, { status: 404 })

  if (aksi === 'SETUJUI') {
    // Yayasan baru berisiko membocorkan data kalau isolasi belum teruji, dan
    // backup/reset/restore baru terkunci saat saklar menyala. Jadi tolak
    // persetujuan selama saklar mati.
    if (!multiYayasanAktif()) {
      return NextResponse.json({ error: 'Mode multi-yayasan belum dinyalakan (MULTI_YAYASAN_ENABLED). Persetujuan ditolak demi keamanan data.' }, { status: 409 })
    }
    const { data, error } = await db.rpc('setujui_pengajuan_atomik', {
      p_pengajuan_id: params.id,
      p_oleh: auth.user.username,
    })
    if (error) {
      console.error('setujui_pengajuan_atomik gagal:', error)
      return NextResponse.json({ error: 'Persetujuan gagal, coba lagi' }, { status: 500 })
    }
    if (!data?.ok) {
      const [pesan, status] = PESAN[data?.kode] ?? ['Persetujuan gagal', 400]
      return NextResponse.json({ error: pesan }, { status })
    }
    cacheDelPrefix('yayasan:')
    await beritahu(p.no_hp, `Pengajuan aktivasi ${p.nama_sekolah} DISETUJUI. Silakan login di ${req.nextUrl.origin}/login memakai username dan password yang Anda daftarkan.`)
    return NextResponse.json({ data: { kode_sekolah: data.kode_sekolah }, message: 'Pengajuan disetujui' })
  }

  if (aksi === 'TOLAK') {
    const alasan = String(body.alasan ?? '').trim().slice(0, 300)
    if (!alasan) return NextResponse.json({ error: 'Alasan penolakan wajib diisi' }, { status: 400 })
    // Syarat status MENUNGGU di klausa update: aman terhadap klik ganda / balapan dengan "Setujui".
    const { data: baris, error } = await db.from('pengajuan_sekolah')
      .update({ status: 'DITOLAK', alasan_tolak: alasan, diputuskan_oleh: auth.user.username, diputuskan_at: new Date().toISOString() })
      .eq('id', params.id).eq('status', 'MENUNGGU').select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!baris || baris.length === 0) return NextResponse.json({ error: PESAN.SUDAH_DIPUTUSKAN[0] }, { status: 409 })
    await beritahu(p.no_hp, `Pengajuan aktivasi ${p.nama_sekolah} ditolak. Alasan: ${alasan}`)
    return NextResponse.json({ message: 'Pengajuan ditolak' })
  }

  return NextResponse.json({ error: "aksi harus 'SETUJUI' atau 'TOLAK'" }, { status: 400 })
}
