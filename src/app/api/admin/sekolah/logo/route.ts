import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { cacheDelPrefix } from '@/lib/cache'

// Ekstensi file ditentukan dari tipe MIME yang diizinkan, BUKAN dari nama file
// kiriman klien. Nama file bisa berisi '/' atau '..' sehingga file bisa mendarat
// di folder yayasan lain di bucket 'assets'.
const EKSTENSI_GAMBAR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// Upload logo PER SEKOLAH. Query param: ?id=SKL_xxx
// Logo aplikasi (global) TIDAK diatur di sini: hanya developer yang bisa
// mengubahnya, lewat /api/developer/logo-aplikasi.
const TOLAK_LOGO_APLIKASI = 'Logo aplikasi hanya dapat diubah oleh developer.'

const MAKS_BYTES_LOGO = 2 * 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  if ((searchParams.get('type') ?? 'sekolah') !== 'sekolah') {
    return NextResponse.json({ error: TOLAK_LOGO_APLIKASI }, { status: 403 })
  }
  const sekolahId = searchParams.get('id')

  // FIX (audit upload): body non-multipart membuat formData() melempar (500),
  // dan tidak ada batas ukuran file sama sekali (upload guru & logo aplikasi
  // sudah membatasi 2 MB). Disamakan: 400 untuk body rusak, 2 MB untuk file.
  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'Body request tidak valid' }, { status: 400 })
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })
  if (file.size > MAKS_BYTES_LOGO) {
    return NextResponse.json({ error: 'Ukuran file maksimal 2MB' }, { status: 400 })
  }

  const db = tenantDb(yayasanIdDari(auth.user))
  const ext = EKSTENSI_GAMBAR[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Format logo tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.' }, { status: 400 })
  }
  // id sekolah dari query dipakai untuk menyusun nama file: pastikan id itu
  // benar-benar sekolah milik yayasan ini (bukan teks bebas berisi '/').
  if (!sekolahId) return NextResponse.json({ error: 'id sekolah diperlukan' }, { status: 400 })
  const { data: sekolahAda } = await db.from('sekolah').select('id').eq('id', sekolahId).maybeSingle()
  if (!sekolahAda) return NextResponse.json({ error: 'Sekolah tidak ditemukan' }, { status: 404 })
  // Multi-yayasan: file logo diberi folder per yayasan supaya tidak saling
  // menimpa. Yayasan awal tetap tanpa folder (alamat logo lama tidak berubah).
  const yid = yayasanIdDari(auth.user)
  const folder = yid === 'YYS_AWAL' ? '' : `${yid}/`
  const fileName = `${folder}logo-${sekolahId}.${ext}`

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
  // Tambahkan parameter cache-busting (timestamp). Nama file di storage tetap
  // sama antar-upload (upsert), jadi tanpa ini browser/CDN akan terus
  // menampilkan file lama dari cache karena URL-nya persis sama setiap kali.
  const url = `${urlData.publicUrl}?v=${Date.now()}`

  await db.from('sekolah').update({ logo_url: url }).eq('id', sekolahId)

  // Hapus cache in-memory endpoint publik supaya perubahan langsung terlihat,
  // tidak perlu menunggu TTL 60 detik.
  cacheDelPrefix('pengaturan:')

  return NextResponse.json({ url })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const { searchParams } = new URL(req.url)
  if ((searchParams.get('type') ?? 'sekolah') !== 'sekolah') {
    return NextResponse.json({ error: TOLAK_LOGO_APLIKASI }, { status: 403 })
  }
  const sekolahId = searchParams.get('id')

  const db = tenantDb(yayasanIdDari(auth.user))

  if (sekolahId) {
    await db.from('sekolah').update({ logo_url: '' }).eq('id', sekolahId)
  }

  cacheDelPrefix('pengaturan:')

  return NextResponse.json({ message: 'Logo berhasil dihapus' })
}
