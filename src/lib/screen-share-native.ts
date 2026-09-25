import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// ── Definisi API plugin native "ScreenShare" ────────────────────────────
// Harus PERSIS cocok dengan method & nama event di
// android/app/src/main/java/com/smartexam/mtsalkhairaat/ScreenSharePlugin.java

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
  requestAndStart(): Promise<{ started: boolean }>
  setRemoteAnswer(options: { sdp: string; type: string }): Promise<void>
  addIceCandidate(options: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }): Promise<void>
  stop(): Promise<void>
  addListener(eventName: 'offer', cb: (data: ScreenShareOfferEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'icecandidate', cb: (data: ScreenShareIceEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'error', cb: (data: ScreenShareErrorEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'stopped', cb: () => void): Promise<PluginListenerHandle>
}

export const ScreenShareNative = registerPlugin<ScreenSharePluginApi>('ScreenShare')

// Alasan reject yang dikirim plugin KHUSUS saat siswa membatalkan dialog
// consent Android asli — satu-satunya kondisi yang boleh dianggap "tolak
// sungguhan". Kegagalan lain (error teknis) datang lewat event 'error',
// BUKAN lewat reject promise ini.
export const DITOLAK_SISWA = 'DITOLAK_SISWA'
