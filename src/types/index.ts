export type Role = 'ADMIN' | 'GURU' | 'KEPSEK' | 'SISWA'

export interface Sekolah {
  id: string
  label: string           // Label singkat, misal "MTs", "SMA/MA"
  nama_sekolah: string
  npsn?: string
  nama_kepsek?: string
  nip_kepsek?: string
  alamat?: string
  kota?: string
  tahun_ajaran?: string
  logo_url?: string
  urutan?: number
  created_at?: string
}

export interface User {
  username: string
  nama: string
  role: Role
  last_login?: string
  status: string
  is_tester?: string
  no_hp?: string | null
  nip?: string
  sekolah_id?: string | null
  sekolah?: { id: string; label: string; nama_sekolah: string } | null
}

export interface Siswa {
  nis: string
  nama: string
  kelas: string
  status: string
  tempat_lahir?: string
  tanggal_lahir?: string
  jenis_kelamin?: string
  last_login?: string
  device_info?: string
  is_tester?: string
}

export interface Kelas {
  id: string
  nama: string
  jurusan?: string
  wali_kelas?: string
  jumlah?: number
  sekolah_id?: string | null
  sekolah?: { id: string; label: string; nama_sekolah: string } | null
}

export interface Mapel {
  id: string
  nama: string
  guru_id?: string
  kelas_list?: string
  jumlah_opsi: number
  kkm: number
  // joined
  nama_guru?: string
}

export interface KelasMapel {
  id: string
  kelas_id: string
  nama_kelas: string
  mapel_id: string
  nama_mapel: string
  status: string
}

export interface Jadwal {
  id: string
  tanggal: string
  sesi: number
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  pengawas?: string
  durasi: number
  status: 'AKTIF' | 'BERJALAN' | 'SELESAI'
  // joined
  nama_mapel?: string
  nama_pengawas?: string
  status_soal?: 'BELUM_ADA' | 'DRAFT' | 'MENUNGGU' | 'DITOLAK' | 'DISETUJUI'
  status_soal_guru?: string | null
  // Pengawas yang BENAR-BENAR aktif sekarang (bisa pengawas asli, atau
  // pengawas susulan yang ditugaskan admin saat membuka ujian susulan).
  // Hanya relevan ketika status === 'BERJALAN'.
  pengawas_aktif?: string | null
  is_pengawas_susulan?: boolean
  // Diisi khusus untuk akun siswa: true kalau siswa ini sudah submit
  // jawaban untuk jadwal ini (lihat src/app/api/siswa/jadwal/route.ts).
  sudah_ikut?: boolean
  nilai_id?: string | null
  // Diisi hanya untuk jadwal berstatus SELESAI: daftar siswa aktif di kelas
  // ini yang belum punya nilai untuk mapel ini (lihat enrichment di
  // /api/admin/jadwal). Array kosong kalau semua siswa sudah ujian.
  siswa_belum_ujian?: { nis: string; nama: string }[]
}

export interface PaketSoal {
  id: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  status: 'DRAFT' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'
  tanggal: string
  catatan?: string
  jumlah_soal: number
  acak: 'YA' | 'TIDAK'
  mode_jawaban: 'DIGITAL' | 'KERTAS'
  // joined
  nama_mapel?: string
  nama_guru?: string
  nama_kelas?: string
}

export interface Soal {
  id: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  teks: string
  opsi_a: string
  opsi_b: string
  opsi_c: string
  opsi_d?: string
  opsi_e?: string
  kunci: 'A' | 'B' | 'C' | 'D' | 'E'
  pembahasan?: string
  tingkat: 'Mudah' | 'Sedang' | 'Sulit'
  jumlah_opsi: number
  status: 'DRAFT' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'
  tanggal?: string
  gambar_url?: string
  paket_id?: string
}

export interface PaketEssay {
  id: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  status: 'DRAFT' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'
  tanggal: string
  catatan?: string
  jumlah_soal: number
  mode_jawaban: 'DIGITAL' | 'KERTAS'
  durasi_menit: number
  // FIX (bobot PG:Essay): bobot nilai sekarang diatur di sini (per
  // mapel+kelas), bukan lagi per jadwal — lihat 09_bobot_paket_essay.sql.
  bobot_pg_persen: number
  bobot_essay_persen: number
  // joined
  nama_mapel?: string
  nama_kelas?: string
  nama_guru?: string
}

export interface SoalEssay {
  id: string
  paket_essay_id?: string
  mapel_id: string
  kelas_id: string
  guru_id: string
  teks: string
  gambar_url?: string
  bobot_maks: number
  urutan: number
  status: 'DRAFT' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'
}

export interface SesiUjian {
  id: string
  jadwal_id?: string
  mapel_id: string
  kelas: string
  durasi: number
  waktu_mulai: string
  waktu_selesai?: string
  status: 'BERJALAN' | 'SELESAI'
  jumlah_peserta: number
  kode_sesi: string
  // joined
  nama_mapel?: string
}

export interface SiswaUjian {
  sesi_id: string
  nis: string
  waktu_daftar: string
  waktu_mulai?: string
  status: 'AKTIF' | 'SELESAI' | 'TERKUNCI'
  waktu_selesai?: string
  device_id?: string
  // joined
  nama_siswa?: string
}

export interface Nilai {
  id: string
  sesi_id: string
  nis: string
  mapel_id: string
  kelas: string
  benar: number
  total: number
  nilai: number
  grade: string
  timestamp: string
  lulus: boolean
  kkm: number
  // FIX (bug nilai essay tidak tampil di siswa): field gabungan PG+essay.
  // Selalu null selama guru belum merilis (lihat masking di
  // /api/siswa/nilai dan /api/siswa/dashboard) — jadi aman dikonsumsi
  // langsung oleh UI siswa tanpa perlu cek tambahan di client.
  nilai_essay?: number | null
  nilai_total?: number | null
  dirilis?: boolean
  essay_aktif?: boolean
  essay_belum_dirilis?: boolean
  // joined
  nama_siswa?: string
  nama_mapel?: string
  // FITUR BARU (riwayat pelanggaran untuk guru pengampu): diisi oleh
  // /api/guru/nilai — daftar pelanggaran (kecurangan) siswa selama sesi
  // ujian ini, supaya guru pengampu bisa melihat kondisi siswa selama
  // ujian, bukan cuma nilai akhirnya.
  pelanggaran?: Pelanggaran[]
  jumlah_pelanggaran?: number
}

export interface Jawaban {
  id?: number
  sesi_id: string
  nis: string
  soal_id: string
  jawaban?: string
  updated_at?: string
  sync_status?: string
}

export interface Pelanggaran {
  id: string
  sesi_id: string
  nis: string
  jenis: string
  level: number
  detail?: string
  status: string
  created_at: string
  // joined
  nama_siswa?: string
}

export interface Pengaturan {
  key: string
  value: string
  deskripsi?: string
}

export interface AuthUser {
  username: string
  nama: string
  role: Role
  nis?: string
  kelas?: string
  token: string
}

// API Response wrapper
export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}
