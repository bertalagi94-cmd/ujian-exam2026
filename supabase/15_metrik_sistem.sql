-- =============================================================================
-- Migrasi 15: Tabel metrik_sistem — dasar status "Server" yang NYATA
--
-- LATAR BELAKANG:
-- Status AMAN/NORMAL/WASPADA/BERAT/KRITIS di panel Monitoring Admin
-- sebelumnya dihitung dari jumlah sesi aktif + aktivitas 5 menit + jumlah
-- pelanggaran. Itu skor "kesibukan ujian", BUKAN kesehatan server — server
-- bisa saja benar-benar down/lambat sementara skor itu tetap rendah kalau
-- kebetulan sedang sepi sesi.
--
-- Tabel ini menyimpan hasil NYATA setiap request ke endpoint yang paling
-- sering dikeluhkan pengawas saat ujian berlangsung:
--   - login             (siswa/guru tidak bisa masuk)
--   - validasi_ujian    (siswa tidak bisa mulai/masuk ujian)
--   - sync_jawaban      (jawaban lambat/tidak tersimpan)
-- Setiap request dicatat: berhasil atau gagal, dan berapa lama prosesnya.
-- Dari data ini status server dihitung berdasarkan error rate & latensi
-- SUNGGUHAN dalam beberapa menit terakhir — lihat src/lib/metrik.ts dan
-- src/app/api/admin/monitoring/route.ts.
--
-- Retensi: baris yang lebih tua dari 6 jam dibuang otomatis secara
-- probabilistik saat insert baru (lihat catatMetrik() di src/lib/metrik.ts)
-- — jadi TIDAK perlu cron job terpisah untuk pembersihan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS metrik_sistem (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,           -- 'login' | 'validasi_ujian' | 'sync_jawaban'
  status TEXT NOT NULL,             -- 'ok' | 'error'
  durasi_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrik_sistem_created_at ON metrik_sistem(created_at);
CREATE INDEX IF NOT EXISTS idx_metrik_sistem_endpoint_created ON metrik_sistem(endpoint, created_at);

-- Catatan: sengaja tanpa RLS/policy tambahan — tabel ini hanya ditulis &
-- dibaca lewat createAdminClient() (service role) dari API route, sama
-- seperti pola tabel log_aktivitas yang sudah ada.
