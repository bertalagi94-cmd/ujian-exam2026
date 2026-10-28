-- 46_pengajuan_sekolah.sql
--
-- Alur baru sekolah baru: sekolah mengajukan aktivasi dari halaman login,
-- developer menyetujui/menolak di /developer. Saat disetujui, yayasan AKTIF,
-- akun ADMIN (dari username+password pengajuan) dan 1 baris sekolah dibuat
-- dalam SATU transaksi. Menggantikan alur Kode Registrasi (migrasi 39).
--
-- Idempotent. Jalankan di database dulu, baru deploy kodenya.
-- Jangan dijalankan saat ada ujian.

CREATE TABLE IF NOT EXISTS pengajuan_sekolah (
  id              TEXT PRIMARY KEY,
  nama_sekolah    TEXT NOT NULL,
  npsn            TEXT NOT NULL,
  username        TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  no_hp           TEXT,
  status          TEXT NOT NULL DEFAULT 'MENUNGGU',
  alasan_tolak    TEXT,
  yayasan_id      TEXT REFERENCES yayasan(id) ON DELETE SET NULL,
  diputuskan_oleh TEXT,
  diputuskan_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pengajuan_status_valid CHECK (status IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK')),
  CONSTRAINT pengajuan_npsn_format  CHECK (npsn ~ '^[0-9]{8}$')
);

-- Satu username / NPSN hanya boleh punya SATU pengajuan yang masih menunggu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pengajuan_username_menunggu
  ON pengajuan_sekolah (lower(username)) WHERE status = 'MENUNGGU';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pengajuan_npsn_menunggu
  ON pengajuan_sekolah (npsn) WHERE status = 'MENUNGGU';
CREATE INDEX IF NOT EXISTS idx_pengajuan_status ON pengajuan_sekolah (status, created_at DESC);

-- Pola wajib repo: RLS aktif tanpa policy + cabut hak.
ALTER TABLE pengajuan_sekolah ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pengajuan_sekolah FROM PUBLIC, anon, authenticated;

-- ── Persetujuan atomik ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION setujui_pengajuan_atomik(
  p_pengajuan_id TEXT,
  p_oleh         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p      pengajuan_sekolah%ROWTYPE;
  v_yid    TEXT;
  v_kode   TEXT;
  v_dasar  TEXT;
  v_coba   INTEGER := 0;
BEGIN
  -- Kunci baris supaya dua klik "Setujui" bersamaan tidak lolos keduanya.
  SELECT * INTO v_p FROM pengajuan_sekolah WHERE id = p_pengajuan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'TIDAK_DITEMUKAN');
  END IF;
  IF v_p.status <> 'MENUNGGU' THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'SUDAH_DIPUTUSKAN');
  END IF;

  -- Username/NIS masih unik global: cek ulang saat persetujuan (bisa saja
  -- sudah dipakai sejak pengajuan dikirim).
  IF EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(v_p.username))
     OR EXISTS (SELECT 1 FROM siswa WHERE nis = v_p.username) THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'USERNAME_DIPAKAI');
  END IF;

  -- Kode Sekolah internal dibuat otomatis dari NPSN; tambah akhiran acak bila bentrok.
  v_dasar := 'S' || v_p.npsn;
  v_kode  := v_dasar;
  WHILE EXISTS (SELECT 1 FROM yayasan WHERE kode = v_kode) AND v_coba < 20 LOOP
    v_coba := v_coba + 1;
    v_kode := v_dasar || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 3));
  END LOOP;
  IF EXISTS (SELECT 1 FROM yayasan WHERE kode = v_kode) THEN
    RETURN jsonb_build_object('ok', false, 'kode', 'KODE_BENTROK');
  END IF;

  v_yid := 'YYS_' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));

  INSERT INTO yayasan (id, kode, nama, status, aktif_at, created_by)
  VALUES (v_yid, v_kode, v_p.nama_sekolah, 'AKTIF', NOW(), p_oleh);

  INSERT INTO users (username, password_hash, nama, role, status, no_hp, yayasan_id)
  VALUES (v_p.username, v_p.password_hash, 'Admin ' || v_p.nama_sekolah, 'ADMIN', 'AKTIF',
          NULLIF(v_p.no_hp, ''), v_yid);

  INSERT INTO sekolah (id, label, nama_sekolah, npsn, urutan, yayasan_id)
  VALUES ('SKL_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'Sekolah', v_p.nama_sekolah, v_p.npsn, 1, v_yid);

  -- Pengaturan awal: nama sekolah supaya halaman admin & login tidak kosong.
  INSERT INTO pengaturan (yayasan_id, key, value)
  VALUES (v_yid, 'namaSekolah', v_p.nama_sekolah)
  ON CONFLICT (yayasan_id, key) DO NOTHING;

  UPDATE pengajuan_sekolah
     SET status = 'DISETUJUI', yayasan_id = v_yid,
         diputuskan_oleh = p_oleh, diputuskan_at = NOW()
   WHERE id = v_p.id;

  RETURN jsonb_build_object('ok', true, 'kode', NULL, 'yayasan_id', v_yid, 'kode_sekolah', v_kode);
END;
$$;

REVOKE EXECUTE ON FUNCTION setujui_pengajuan_atomik(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION setujui_pengajuan_atomik(TEXT, TEXT) TO service_role;

-- Verifikasi (jalankan manual setelah migrasi):
-- select * from pengajuan_sekolah;
-- select has_function_privilege('anon', 'setujui_pengajuan_atomik(text,text)', 'execute');  -- harus false
