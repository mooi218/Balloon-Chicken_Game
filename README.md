# 何回でもシコシコしてよくてでも最低一回はシコってしなきゃいけなくて限界に達した人が負けっていうゲーム

空気入れで風船を膨らませるオンライン対応チキンレースです。マルチプレイではSupabase Realtimeで手番とゲーム状態を同期し、ソロプレイでは3人のCPUと対戦できます。

## セットアップ

1. Supabaseで新規プロジェクトを作成します。
2. SQL Editorで `supabase/migrations/202607180001_game_schema.sql` を実行します。
3. `.env.example` を `.env.local` にコピーし、Project URLとanon keyを設定します。
4. `npm install` のあと `npm run dev` で起動します。

## Render

Blueprint用の `render.yaml` を同梱しています。GitHubリポジトリをRenderへ接続し、`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定するとデプロイできます。

## ゲームルール

- 毎ターン最低1回は「膨らませる」を押します。2回目以降はパスできます。
- 1〜50回目は1回ごとに爆発確率が0.01%、51〜149回目は0.1%、150回目以降は0.2%上昇します。
- 各ターン開始時に1%でハプニングが発生します。
- 爆発させたプレイヤーが負けです。
