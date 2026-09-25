import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// ── Definisi API plugin native "ScreenShare" ────────────────────────────
// Harus PERSIS cocok dengan method & nama event di
// android/app/src/main/java/com/smartexam/mtsalkhairaat/ScreenSharePlugin.java
// dan ScreenCaptureService.kt.
//
// Dipakai oleh src/hooks/useLiveScreenRequest.ts saat berjalan di dalam APK
// (Capacitor.isNativePlatform() true), sebagai pengganti getDisplayMedia()
// browser yang tidak didukung WebView Android.

export interface ScreenShareOfferEvent {
  sdp: string
  type: string
}

export interface ScreenShareIceEvent {
  candidate: string
  sdpMid?: string
  sdpMLineIndex?: number
}

export interface ScreenShareErrorEvent {
  message: string
}

interface ScreenSharePluginApi {
  // Memicu dialog consent Android ASLI (MediaProjectionManager) lalu
  // menjalankan ScreenCaptureService. Promise ini HANYA reject dengan
  // alasan DITOLAK_SISWA kalau siswa membatalkan dialog consent itu sendiri;
  // kegagalan teknis lain (setelah consent diberikan) dikirim lewat event
  // 'error', bukan lewat reject di sini.
  requestAndStart(): Promise<{ started: boolean }>

  // Meneruskan SDP answer dari admin ke PeerConnection native.
  setRemoteAnswer(options: { sdp: string; type: string }): Promise<void>

  // Meneruskan ICE candidate dari admin ke PeerConnection native.
  addIceCandidate(options: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }): Promise<void>

  // Menghentikan ScreenCaptureService (dipanggil siswa sendiri, atau saat
  // beres-beres di sisi JS).
  stop(): Promise<void>

  addListener(eventName: 'offer', cb: (data: ScreenShareOfferEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'icecandidate', cb: (data: ScreenShareIceEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'error', cb: (data: ScreenShareErrorEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'stopped', cb: () => void): Promise<PluginListenerHandle>
}

export const ScreenShareNative = registerPlugin<ScreenSharePluginApi>('ScreenShare')

// Alasan reject yang dikirim ScreenSharePlugin.java KHUSUS saat siswa
// membatalkan/menolak dialog consent Android asli — satu-satunya kondisi
// yang boleh diperlakukan sebagai penolakan sungguhan oleh useLiveScreenRequest.
export const DITOLAK_SISWA = 'DITOLAK_SISWA'
