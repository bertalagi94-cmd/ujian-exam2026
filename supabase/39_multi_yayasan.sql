-- =============================================================================
-- Migrasi 39: Fondasi multi-yayasan (satu database, banyak sekolah/yayasan)
--
-- LATAR BELAKANG
-- Sekarang satu instalasi = satu yayasan. Sekolah lain yang ingin memakai
-- aplikasi harus membuat project Supabase sendiri. Migrasi ini menyiapkan
-- fondasi supaya banyak yayasan bisa berbagi SATU database dengan data yang
-- terpisah:
--
--   yayasan          = pemilik data / "tenant" (mis. Yayasan Agrabil). Punya
--                      `kode` pendek yang dipakai saat login (Kode Sekolah).
--   sekolah (lama)   = tetap dipakai sebagai JENJANG di dalam yayasan
--                      (SMP, SMA, dst). Hanya ditambah kolom yayasan_id.
--   registrasi_kode  = kode sekali pakai yang dibuat developer; dipakai
--                      sekolah baru untuk mendaftar sendiri.
--
-- YANG DILAKUKAN MIGRASI INI
--   1. Membuat tabel yayasan dan registrasi_kode (RLS aktif, hak anon dicabut).
--   2. Menambah kolom yayasan_id ke tabel-tabel utama, mengisi semua data
--      yang SUDAH ADA ke satu yayasan awal (id 'YYS_AWAL'), dan memasang
--      DEFAULT 'YYS_AWAL' supaya kode lama yang belum diubah tetap menulis
--      ke yayasan awal (satu-satunya yayasan aktif selama masa transisi).
--   3. Membuat fungsi atomik registrasi_yayasan_atomik() untuk pendaftaran
--      sekolah baru dalam SATU transaksi.
--
-- YANG BELUM DILAKUKAN (sengaja — lihat docs/MULTI_YAYASAN.md, Fase 2)
--   - Primary key siswa(nis), users(username), pengaturan(key) masih GLOBAL.
--     Index unik per-yayasan sudah disiapkan di bawah supaya penggantian PK
--     di Fase 2 mulus, tapi sampai saat itu NIS/username tidak boleh sama
--     antar yayasan.
--   - Tabel volume besar (jawaban, siswa_ujian, pelanggaran, jawaban_essay*,
--     dll.) belum diberi yayasan_id; tetap terikat lewat sesi_id yang unik.
--   - Route API belum memfilter per yayasan. KARENA ITU pendaftaran yayasan
--     baru dikunci oleh env MULTI_YAYASAN_ENABLED (default mati). Jangan
--     aktifkan sebelum Fase 2 selesai, kalau tidak yayasan baru bisa melihat
--     data yayasan lain.
--
-- Idempotent: aman dijalankan ulang. Jalankan SETELAH migrasi 23 (hardening).
-- Jalankan di database dulu, baru deploy kodenya.
-- =============================================================================

-- ── 1. Tabel yayasan ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS yayasan (
  id          TEXT PRIMARY KEY,
  kode        TEXT NOT NULL UNIQUE,
  nama        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'MENUNGGU',
  catatan     TEXT DEFAULT '',
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  aktif_at    TIMESTAMPTZ,
  CONSTRAINT yayasan_kode_format CHECK (kode ~ '^[A-Z0-9]{3,20}$'),
  CONSTRAINT yayasan_status_valid CHECK (status IN ('MENUNGGU', 'AKTIF', 'NONAKTIF'))
);

-- ── 2. Tabel kode registrasi (kode asli TIDAK disimpan, hanya hash SHA-256) ──
CREATE TABLE IF NOT EXISTS registrasi_kode (
  id          BIGSERIAL PRIMARY KEY,
  yayasan_id  TEXT NOT NULL REFERENCES yayasan(id) ON DELETE CASCADE,
  kode_hash   TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_registrasi_kode_yayasan ON registrasi_kode(yayasan_id);

-- Pola wajib repo (lihat README): RLS aktif tanpa policy + cabut hak.
ALTER TABLE yayasan         ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrasi_kode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yayasan         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON registrasi_kode FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE registrasi_kode_id_seq FROM PUBLIC, anon, authenticated;

-- ── 3. Yayasan awal = semua data yang sudah berjalan sekarang ───────────────
-- Nama diambil dari pengaturan.namaSekolah kalau ada. Kode awal 'UTAMA' bisa
-- diganti dari Panel Developer (mis. jadi 'AGRABIL').
INSERT INTO yayasan (id, kode, nama, status, aktif_at, created_by)
SELECT 'YYS_AWAL',
       'UTAMA',
       COALESCE(NULLIF(TRIM((SELECT value FROM pengaturan WHERE key = 'namaSekolah')), ''), 'Yayasan Utama'),
       'AKTIF',
       NOW(),
       'migrasi-39'
ON CONFLICT (id) DO NOTHING;

-- ── 4. Kolom yayasan_id di tabel utama ──────────────────────────────────────
-- Tabel volume besar sengaja TIDAK ada di daftar ini (lihat catatan di atas).
DO $$
DECLARE
  t TEXT;
  tabel TEXT[] := ARRAY[
    'sekolah', 'users', 'siswa', 'kelas', 'mapel', 'kelas_mapel', 'jadwal',
    'sesi_ujian', 'nilai', 'paket_soal', 'soal', 'paket_essay', 'soal_essay',
    'kisi_kisi', 'pengaturan', 'log_aktivitas'
  ];
BEGIN
  FOREACH t IN ARRAY tabel LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabel % tidak ada, dilewati', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS yayasan_id TEXT', t);

    -- Isi data lama ke yayasan awal. Baris yang sudah punya nilai tidak disentuh.
    EXECUTE format('UPDATE %I SET yayasan_id = %L WHERE yayasan_id IS NULL', t, 'YYS_AWAL');

    -- Selama masa transisi, kode lama yang belum diubah tetap menulis ke
    -- yayasan awal. DEFAULT ini DIHAPUS di Fase 2 (bersama SET NOT NULL).
    EXECUTE format('ALTER TABLE %I ALTER COLUMN yayasan_id SET DEFAULT %L', t, 'YYS_AWAL');

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_yayasan_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (yayasan_id) REFERENCES yayasan(id)',
        t, t || '_yayasan_id_fkey'
      );
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (yayasan_id)', 'idx_' || t || '_yayasan', t);
  END LOOP;
END $$;

-- ── 5. Index unik per-yayasan (persiapan Fase 2: ganti PK global) ───────────
-- Aman sekarang: kalau nilai sudah unik global, otomatis unik per yayasan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_siswa_yayasan_nis
  ON siswa (yayasan_id, nis);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_yayasan_username
  ON users (yayasan_id, username);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pengaturan_yayasan_key
  ON pengaturan (yayasan_id, key);

-- ── 6. Fungsi atomik: registrasi sekolah baru dengan kode registrasi ────────
-- Dalam SATU transaksi: klaim kode (sekali pakai), buat akun ADMIN yayasan,
-- buat jenjang-jenjangnya, tandai yayasan AKTIF. Kalau salah satu gagal,
-- semuanya dibatalkan dan kode TIDAK terpakai.
--
-- p_jenjang: array JSON [{"label":"SMP","nama_sekolah":"SMP Contoh",
--                         "npsn":"...","kota":"..."}]
-- Mengembalikan JSON {ok:boolean, kode:<kode galat>|null, yayasan_id, kode_sekolah}.
CREATE OR REPLACE FUNCTION registrasi_yayasan_atomik(
  p_kode_hash      TEXT,
  p_username       TEXT,
  p_password_hash  TEXT,
  p_nama           TEXT,
  p_no_hp          TEXT,
  p_jenjang        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg  registrasi_kode%ROWTYPE;
  v_yay  yayasan%ROWTYPE;
  j      JSONB;
  v_urut INTEGER := 0;
BEGIN
  IF p_jenjang IS NULL
     OR jsonb_typeof(p_jenjang) <> 'array'
     OR jsonb_array_length(p_jenjang) < 1
     OR jsonb_array_length(p_jenjang) > 10 THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'JENJANG_TIDAK_VALID');
  END IF;

  -- Kunci baris kode supaya dua pendaftaran bersamaan tidak lolos keduanya.
  SELECT * INTO v_reg FROM registrasi_kode WHERE kode_hash = p_kode_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'KODE_TIDAK_VALID');
  END IF;
  IF v_reg.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'KODE_SUDAH_DIPAKAI');
  END IF;
  IF v_reg.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'KODE_KEDALUWARSA');
  END IF;

  SELECT * INTO v_yay FROM yayasan WHERE id = v_reg.yayasan_id FOR UPDATE;
  IF NOT FOUND OR v_yay.status = 'NONAKTIF' THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'YAYASAN_NONAKTIF');
  END IF;

  -- Fase 1: username masih unik global (PK users). Fase 2 mengubahnya.
  IF EXISTS (SELECT 1 FROM users WHERE username = p_username) THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'USERNAME_DIPAKAI');
  END IF;

  INSERT INTO users (username, password_hash, nama, role, status, no_hp, yayasan_id)
  VALUES (p_username, p_password_hash, p_nama, 'ADMIN', 'AKTIF', NULLIF(p_no_hp, ''), v_yay.id);

  FOR j IN SELECT * FROM jsonb_array_elements(p_jenjang) LOOP
    v_urut := v_urut + 1;
    INSERT INTO sekolah (id, label, nama_sekolah, npsn, kota, urutan, yayasan_id)
    VALUES (
      'SKL_' || substr(md5(random()::text || clock_timestamp()::text || v_urut::text), 1, 12),
      COALESCE(NULLIF(TRIM(j->>'label'), ''), 'Sekolah'),
      COALESCE(NULLIF(TRIM(j->>'nama_sekolah'), ''), v_yay.nama),
      COALESCE(j->>'npsn', ''),
      COALESCE(j->>'kota', ''),
      v_urut,
      v_yay.id
    );
  END LOOP;

  UPDATE registrasi_kode SET used_at = NOW(), used_by = p_username WHERE id = v_reg.id;
  UPDATE yayasan SET status = 'AKTIF', aktif_at = COALESCE(aktif_at, NOW()) WHERE id = v_yay.id;

  RETURN jsonb_build_object('ok', true, 'kode', NULL, 'yayasan_id', v_yay.id, 'kode_sekolah', v_yay.kode);
END;
$$;

REVOKE EXECUTE ON FUNCTION registrasi_yayasan_atomik(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION registrasi_yayasan_atomik(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

-- ── Verifikasi (jalankan manual setelah migrasi) ────────────────────────────
-- select * from yayasan;                                   -- harus ada YYS_AWAL
-- select count(*) from siswa where yayasan_id is null;     -- harus 0
-- select count(*) from users where yayasan_id is null;     -- harus 0
