-- =============================================================================
-- Migrasi 31: live_screen_signal — signaling WebRTC untuk fitur "Minta layar"
-- =============================================================================
-- Tabel ini BUKAN tempat menyimpan video/rekaman apa pun. Isinya cuma pesan
-- pendek untuk "kenalan" antara browser admin & browser siswa (SDP offer/
-- answer, kandidat ICE, status terima/tolak) supaya keduanya bisa membentuk
-- koneksi WebRTC langsung. Begitu video mengalir, video itu LANGSUNG
-- antar-browser (peer-to-peer) — tidak pernah singgah/tersimpan di server
-- atau di tabel ini.
--
-- Setiap baris dihapus SEGERA setelah dibaca oleh penerimanya (lihat
-- src/app/api/live-screen/poll/route.ts) — jadi tabel ini selalu (hampir)
-- kosong dalam kondisi normal, dan baris yang lebih tua dari beberapa menit
-- dibersihkan otomatis sebagai jaring pengaman kalau salah satu pihak
-- menutup tab sebelum sempat poll/STOP.
--
-- RLS: SENGAJA tidak diberi policy sama sekali (default deny total), sama
-- seperti pola hardening di migrasi 05 & 23 untuk tabel sensitif lain
-- (siswa_ujian, pelanggaran) — tabel ini HANYA boleh diakses lewat service
-- role dari API route Next.js yang sudah memverifikasi JWT (requireRole),
-- tidak pernah lewat anon key dari browser secara langsung.

CREATE TABLE IF NOT EXISTS live_screen_signal (
  id             TEXT PRIMARY KEY,
  nis            TEXT NOT NULL,
  sesi_id        TEXT NOT NULL,
  admin_username TEXT NOT NULL,
  -- Siapa yang SEHARUSNYA membaca baris ini berikutnya.
  target_role    TEXT NOT NULL CHECK (target_role IN ('ADMIN', 'SISWA')),
  -- REQUEST/ANSWER/ICE/STOP dikirim admin→siswa (lewat target_role=SISWA);
  -- ACCEPT/REJECT/OFFER/ICE/STOP dikirim siswa→admin (target_role=ADMIN).
  type           TEXT NOT NULL CHECK (type IN ('REQUEST', 'ACCEPT', 'REJECT', 'OFFER', 'ANSWER', 'ICE', 'STOP')),
  -- JSON string: SDP untuk OFFER/ANSWER, kandidat ICE untuk ICE, kosong
  -- untuk REQUEST/ACCEPT/REJECT/STOP.
  payload        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dipakai endpoint poll ADMIN: WHERE admin_username=? AND nis=? AND
-- sesi_id=? AND target_role='ADMIN' ORDER BY created_at.
CREATE INDEX IF NOT EXISTS idx_lss_poll_admin
  ON live_screen_signal (admin_username, nis, sesi_id, target_role, created_at);

-- Dipakai endpoint poll SISWA: WHERE nis=? AND target_role='SISWA'
-- ORDER BY created_at. (siswa hanya bisa berada di satu sesi aktif sekaligus,
-- jadi tidak perlu filter sesi_id di sisi index ini.)
CREATE INDEX IF NOT EXISTS idx_lss_poll_siswa
  ON live_screen_signal (nis, target_role, created_at);

-- Dipakai cleanup opportunistic (hapus baris basi > beberapa menit).
CREATE INDEX IF NOT EXISTS idx_lss_created_at
  ON live_screen_signal (created_at);

ALTER TABLE live_screen_signal ENABLE ROW LEVEL SECURITY;
-- Tidak ada CREATE POLICY di sini dengan sengaja — default PostgreSQL RLS
-- tanpa policy = tolak semua (termasuk anon & authenticated). Hanya
-- SUPABASE_SERVICE_ROLE_KEY (dipakai createAdminClient() di server) yang
-- bisa baca/tulis tabel ini.
