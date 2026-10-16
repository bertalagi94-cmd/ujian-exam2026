import { SupabaseClient } from '@supabase/supabase-js'
import { JWTPayload } from '@/lib/auth'

// Izin akses Layar Pantau.
// - GURU: wajib disetujui admin dulu (tabel izin_layar_pantau, migrasi 44).
// - KEPSEK / ADMIN: tidak perlu izin.
// Izin berlaku MASA_IZIN_JAM jam sejak disetujui (sama dengan umur token login).

export const MASA_IZIN_JAM = 10

export type StatusIzin =
  | 'TIDAK_PERLU'
  | 'BELUM_ADA'
  | 'MENUNGGU'
  | 'DISETUJUI'
  | 'DITOLAK'
  | 'DICABUT'
  | 'KEDALUWARSA'

export interface InfoIzin {
  status: StatusIzin
  id?: string
  berlakuSampai?: string | null
  diputuskanOleh?: string | null
}

type Viewer = Pick<JWTPayload, 'role' | 'username' | 'viewAs'>

export function izinDiperlukan(user: Pick<JWTPayload, 'role' | 'viewAs'>): boolean {
  // Mode "Lihat sebagai" dipakai admin sendiri, jadi tidak perlu izin lagi.
  return user.role === 'GURU' && !user.viewAs
}

export async function ambilInfoIzin(db: SupabaseClient<any>, user: Viewer): Promise<InfoIzin> {
  if (!izinDiperlukan(user)) return { status: 'TIDAK_PERLU' }

  const { data, error } = await db
    .from('izin_layar_pantau')
    .select('id, status, berlaku_sampai, diputuskan_oleh')
    .eq('username', user.username)
    .order('diminta_pada', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error('Gagal memeriksa izin Layar Pantau.')
  if (!data) return { status: 'BELUM_ADA' }

  if (data.status === 'DISETUJUI') {
    const habis = data.berlaku_sampai && new Date(data.berlaku_sampai).getTime() <= Date.now()
    if (habis) {
      return { status: 'KEDALUWARSA', id: data.id, berlakuSampai: data.berlaku_sampai, diputuskanOleh: data.diputuskan_oleh }
    }
  }
  return {
    status: data.status as StatusIzin,
    id: data.id,
    berlakuSampai: data.berlaku_sampai,
    diputuskanOleh: data.diputuskan_oleh,
  }
}

/** Mengembalikan Response 403 kalau guru belum punya izin aktif, atau null kalau boleh lanjut. */
export async function tolakJikaBelumDiizinkan(
  db: SupabaseClient<any>,
  user: Viewer
): Promise<Response | null> {
  if (!izinDiperlukan(user)) return null
  let info: InfoIzin
  try {
    info = await ambilInfoIzin(db, user)
  } catch {
    return new Response(JSON.stringify({ error: 'Gagal memeriksa izin Layar Pantau.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (info.status === 'DISETUJUI') return null
  return new Response(
    JSON.stringify({
      error: 'Akses Layar Pantau belum disetujui admin.',
      kode: 'IZIN_PANTAU_BELUM_ADA',
      statusIzin: info.status,
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  )
}
