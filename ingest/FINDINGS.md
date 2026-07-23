# JMA（気象庁）最高気温データ ingestion フィージビリティ調査 report

調査日: 2026-07-22
調査環境: サンドボックス内から `curl` / Python `requests` で直接 `jma.go.jp` / `data.jma.go.jp` へアウトバウンド通信できることを確認済み（後述）。**ネットワーク遮断は無し。** 3ストリームすべて実際に取得・検証した。

実データのサンプルは `ingest/samples/` に保存済み。スクリプトは `ingest/fetch_stations.py`（必須成果物）、`ingest/fetch_rankall.py`、`ingest/fetch_obsdl_sample.py`（ボーナス、Stream2/3の動作実証）。依存ライブラリは `ingest/requirements.txt`。

---

## 0. サンドボックスのネットワーク到達性

```
curl -m 10 https://www.jma.go.jp/bosai/amedas/const/amedastable.json  -> HTTP 200 (0.07秒)
```

即座に200が返り、以降のすべてのリクエスト（JSON/HTML/CSVダウンロード含む）も同様に成功した。**このサンドボックスはJMAサイトへの直接アウトバウンドを一切ブロックしていない。** よって以下は「机上の調査」ではなく、実際に叩いて得た結果である。

---

## 1. Stream 1: 地点マスタ（station master）

### 1-1. ソースは実は2つあり、IDがそれぞれ違う（要注意）

同じ地点でも、**3つの異なるID体系**が並存していることを実測で確認した。これは事前の想定より厄介で、レポートの中で一番強調したい「落とし穴」。

| ソース | 東京の例 | 小河内(奥多摩)の例 | 用途 |
|---|---|---|---|
| `amedastable.json`（アメダス実況＝ナウキャスト用） | `44132` | `44046` | 緯度経度・標高・かな・種別 |
| obsdl（過去データダウンロード）の `stid` | `s47662` | `a0365` | **Stream3のダウンロードに必須** |
| etrn（`/stats/etrn/`、歴代ランキング等）の `prec_no`+`block_no` | `prec_no=44&block_no=47662` | `prec_no=44&block_no=0365` | **Stream2の個別地点ランキングに必須** |

実測で確認した規則性:
- obsdl の `stid` から先頭の英字（`s`/`a`）を取り除いた数値部分が、そのまま etrn の `block_no` と一致する（`s47662→47662`、`a0365→0365` を実際にHTTPリクエストで突き合わせて確認）。
- しかし `amedastable.json` の数値コードは、上記のどちらとも一致しない（東京: `44132` vs `47662`）。**`amedastable.json` のコードは緯度経度等のメタデータ取得にのみ有効で、過去データダウンロードにもランキングにも使えない。**

→ 結論: **1つの地点マスタを作るには2ソースを名前でJOINする必要がある**（共通キーが無いため）。`fetch_stations.py` はこのJOINを実装し、実際に日本全国で実行した。

### 1-2. `amedastable.json`（実データ取得済み）

- URL: `GET https://www.jma.go.jp/bosai/amedas/const/amedastable.json`
- 認証・パラメータ不要。レスポンスは素のJSON、1286地点。
- 実サンプル（`ingest/samples/amedastable.json`、187KB）:
```json
"44132": {"type": "A", "elems": "11111111", "lat": [35, 41.5], "lon": [139, 45.0],
          "alt": 25, "kjName": "東京", "knName": "トウキョウ", "enName": "Tokyo"}
```
- `lat`/`lon` は `[度, 分(小数)]` 形式 → `度 + 分/60` で10進化（`fetch_stations.py` の `dms_to_decimal()` で実装済み）。
- `type` 分布（実測）: `C`=1131（雨量のみアメダス）, `A`=56（官署）, `B`=95（4要素アメダス：気温・降水・風・日照）, `D/E/F/G`=各1（父島・南鳥島・富士山・特殊地点）。
- **重要な反証**: `type=C`（=公称「雨量のみ、気温なし」）の地点でも、実際にobsdlから最高気温が取れるケースを確認した（後述1-4）。**`type` フィールドだけで「気温データの有無」を判定してはいけない。**

### 1-3. obsdl の地点ピッカー（実データ取得済み、`stid` の出処）

- 地点は都道府県（正確には「地方」区分、北海道は11分割＋南極＝計61区分）ごとに取得する。
  1. `GET https://www.data.jma.go.jp/risk/obsdl/index.php` （セッションCookie取得、必須ではないが本家UIの挙動を再現）
  2. `POST https://www.data.jma.go.jp/risk/obsdl/top/station`  body: `pd=00` → 61区分のID⇔名称マップ（`prid`）が返る（実サンプル `samples/station_pd00.html`）
  3. `POST .../top/station`  body: `pd=44`（例: 東京）→ その区分内の地点一覧（`stid`, `stname`, `kansoku`）が返る（実サンプル `samples/station_pd44.html`）
- レスポンスはHTMLフラグメント（jQueryが直接 `.html()` に流し込む前提の断片）。地点1件につき2回同じ `<div>` が出現する（正規表現で重複除去が必要、`fetch_stations.py` で対応済み）。
- 実測抜粋（東京都、`samples/station_pd44.html`）:
```
<input type="hidden" name="stid" value="s47662">
<input type="hidden" name="stname" value="東京">
<input type="hidden" name="prid" value="44">
<input type="hidden" name="kansoku" value="111111">
```
- `kansoku` は6桁のビットマスク（降水・風・気温・日照・積雪・その他の観測有無、`top.2.1.js` の `obs`/`tag` 配列から逆算）。ただし1-1で述べた通り**このビットマスクと `amedastable.json` の `type` は必ずしも一致しない**ため、参考情報止まりとし、正式な「気温あり/なし」判定には使わない方針にした。

### 1-4. 実行結果：日本全国クロール（実データ）

`fetch_stations.py` を61区分すべてに対して実行（ポライトネス用に0.3秒間隔）、**約20秒で完走**:

```
[obsdl] total station rows: 1679
[join] 1723 rows written  (amedastable+obsdl: 1299, obsdl_only: 380, amedastable_only: 44)
```
→ `ingest/samples/stations_full_japan.csv` に保存済み（実データ、153KB、1723行）。

**名前JOINの限界も実測で判明**: 全国で約38件の同名地点衝突（例:「清水」「府中」「大山」「八幡」等、複数県に同名地点あり）を検出、スクリプトはこれを標準エラーに警告出力し、最初の候補を暫定採用＋フラグを立てる設計にした（自動で正しく解決はできないため、人間によるQAが必要）。

**`type` フィールドの反証（実測）**: `48031 野沢温泉`（`amedastable.json` 上で `type="C"`＝公称・雨量のみ）に対し、obsdl経由で実際に最高気温を要求したところ:
```json
{"period":"2024年7月1日","data0_0_0":"22.8"}
```
実データ返却あり（`ingest/samples/nozawa_check.json`）。つまり**「type=C だから気温データ無し」という前提は誤り**。おそらく「ナウキャスト（実況マップ）に載せる地点かどうか」の分類であって、「アーカイブに気温記録が存在するかどうか」とは別軸。**実際に叩いて確認する以外に信頼できる判定方法が無い**、というのが今回の一番の学び。

### 1-5. スキーマへのマッピング

| ターゲット列 | ソース | 備考 |
|---|---|---|
| `jma_code` | obsdl `stid`（例 `s47662`） | Stream2/3のURLにそのまま使えるので主キーに採用 |
| `name` | obsdl `stname`（`amedastable.kjName` で補完） | |
| `name_kana` | `amedastable.knName` | obsdl側には無い |
| `pref` | obsdl `prid`→都道府県名（`fetch_stations.py`内蔵の静的マップ） | `amedastable.json` には県情報が無い |
| `lat`/`lon` | `amedastable.lat`/`lon` を10進化 | obsdl側には座標が無い |
| `elevation` | `amedastable.alt` | |
| `type` | `amedastable.type` | **参考情報のみ**、気温有無の判定には不使用 |
| `obs_start` | 未実装。取得するなら Stream2 の `rank_s.php`（後述2-2）が地点ごとに「統計期間」を返す | 地点ごとに1リクエスト必要、コスト大 |

---

## 2. Stream 2: 歴代全国ランキング

**注意**: JMAには紛らわしい2つの「ランキング」ページがある。
- `https://www.data.jma.go.jp/stats/data/mdrr/rank_daily/`（毎日の**全国観測値ランキング**）は直近1週間のみの速報値ランキングで、依頼の「歴代」とは別物（確認済み、`samples/rank_daily_index.html`）。
- 今回対象とすべきは **`https://www.data.jma.go.jp/stats/etrn/view/rankall.php`**（歴代全国ランキング、観測史上の値）。こちらを実際に取得・パースした。

### 2-1. 全国TOP20（実データ取得済み）

- `GET https://www.data.jma.go.jp/stats/etrn/view/rankall.php?prec_no=&block_no=&year=&month=&day=&view=`
  （`month=1`〜`12` を渡せば月別、空なら通年。`rankall01.php`〜`rankall12.php` という月別URLも存在）
- レスポンス: `text/html; charset=UTF-8`（実測ヘッダ確認）。パースの罠: 直接 `curl` で保存すると `/obd/stats/etrn/...` へ301リダイレクトされる旧URLがヒットしやすいので `-L` 必須。
- 実データ構造（`samples/rankall_utf8.html`）: `<table class="data2_s">` が要素ごとに複数並ぶ。`<caption>` に要素名（例: 「最高気温の高い方から」）。行は `順位・都道府県・地点・観測値・起日・現在観測を実施`。同着は `〃`（前の順位を継承）。地点名の末尾 `*` はJMAの脚注マーク（移転等）。
- 実測サンプル（2026-07-22取得、本物の値）:

| 順位 | 都道府県 | 地点 | 観測値(℃) | 起日 |
|---|---|---|---|---|
| 1 | 群馬県 | 伊勢崎 | 41.8 | 2025年8月5日 |
| 2 | 静岡県 | 静岡* | 41.4 | 2025年8月6日 |
| 2 | 埼玉県 | 鳩山 | 41.4 | 2025年8月5日 |

`fetch_rankall.py` で実際にこの表を204行（10要素×約20位）パース済み、標準出力で確認した。

### 2-2. 地点別TOP10＋統計期間（実データ取得済み、おまけ）

- `GET https://www.data.jma.go.jp/stats/etrn/view/rank_s.php?prec_no=<prec_no>&block_no=<block_no>`
- `block_no` は 1-1 で確認した通り、obsdlの `stid` から接頭辞の英字を除いた数値と一致（`s47675`→`47675`）。
- 実測（`prec_no=44&block_no=47675`＝大島、`samples/rank_s_oshima.html`）: 要素ごとにTOP10（値＋日付）と**統計期間**列（例「1938/11　2026/7」）が返る。この統計期間が **`stations.obs_start` の実データソースになり得る**（地点ごとに1リクエストなので全地点で使うにはコストがかかる点に注意）。
- **未解決の謎**: 同じURL形式で `prec_no=44&block_no=0365`（小河内、4桁のアメダス専用ブロック番号）を叩くと「ページを表示することが出来ませんでした」というエラーページが返った（`samples/rank_s_ogouchi.html`）。一方で同じ小河内は obsdl の `show/table` からは普通に降水量等のデータが取れる（気温は無いはず＝妥当）。この失敗が「4桁ブロック番号はrank_s.php非対応」なのか「単に気温要素が無いから除外された」なのかは、今回の調査時間内では切り分けられなかった。**別のアメダス専用地点（気温観測あり）で追試すれば切り分け可能**、今後の課題として明記する。

### 2-3. スキーマへのマッピングと所感

歴代ランキング（2-1）はそのまま「殿堂入り記録」的な別テーブル（例: `all_time_records`）向けのデータであり、`daily_max` 本体を埋めるものではない。地点別TOP10（2-2）も同様。**`daily_max` を本当に埋めるのはStream3。**

---

## 3. Stream 3: 過去データ・ダウンロード（obsdl）

### 3-1. 全体フロー（実際に最後までダウンロードして検証済み）

`web/js/top.2.1.js`（実際にダウンロードして解析、`samples/top.2.1.js`）を読み解いた結果、フローは以下の通り:

1. `GET https://www.data.jma.go.jp/risk/obsdl/index.php` — セッションCookie確立
2. （UI操作の再現として）`POST .../top/station` body `pd=<prid>` → 地点選択肢を取得（1-3参照、地点の `stid` を得る）
3. （同様に）`POST .../top/element` body `aggrgPeriod=1` → 要素チェックボックスのHTMLを取得。ここから **要素コード `202` = 最高気温（日別値、単日の最高値）** を突き止めた（`samples/element_daily.html` に実データあり。近い紛らわしいコードとして `201`=平均気温, `203`=最低気温, `204`=日最高気温の**月間平均**＝別物、に要注意）
4. **本体**: `POST https://www.data.jma.go.jp/risk/obsdl/show/table`
   - `downloadFlag=false` → 画面プレビュー用の**JSON**が返る（軽量、件数チェックに便利）
   - `downloadFlag=true` + `csvFlag=1` → **CSVファイル本体**が返る（`Content-Disposition: attachment`, `Content-Type: application/octet-stream`）

必須POSTパラメータ（実測で全項目を確定）:

| パラメータ | 例 | 意味 |
|---|---|---|
| `stationNumList` | `["s47662"]` （JSON文字列） | 地点stidのリスト |
| `aggrgPeriod` | `"1"` | 1=日別値（他: 2=半旬,4=旬,5=月,6=3か月,7=年,9=時別,8=N日間） |
| `elementNumList` | `[["202",""]]` | 要素コード・付随値のペアのリスト |
| `interAnnualType` | `"1"` | 1=連続期間 |
| `ymdList` | `["2024","2024","7","7","1","5"]` | `[開始年,終了年,開始月,終了月,開始日,終了日]` |
| `optionNumList` | `"[]"` | 平年値表示等のオプション、通常は空 |
| `downloadFlag` | `"true"`/`"false"` | CSV本番 or JSONプレビュー |
| `csvFlag` | `"1"` | CSV形式 |
| `rmkFlag` | `"1"` | 品質情報・均質番号列を付加（推奨） |
| その他 | `disconnectFlag`,`kijiFlag`,`youbiFlag`,`fukenFlag`,`jikantaiFlag`,`jikantaiList` | 表示トグル、`0`/`[]`で問題なし |
| `ymdLiteral` | （送らない） | **送ると日付が結合列（例`2024/7/1`）に変わる**ことを実測で確認。年月日を別列で取りたい場合は送らないのが正解（`fetch_obsdl_sample.py` はこの挙動を明記） |

### 3-2. 実データサンプル（本物）

東京・2024年7月1〜5日、`downloadFlag=false`（JSONプレビュー）実測結果:
```json
{"data":[{"period":"2024年7月1日","data0_0_0":"29.4"},
         {"period":"2024年7月2日","data0_0_0":"31.4"},
         {"period":"2024年7月3日","data0_0_0":"33.3"},
         {"period":"2024年7月4日","data0_0_0":"35.0"},
         {"period":"2024年7月5日","data0_0_0":"35.5"}]}
```
（`samples/preview_response.json`。実際に2024年7月上旬の東京は記録的猛暑だったので、値の妥当性も確認できた）

同条件で `downloadFlag=true` の実CSV（`samples/daily_max_tokyo_sample.csv`、cp932＝Shift_JIS系エンコーディングでデコード必須、UTF-8ではない点に注意）:
```
ダウンロードした時刻：2026/07/22 21:05:15

,,,東京,東京,東京
年,月,日,最高気温(℃),最高気温(℃),最高気温(℃)
,,,,,
,,,,品質情報,均質番号
2024,7,1,29.4,8,1
2024,7,2,31.4,8,1
2024,7,3,33.3,8,1
2024,7,4,35.0,8,1
2024,7,5,35.5,8,1
```
`品質情報`＝品質フラグ（8=正常値等、コード表はJMA公式ドキュメント参照）、`均質番号`＝観測環境の均質性を示す番号（統計比較用）。→ `daily_max.quality_flag` にそのままマッピング可能。

**より大規模な実証**: 同一地点（東京）・**1990-01-01〜2024-12-31（35年、12784日）を1回のリクエストで取得**することに成功（`samples/tokyo_full_history_sample.csv`、343KB、12784行）。**1地点なら実質「全履歴を1リクエスト」で取れる**ことを実データで確認した。

パース後の `daily_max` 形式サンプル（`fetch_obsdl_sample.py` の出力、`samples/tokyo_parsed_sample.csv`）:
```
station_id,date,max_temp,max_temp_time,quality_flag
s47662,2024-07-01,29.4,,8
```
**注意**: この要素（`202`最高気温）のCSVには**最高気温を記録した時刻（`max_temp_time`）は含まれない**。時刻が必要なら別要素（時別値等）を追加で取得する必要があり、今回はそこまで検証していない（未実施・要追加調査）。

### 3-3. ボリューム・レート制限（実測＋ソースコード解析）

`top.2.1.js` に `var seigen = 44000; //制限値` という定数があり、リクエストごとの上限は概算
`地点数 × 要素数 × 日数 × オプション数 ≤ 44000`
（N日平均集計時は重み1.5倍）で制御されていることを確認した。1地点×1要素なら約44000日（約120年）まで1リクエストで取得可能——実際に35年分を1発で取れたことと整合する。複数地点を一度に集めたい場合は日数側を按分してチャンク化する必要がある（例: 10地点×1要素なら約4400日≒12年ごとに分割）。

公式なレート制限（1秒あたり何リクエスト等）のドキュメントは見当たらなかった。政府の公共サービスであり商用CDN API ではないため、**良識的なポライトネス（逐次実行、リクエスト間に0.3〜1秒程度のディレイ、User-Agent明示、並列化しない）**を自主的に守る方針とする。`fetch_stations.py`/`fetch_obsdl_sample.py` は両方ともこの方針でデフォルト実装済み。

### 3-4. ライセンス

`https://www.jma.go.jp/jma/kishou/info/coment.html` を実際に取得して確認（`samples/kiyaku.html`）。JMAサイトのコンテンツは「公共データ利用規約（第1.0版）」に準拠し、**出典明記（例:「出典：気象庁ホームページ（該当ページのURL）」）を条件に自由利用可**。加工・編集した場合はその旨も明記が必要。気象業務法17条（予報業務の許可）・23条（警報の制限）に触れる用途でなければ、今回の「最高気温マニア向けアプリ」は問題にならない想定。

---

## 4. 実現可能性まとめ

| ストリーム | 実際に取得できたか | 形式 | 難易度 |
|---|---|---|---|
| Stream1 地点マスタ | ○（2ソースとも実データ取得済み、全国クロールも実行済み） | JSON + HTML断片 | 低〜中（名前JOINの曖昧性あり） |
| Stream2 歴代ランキング | ○（全国TOP20・地点別TOP10とも実データ取得済み） | HTML（`<table class="data2_s">`） | 低（GETのみ、セッション不要） |
| Stream3 過去データ | ○（JSONプレビュー・CSV本体・35年分一括取得まで実証済み） | CSV（cp932）/ JSON | 中（POSTパラメータが多い、地点×日付でチャンク設計が必要） |

**サンドボックスのネットワーク状況**: 遮断なし。すべて実測。

## 5. 推奨（最初に何を作るべきか）

1. **最優先で作るべきは Stream2（歴代全国ランキング）+ Stream1（官署地点マスタのみ、`type=A`の56地点）。**
   理由: GETのみ・セッション不要・レスポンスが軽量（数十KB）・パースが単純（HTMLテーブル1本）。「日本最高気温マニア向け」アプリとして即座に見せられるコンテンツ（歴代トップ20、地点別記録）を最短で作れる。`fetch_rankall.py` はこの日の実データで動作確認済みなので、そのまま土台にできる。

2. **次に Stream1 の全国版**（`fetch_stations.py` の全国クロール、既に実行済み・20秒で完走・1723行）を仕上げ、地図表示や地点検索の土台にする。名前JOINの曖昧地点（約38件）は手動QAリストとして残す。

3. **Stream3（obsdl一括ダウンロード）は最も重いので後回し。** ただし「1地点なら1リクエストで全履歴」が実証できたのは朗報——**日本全国1700地点全部を数十年分溜め込む「フルバックフィル」は後回しにし、まずは官署56地点＋主要アメダス（type=B、95地点）＝151地点程度に絞って、地点×全履歴を1リクエストずつ、151回叩く設計（ポライトネス込みで数分オーダー）から始めるのが現実的なMVP。** 全1700地点をやるなら日次バッチで少しずつ増やす方針が安全（政府サービスへの配慮）。

## 6. 未解決・要追加調査

- `rank_s.php` が4桁ブロック番号（アメダス専用地点）で失敗する原因の切り分け（2-2参照）。
- 最高気温の「記録時刻」（`max_temp_time`）を得るための要素コード調査（今回は要素202のみ検証、時刻列なし）。
- 名前JOINの曖昧地点（全国で約38件）の正規の解消方法（座標突合等、追加のフィールドが必要）。
- 正式なレート制限文書の有無（見つからなかったため、自主規制ベースで運用する前提）。

---

## 付録: サンプルファイル一覧（`ingest/samples/`）

- `amedastable.json` — Stream1 実データ（1286地点）
- `station_pd00.html` / `station_pd44.html` / `station_pd48.html` — obsdl地点ピッカーの実レスポンス
- `stations_full_japan.csv` — `fetch_stations.py` の全国実行結果（1723行）
- `rankall_utf8.html` — 歴代全国ランキング（実データ、全要素）
- `rank_s_oshima.html` / `rank_s_ogouchi.html` — 地点別TOP10＋統計期間（成功例／失敗例）
- `rank_daily_index.html` — （参考、対象外の「毎日の」ランキングページ）
- `element_daily.html` / `period_daily.html` / `obsdl_index.html` / `top.2.1.js` — obsdlの内部API調査に使った実データ
- `preview_response.json` / `daily_max_tokyo_sample.csv` — 東京・2024年7月1-5日の実データ（JSON/CSV両方）
- `tokyo_full_history_sample.csv` — 東京・1990〜2024年（35年、12784日）を1リクエストで取得した実データ
- `tokyo_parsed_sample.csv` — 上記をスキーマ形式にパース後
- `nozawa_check.json` — 野沢温泉（`type=C`のはずが実は気温データありと判明した反証データ）
- `kiyaku.html` — JMAの利用規約（出典明記が条件）
