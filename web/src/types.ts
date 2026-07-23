// data/*.json のスキーマ（ingest/build_data.py が生成する形）

export type Tier = 0 | 1 | 2 | 3 | 4

export interface RankingRecord {
  rank: number | null
  temp: number
  tier: Tier
  station: string
  pref: string
  date: string | null        // ISO 'YYYY-MM-DD'
  date_label: string         // '2025年8月5日'
  relocated: boolean         // 末尾* = 移転・機器変更等のJMA脚注
  still_observing: boolean | null
}

export interface NationalRanking {
  meta: { fetched_at: string; source: string; element: string; count: number }
  records: RankingRecord[]
}

export interface Station {
  jma_code: string
  name: string
  name_kana: string | null
  pref: string
  lat: number
  lon: number
  elevation: number | null
  type: string
}

export interface StationsFile {
  meta: { fetched_at: string; source: string; subset: string; count: number }
  stations: Station[]
}

// --- Phase 1: 日別データ由来のビュー ---

export interface DailyRecord {
  rank: number
  jma_code: string
  station: string
  pref: string
  temp: number
  tier: Tier
}
export interface DailyLatest {
  /** provisional=true は当日の途中経過（速報値）。翌朝の取込で確定値に更新される */
  meta: { date: string; source: string; count: number; note: string; provisional?: boolean }
  records: DailyRecord[]
}

export interface NicheRecord {
  rank: number
  jma_code: string
  station: string
  pref: string
  mousho: number
  kokusho: number
  longest_streak: number
  record_high: number
}
export interface NicheMousho {
  meta: { source: string; count: number; note: string }
  records: NicheRecord[]
}

export interface StationStats {
  days: number
  natsu: number
  manatsu: number
  mousho: number
  kokusho: number
  record_high: number
  record_high_date: string
  longest_mousho_streak: number
}
export interface StationDetail {
  meta: { source: string }
  station: {
    jma_code: string; name: string; name_kana: string | null; pref: string
    lat: number; lon: number; elevation: number | null; obs_start: string | null
  }
  stats: StationStats
  best: { date: string; temp: number; tier: Tier }[]
  yearly: { year: number; max: number; mousho: number; kokusho: number }[]
}

// --- Phase 2: 日付ごと ---

export interface DateDetail {
  meta: {
    date: string; source: string; count: number
    national_max: number; mousho_count: number; kokusho_count: number
  }
  records: DailyRecord[]
}

export interface DateIndexRow {
  date: string
  max: number
  tier: Tier
  mousho: number
  kokusho: number
  top_station: string
  top_pref: string
}
export interface DatesIndex {
  meta: { source: string; count: number; latest: string; note: string }
  dates: DateIndexRow[]
}

export const TIER_LABEL: Record<Tier, string> = {
  0: '—',
  1: '夏日',
  2: '真夏日',
  3: '猛暑日',
  4: '酷暑日',
}
