# 最高気温マニア ― 酷暑オブザーバトリー

日本の**日別最高気温**の記録に特化したデータベース＆ビジュアライザー。気象庁の公開データを取り込み、歴代ランキングを「暑さが体感できる」UIで表示する。

- 設計書: [docs/DESIGN.md](docs/DESIGN.md)
- 演出モックアップ: [mockup/index.html](mockup/index.html)
- データ取込の調査結果: [ingest/FINDINGS.md](ingest/FINDINGS.md)

## アーキテクチャ

サーバーレス。GitHub Actions が気象庁からデータを取り込んで JSON を生成し、Vite でビルドして GitHub Pages に配信する（ランタイムDBは持たない）。

```
ingest/ (Python + uv)      web/ (Vite + React + TS)     .github/workflows/
  気象庁から取得       →     data/*.json を読んで表示   ←   日次 cron で自動更新
  data/*.json 生成
```

## セットアップ

### データ取込（Python / uv）

```bash
cd ingest
uv sync
uv run python build_data.py --with-stations   # 気象庁から取得 → ../data/*.json 生成
```

生成物:
- `data/national_all_time.json` … 歴代全国ランキング（日最高気温）
- `data/stations.json` … 観測地点マスタ（官署 type A）
- `data/meta.json` … 生成メタ情報・出典

### フロント（Vite / React）

```bash
cd web
npm install
npm run dev        # http://localhost:5173 （dev/build 前に data/ を public/ へ自動コピー）
npm run build      # 本番ビルド → web/dist
```

## Phase 0 の範囲

- [x] スキーマ確定（`stations` / `daily_max`、`jma_code`=obsdl stid）
- [x] 歴代全国ランキング取込（実データ：現在1位 群馬県伊勢崎 41.8℃ / 2025-08-05）
- [x] 官署地点マスタ取込（51地点。同名衝突5件はQA課題）
- [x] tier連動UI（夏日/真夏日/猛暑日/酷暑日）＋陽炎・グレイン・スクロール連動演出
- [x] GitHub Actions（日次取込→Pagesデプロイ）

- [x] **Phase 1**: obsdl で官署51地点の日別最高気温を全期間取込（240万行）→ SQLite 構築。
      昨日の全国／地点ごと詳細（自己ベスト・年別推移・猛暑日日数・最長連続）／歴代猛暑日回数ランキング。
- [x] **Phase 2**: 日付別詳細ランキング（暑い日4,413日分）＋「暑かった日」ランキング＋日付ピッカー＋
      地点⇄日付のクロス遷移＋共有ディープリンク（`?date=` / `?station=`）。

- [x] **アメダス拡張**: 165地点（官署51＋4要素アメダス93＋歴代ランキング掲載21）・**日別599万行**（1873〜）。
      伊勢崎41.8℃・多治見・江川崎・鳩山など記録保持地点を収録。
- [x] **多ページ化（PC横長）**: HashRouter による本物のページ分割（ホーム/ランキング/地点/日付/地図）。モーダル廃止。
- [x] **Phase 3**: 地図ヒートマップ（自前SVG＋d3-geo、外部タイル不要）。特定日 / 歴代最高モード、URL共有可。

次フェーズ以降（[docs/DESIGN.md](docs/DESIGN.md) 参照）:
- Phase 4: 演出の磨き込み、同名衝突地点のQA、GitHub Pages への実デプロイ

### データ生成パイプライン（`ingest/`）

```bash
uv run python build_data.py --with-stations  # 歴代ランキング＋官署マスタ → data/*.json
uv run python build_daily.py                 # 官署の日別最高気温 → data/max_temp.sqlite
uv run python build_views.py                 # 昨日/地点/猛暑日回数 → data/*.json
uv run python build_dates.py                 # 日付ごと → data/date/*.json ＋ dates_index
```

地図用の地形データ（`web/public/japan.geojson`, 353KB）は一度だけ生成済み。作り直す場合:

```bash
curl -sL -o /tmp/japan_raw.geojson https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson
uv run python build_geo.py --src /tmp/japan_raw.geojson
```

## データ出典・ライセンス

出典：気象庁ホームページ（<https://www.data.jma.go.jp/stats/etrn/>）を加工して作成。
気象庁「公共データ利用規約（第1.0版）」に準拠し、出典明記のうえ利用しています。
