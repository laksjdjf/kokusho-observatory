/**
 * rankings.ts — ランキングの定義レジストリ。
 *
 * 新しいランキングを増やすたびに専用のReactコンポーネントを書いていた
 * (Rankings.tsx 参照)のをやめ、「SQLを1本 + 列の見せ方を書く」だけで
 * 済むようにする。Rankings.tsx 側は登録された定義を汎用テーブルとして
 * 描画するだけ。
 */
import { DAILY, STATIONS } from './db'

/** 列の描画種別。値の取り出し・整形・td のクラスをこれで決める。 */
export type ColumnKind = 'rank' | 'station' | 'pref' | 'date' | 'temp' | 'int' | 'text'

export interface ColumnDef {
  /** 行オブジェクトから値を取り出すキー（kind:'rank' では未使用） */
  key: string
  /** thead に出す見出し */
  header: string
  kind: ColumnKind
  /** kind:'station' のとき、地点コード(jma_code)を保持しているキー。省略時は 'jma_code' */
  codeKey?: string
  /** kind:'int' | 'text' の値の後ろに付ける単位など（例: '日', '月'） */
  suffix?: string
  /** kind:'int' の色付け。hot=常に強調、kokusho=値>0のときだけ強調 */
  tone?: 'hot' | 'kokusho'
}

export interface RankingRow {
  [key: string]: unknown
}

export interface RankingDef {
  id: string
  /** タブに出す文字列 */
  label: string
  /** .subhead に出す説明。行数などを埋め込みたい場合は関数で */
  desc: string | ((rows: RankingRow[]) => string)
  sql: string
  columns: ColumnDef[]
  /** <tr key> の生成。省略時は行インデックス */
  rowKey?: (row: RankingRow, i: number) => string | number
}

export const RANKINGS: RankingDef[] = [
  // 1. 歴代最高気温（地点＋日付） — 同じ地点が何度も出てくる「生の記録」ランキング
  {
    id: 'all-records',
    label: '歴代最高気温（地点＋日付）',
    desc: '地点×日付の全記録 上位300 ・ 同一地点が何度も登場することがあります',
    sql: `
      SELECT s.jma_code, s.name, s.pref, d.max_temp, d.max_temp_time,
             strftime(d.date, '%Y-%m-%d') AS date
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      ORDER BY d.max_temp DESC, d.date
      LIMIT 300`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'max_temp', header: '気温', kind: 'temp' },
      { key: 'max_temp_time', header: '起時', kind: 'text' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'date', header: '観測日', kind: 'date' },
    ],
    rowKey: (r, i) => `${r.jma_code}-${r.date}-${i}`,
  },

  // 2. 地点別ベスト — 1地点1位（自己ベスト）のランキング
  {
    id: 'station-best',
    label: '地点別ベスト',
    desc: '地点ごとの自己ベスト（1地点1位）・ 気温が高い順',
    sql: `
      WITH ranked AS (
        SELECT station_id, max_temp, date,
               row_number() OVER (PARTITION BY station_id ORDER BY max_temp DESC, date) AS rn
        FROM ${DAILY}
      )
      SELECT s.jma_code, s.name, s.pref, r.max_temp,
             strftime(r.date, '%Y-%m-%d') AS date
      FROM ranked r JOIN ${STATIONS} s ON s.id = r.station_id
      WHERE r.rn = 1
      ORDER BY r.max_temp DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'max_temp', header: '気温', kind: 'temp' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'date', header: '観測日', kind: 'date' },
    ],
    rowKey: (r) => r.jma_code as string,
  },

  // 3. 猛暑日数ランキング
  {
    id: 'mousho-count',
    label: '猛暑日数ランキング',
    desc: '地点別 猛暑日(≥35℃)日数 ・ 観測期間の長い地点が有利 ・ その場で集計',
    sql: `
      SELECT s.jma_code, s.name, s.pref,
             COUNT(*) FILTER (WHERE d.max_temp >= 35) AS mousho,
             COUNT(*) FILTER (WHERE d.max_temp >= 40) AS kokusho,
             MAX(d.max_temp) AS record_high
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      GROUP BY s.jma_code, s.name, s.pref
      ORDER BY mousho DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'mousho', header: '猛暑日 ≥35', kind: 'int', tone: 'hot' },
      { key: 'kokusho', header: '酷暑日 ≥40', kind: 'int', tone: 'kokusho' },
      { key: 'record_high', header: '最高', kind: 'temp' },
    ],
    rowKey: (r) => r.jma_code as string,
  },

  // 4. 酷暑日数ランキング
  {
    id: 'kokusho-count',
    label: '酷暑日数ランキング',
    desc: '地点別 酷暑日(≥40℃)日数 ・ 0日の地点は除外 ・ その場で集計',
    sql: `
      SELECT s.jma_code, s.name, s.pref,
             COUNT(*) FILTER (WHERE d.max_temp >= 35) AS mousho,
             COUNT(*) FILTER (WHERE d.max_temp >= 40) AS kokusho,
             MAX(d.max_temp) AS record_high
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      GROUP BY s.jma_code, s.name, s.pref
      HAVING COUNT(*) FILTER (WHERE d.max_temp >= 40) > 0
      ORDER BY kokusho DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'mousho', header: '猛暑日 ≥35', kind: 'int', tone: 'hot' },
      { key: 'kokusho', header: '酷暑日 ≥40', kind: 'int', tone: 'kokusho' },
      { key: 'record_high', header: '最高', kind: 'temp' },
    ],
    rowKey: (r) => r.jma_code as string,
  },

  // 5. 酷暑日一覧 — 40℃以上の記録を新しい順に並べる
  {
    id: 'kokusho-list',
    label: '酷暑日一覧',
    desc: (rows) => `全国の酷暑日(≥40℃)記録 全${rows.length.toLocaleString()}件 ・ 新しい日付順`,
    sql: `
      SELECT s.jma_code, s.name, s.pref, d.max_temp, d.max_temp_time,
             strftime(d.date, '%Y-%m-%d') AS date
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      WHERE d.max_temp >= 40
      ORDER BY d.date DESC, d.max_temp DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'max_temp', header: '気温', kind: 'temp' },
      { key: 'max_temp_time', header: '起時', kind: 'text' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'date', header: '観測日', kind: 'date' },
    ],
    rowKey: (r, i) => `${r.jma_code}-${r.date}-${i}`,
  },

  // 6. 年間最高気温 — 年ごとの全国最高
  {
    id: 'yearly-max',
    label: '年間最高気温',
    desc: '年ごとの全国最高気温 ・ 気温が高い順',
    sql: `
      SELECT year(d.date) AS year,
             MAX(d.max_temp) AS temp,
             arg_max(s.name, d.max_temp) AS name,
             arg_max(s.jma_code, d.max_temp) AS jma_code,
             arg_max(s.pref, d.max_temp) AS pref,
             arg_max(strftime(d.date, '%Y-%m-%d'), d.max_temp) AS date
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      GROUP BY year(d.date)
      ORDER BY temp DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'year', header: '年', kind: 'text' },
      { key: 'temp', header: '気温', kind: 'temp' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'date', header: '観測日', kind: 'date' },
    ],
    rowKey: (r) => r.year as number,
  },

  // 7. 月別 歴代最高 — 月ごとの歴代全国最高
  {
    id: 'monthly-max',
    label: '月別 歴代最高',
    desc: '月ごとの歴代全国最高気温 ・ 1月から12月まで',
    sql: `
      SELECT month(d.date) AS month,
             MAX(d.max_temp) AS temp,
             arg_max(s.name, d.max_temp) AS name,
             arg_max(s.jma_code, d.max_temp) AS jma_code,
             arg_max(s.pref, d.max_temp) AS pref,
             arg_max(strftime(d.date, '%Y-%m-%d'), d.max_temp) AS date
      FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
      GROUP BY month(d.date)
      ORDER BY month ASC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'month', header: '月', kind: 'text', suffix: '月' },
      { key: 'temp', header: '気温', kind: 'temp' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'date', header: '観測日', kind: 'date' },
    ],
    rowKey: (r) => r.month as number,
  },

  // 8. 最長連続猛暑日 — 「島ID法」で連続区間を作り、地点ごとに最長を取る
  {
    id: 'longest-streak',
    label: '最長連続猛暑日',
    desc: '地点別 最長連続 猛暑日(≥35℃)記録 ・ 連続日数が長い順',
    sql: `
      WITH hot AS (
        SELECT station_id, date,
               date - CAST(row_number() OVER (PARTITION BY station_id ORDER BY date) AS INTEGER) AS grp
        FROM ${DAILY} WHERE max_temp >= 35
      ),
      streaks AS (
        SELECT station_id, grp, COUNT(*) AS len
        FROM hot GROUP BY station_id, grp
      ),
      best AS (
        SELECT station_id, MAX(len) AS longest
        FROM streaks GROUP BY station_id
      )
      SELECT s.jma_code, s.name, s.pref, b.longest
      FROM best b JOIN ${STATIONS} s ON s.id = b.station_id
      ORDER BY b.longest DESC`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'longest', header: '最長連続', kind: 'int', suffix: '日' },
    ],
    rowKey: (r) => r.jma_code as string,
  },

  // 9. 暑かった日 — 日付ごとの全国最高（既存機能を維持）
  {
    id: 'hot-days',
    label: '暑かった日',
    desc: '全国最高気温が高かった日 TOP150 ・ 日付クリックでその日の全国ランキング ・ その場で集計',
    sql: `
      WITH per_day AS (
        SELECT d.date,
               MAX(d.max_temp) AS max,
               COUNT(*) FILTER (WHERE d.max_temp >= 35) AS mousho,
               COUNT(*) FILTER (WHERE d.max_temp >= 40) AS kokusho,
               arg_max(s.name, d.max_temp) AS top_name,
               arg_max(s.jma_code, d.max_temp) AS top_code,
               arg_max(s.pref, d.max_temp) AS top_pref
        FROM ${DAILY} d JOIN ${STATIONS} s ON s.id = d.station_id
        GROUP BY d.date
      )
      SELECT strftime(date, '%Y-%m-%d') AS date, max, mousho, kokusho, top_name, top_code, top_pref
      FROM per_day ORDER BY max DESC LIMIT 150`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'date', header: '日付', kind: 'date' },
      { key: 'max', header: '全国最高', kind: 'temp' },
      { key: 'top_name', header: '最高地点', kind: 'station', codeKey: 'top_code' },
      { key: 'top_pref', header: '都道府県', kind: 'pref' },
      { key: 'mousho', header: '猛暑日 地点数', kind: 'int', tone: 'hot' },
      { key: 'kokusho', header: '酷暑日 地点数', kind: 'int', tone: 'kokusho' },
    ],
    rowKey: (r) => r.date as string,
  },

  // 10. 独走ランキング — その日の1位が2位をどれだけ引き離したか。
  //     900地点が密に覆っているので普段は0.1〜0.2℃差にしかならず、
  //     大きく開いた日＝1地点だけ異常に突出した日（フェーン現象など）が炙り出される。
  {
    id: 'runaway',
    label: '独走（2位との差）',
    desc: '猛暑日(35℃以上)を出した日に限り、1位が2位をどれだけ引き離したか 上位150 ・ 春の沖縄が本土を離すのは気候差であって独走ではないため、暑い日に限定している',
    sql: `
      WITH counts AS (
        SELECT date, COUNT(*) AS n FROM ${DAILY} GROUP BY date
      ),
      ranked AS (
        SELECT d.date, d.max_temp, d.station_id,
               row_number() OVER (PARTITION BY d.date ORDER BY d.max_temp DESC) AS rn
        FROM ${DAILY} d
      ),
      top2 AS (
        SELECT date,
               MAX(max_temp) FILTER (WHERE rn = 1) AS t1,
               MAX(max_temp) FILTER (WHERE rn = 2) AS t2,
               MAX(station_id) FILTER (WHERE rn = 1) AS sid
        FROM ranked WHERE rn <= 2 GROUP BY date
      )
      SELECT strftime(t.date, '%Y-%m-%d') AS date,
             ROUND(t.t1 - t.t2, 1) AS gap,
             t.t1 AS max_temp, t.t2 AS second_temp,
             s.jma_code, s.name, s.pref
      FROM top2 t
      JOIN ${STATIONS} s ON s.id = t.sid
      JOIN counts c ON c.date = t.date
      WHERE t.t2 IS NOT NULL AND c.n >= 100 AND t.t1 >= 35
      ORDER BY gap DESC, t.t1 DESC
      LIMIT 150`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'gap', header: '2位との差', kind: 'temp' },
      { key: 'date', header: '観測日', kind: 'date' },
      { key: 'name', header: '独走した地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'max_temp', header: '1位', kind: 'temp' },
      { key: 'second_temp', header: '2位', kind: 'temp' },
    ],
  },

  // 11. 平年差ランキング — 「暑い日」ではなく「その地点にとって異常に暑い日」。
  //     平年値は外部データを持たず、自前の全履歴から
  //     「その地点の、その月日の、歴代平均」として計算する。
  //     絶対値だと夏しか出てこないが、これなら1月の異常高温も上位に来る。
  {
    id: 'anomaly',
    label: '平年差（異常な暑さ）',
    desc: 'その地点の同月日の歴代平均からの隔たり 上位150 ・ 季節を問わず「異常に暑かった日」が出ます',
    sql: `
      WITH norm AS (
        SELECT station_id, month(date) AS m, day(date) AS d,
               AVG(max_temp) AS normal_temp, COUNT(*) AS n
        FROM ${DAILY}
        GROUP BY station_id, month(date), day(date)
      )
      SELECT strftime(x.date, '%Y-%m-%d') AS date,
             ROUND(x.max_temp - n.normal_temp, 1) AS anomaly,
             x.max_temp,
             ROUND(n.normal_temp, 1) AS normal_temp,
             s.jma_code, s.name, s.pref
      FROM ${DAILY} x
      JOIN norm n ON n.station_id = x.station_id
                 AND n.m = month(x.date) AND n.d = day(x.date)
      JOIN ${STATIONS} s ON s.id = x.station_id
      WHERE n.n >= 20          -- 平年値の母数が少ない地点・日付は除く
      ORDER BY anomaly DESC
      LIMIT 150`,
    columns: [
      { key: '', header: '順位', kind: 'rank' },
      { key: 'anomaly', header: '平年差', kind: 'temp' },
      { key: 'date', header: '観測日', kind: 'date' },
      { key: 'name', header: '地点', kind: 'station', codeKey: 'jma_code' },
      { key: 'pref', header: '都道府県', kind: 'pref' },
      { key: 'max_temp', header: '実測', kind: 'temp' },
      { key: 'normal_temp', header: '平年', kind: 'temp' },
    ],
  },
]
