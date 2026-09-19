-- =============================================================================
-- Migrasi: Jalur essay OFFLINE lewat "amplop terenkripsi" + kode darurat
--
-- LATAR BELAKANG
-- Fase essay sengaja punya gerbang izin (toggle `akses_mulai_essay_dibuka`,
-- lihat 11_akses_mulai_essay.sql): soal essay tidak boleh terbaca siswa
-- sebelum pengawas mengizinkan. Masalahnya, kalau internet mati total, siswa
-- tidak bisa lagi menerima izin itu dari server.
--
-- DESAIN (ringkas — detail lengkap di src/lib/essay-amplop-server.ts)
--   1. Begitu siswa mulai PG, server mengirim soal essay dalam bentuk
--      TERENKRIPSI (AES-256-GCM) ke perangkat siswa. Isinya tidak terbaca.
--   2. Kunci enkripsi diturunkan (PBKDF2) dari KODE DARURAT. Kode ini TIDAK
--      pernah dikirim ke perangkat siswa lewat jaringan — hanya tampil di
--      dashboard pengawas, lalu sampai ke siswa lewat jalur manusia
--      (dibacakan / ditulis di papan).
--   3. Siswa memasukkan kode → perangkat mencoba mendekripsi. Berhasil =
--      soal terbuka. Tidak ada perbandingan string "kode == benar" di client.
--   4. Begitu internet pulih, client melapor ke /essay/mulai (rekonsiliasi)
--      sehingga status_essay & waktu_mulai_essay di server ikut tercatat.
--
-- Tabel ini mencatat: perangkat/siswa MANA yang sudah menerima amplop (supaya
-- pengawas tahu siapa yang kodenya TIDAK akan berfungsi), kapan siswa membuka
-- essay secara offline (klaim client, sudah di-clamp server), dan penghitung
-- percobaan kode di server (anti tebak-tebakan lewat API).
--
-- Aman dijalankan ulang (IF NOT EXISTS / OR REPLACE).
-- =============================================================================

CREATE TABLE IF NOT EXISTS essay_amplop_offline (
  sesi_id                   TEXT        NOT NULL,
  nis                       TEXT        NOT NULL,
  paket_essay_id            TEXT,
  dikirim_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Waktu siswa membuka essay secara offline, sesuai klaim client yang sudah
  -- dibatasi server ke rentang [dikirim_at, waktu rekonsiliasi]. Ini yang
  -- dijadikan waktu_mulai_essay resmi kalau jalur darurat dipakai.
  dibuka_offline_at         TIMESTAMPTZ,
  rekonsiliasi_at           TIMESTAMPTZ,
  -- Berapa kali siswa salah memasukkan kode di perangkatnya (dilaporkan
  -- client saat rekonsiliasi; bisa dimanipulasi, hanya untuk bahan audit).
  percobaan_salah_offline   INTEGER     NOT NULL DEFAULT 0,
  -- Berapa kali kode dikirim ke server untuk diverifikasi (dihitung server,
  -- atomik — lihat fungsi essay_amplop_hitung_percobaan di bawah).
  percobaan_server          INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (sesi_id, nis)
);

CREATE INDEX IF NOT EXISTS idx_essay_amplop_offline_sesi ON essay_amplop_offline(sesi_id);

-- Tabel ini hanya boleh diakses lewat createAdminClient() (service role).
-- PENTING: tabel yang dibuat lewat SQL editor Supabase otomatis mendapat grant
-- lebar untuk role anon/authenticated — lihat kasus tabel `jawaban` di
-- 05_fix_rls.sql. RLS diaktifkan TANPA policy + grant dicabut, supaya
-- NEXT_PUBLIC_SUPABASE_ANON_KEY (yang ter-bundle ke browser) tidak bisa
-- membaca/menulis tabel ini lewat REST API Supabase.
ALTER TABLE essay_amplop_offline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON essay_amplop_offline FROM anon, authenticated;

-- Penghitung percobaan ATOMIK. Naikkan dulu, baru dicek di aplikasi —
-- kalau dicek dulu baru dinaikkan (baca-lalu-tulis), 1000 request paralel
-- bisa lolos semua karena sama-sama membaca hitungan yang masih 0.
-- Mengembalikan hitungan terbaru, atau NULL kalau baris (sesi, nis) tidak
-- ada = amplop tidak pernah diterbitkan untuk siswa ini.
CREATE OR REPLACE FUNCTION essay_amplop_hitung_percobaan(p_sesi_id TEXT, p_nis TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_hasil INTEGER;
BEGIN
  UPDATE essay_amplop_offline
     SET percobaan_server = percobaan_server + 1
   WHERE sesi_id = p_sesi_id AND nis = p_nis
  RETURNING percobaan_server INTO v_hasil;
  RETURN v_hasil;
END;
$$;

REVOKE EXECUTE ON FUNCTION essay_amplop_hitung_percobaan(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
