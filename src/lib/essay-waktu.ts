// Taruh di: src/lib/essay-waktu.ts
//
// FIX BUG (tidak ada validasi batas waktu server-side untuk fase Essay):
// Fase PG sudah punya jaring pengaman di src/app/api/siswa/ujian/selesai/route.ts
// yang menolak submit begitu Date.now() > waktu_mulai_awal + sesi.durasi + toleransi.
// Fase Essay TIDAK punya pengaman yang sama sama sekali — essay/jawab,
// essay/upload-foto, dan essay/kirim hanya mengecek status/status_essay, tidak
// pernah membandingkan waktu_mulai_essay dengan essay_durasi_menit. Akibatnya
// timer essay di sisi siswa murni kepercayaan pada client (countdown browser):
// kalau siswa memanipulasi/mem-bypass timer client (devtools, replay request,
// dsb), dia bisa terus mengetik/upload/kirim jauh melewati durasi yang
// ditentukan guru tanpa pernah ditolak sistem.
//
// FIX: helper tunggal ini dipakai oleh SEMUA endpoint essay siswa (jawab,
// upload-foto, kirim) untuk menolak aksi begitu batas waktu essay terlampaui —
// pola & toleransi (60 detik grace period jaringan) sengaja disamakan persis
// dengan pengecekan PG di selesai/route.ts, supaya perilaku konsisten.
export function sudahLewatBatasWaktuEssay(
  waktuMulaiEssay: string | null | undefined,
  durasiMenit: number | null | undefined
): boolean {
  if (!waktuMulaiEssay || !durasiMenit) return false
  const batasWaktu = new Date(waktuMulaiEssay).getTime() + durasiMenit * 60 * 1000
  const toleransiMs = 60 * 1000 // 60 detik grace period untuk jeda jaringan, sama seperti PG
  return Date.now() > batasWaktu + toleransiMs
}
