import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyViewAsTokenAllowExpired } from '@/lib/auth'
import { catatAktivitas } from '@/lib/aktivitas'
import { invalidasiDipantau } from '@/lib/dipantau'

// POST /api/auth/lihat-sebagai/selesai
// Mencatat AKHIR sesi "Lihat sebagai". Sengaja TIDAK memakai requireRole():
// (1) token viewAs memang ditolak untuk method POST oleh requireRole, dan
// (2) token yang sudah kedaluwarsa tetap perlu bisa dicatat (alasan
//     KEDALUWARSA), makanya diverifikasi lewat verifyViewAsTokenAllowExpired.
// Endpoint ini hanya menulis 1 baris log; tidak memberi akses apa pun.
export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token ? verifyViewAsTokenAllowExpired(token) : null
  if (!payload) return NextResponse.json({ error: 'Bukan sesi Lihat-sebagai' }, { status: 400 })

  const kedaluwarsa = !!payload.exp && payload.exp * 1000 < Date.now()
  const db = createAdminClient()

  // Tutup penanda "sedang dipantau" supaya banner di sisi siswa langsung hilang.
  if (payload.viewAsSid) {
    const { error } = await db
      .from('log_aktivitas')
      .update({ aksi: 'DIPANTAU_SELESAI' })
      .eq('id', payload.viewAsSid)
      .eq('aksi', 'DIPANTAU_MULAI')
    if (error) console.error('Gagal tutup penanda dipantau:', error)
    invalidasiDipantau()
  }

  catatAktivitas(
    db,
    payload.impersonatorUsername!,
    'LIHAT_SEBAGAI_SELESAI',
    `Admin ${payload.impersonatorUsername} selesai melihat sebagai ${payload.role} ${payload.username} (${payload.nama}) · alasan ${kedaluwarsa ? 'KEDALUWARSA' : 'MANUAL'}`
  )
  return NextResponse.json({ ok: true })
}
