# カードのアトリエ

キーワードから、日本語のメッセージとかわいいオリジナルイラストを生成し、PNGで保存できる個人用サービスです。ローカルとVercelの両方で動きます。

## APIキーの設定

1. [OpenAI API keys](https://platform.openai.com/api-keys) でProject API keyを作成します。
2. `.env` を開き、次の等号の右側にキーを貼り付けます。

   ```text
   OPENAI_API_KEY=
   ```

3. 保存したらサーバーを再起動します。

`.env` は `.gitignore` と `.vercelignore` の両方で除外されています。APIキーをGitへ追加したり、Vercelへファイルとしてアップロードしたりしないでください。

## 起動方法

`start.cmd` をダブルクリックしてください。このPCで利用できるNode.jsを自動で使い、サーバーを起動します。手動で起動する場合は、Node.js 20以上を用意して次を実行します。

```powershell
node server.mjs
```

表示された `http://127.0.0.1:3000` をブラウザーで開いてください。

## Vercelへのデプロイ

1. このフォルダーをGitリポジトリへ追加します。`.env` はコミットしないでください。
2. Vercelで **Add New → Project** を開き、そのリポジトリをImportします。
3. **Settings → Environment Variables** で `OPENAI_API_KEY` を追加します。値はVercelの画面にだけ入力し、ソースコードには書きません。
4. Vercel Marketplaceから **Upstash** を追加し、Redisデータベースをこのプロジェクトへ接続します。接続すると `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` が環境変数として自動設定されます。値をコピーしてコードやGitへ入れないでください。
5. 必要なら `OPENAI_TEXT_MODEL` と `OPENAI_IMAGE_MODEL` も同じ画面で設定します。未設定なら既定値を使用します。
6. Deployします。環境変数を後から変更した場合は、変更後に再デプロイしてください。

画面は `public` から静的配信され、`/api/status` と `/api/generate` はVercel Functionsとして動作します。画像生成用の関数は最大300秒に設定しています。

### 利用回数制限

- Vercel上では、接続元IPアドレスごとにカード生成を1時間3回までに制限します。4回目以降はHTTP 429と案内メッセージを返し、OpenAI APIは呼び出しません。
- IPアドレスはSHA-256でハッシュ化してからRedisの識別子に使い、生のIPアドレスを保存しません。
- Upstash Redisが未接続または一時的に利用できない場合は、安全のためカード生成を停止します。制限なしでOpenAI APIを呼ぶ状態にはなりません。
- 同じ家庭・会社などでグローバルIPを共有している利用者は、同じ利用者として数えられる場合があります。

### 非公開で使う場合（任意）

一般公開をやめて自分だけで使う場合は、Vercelの **Settings → Deployment Protection** で **Vercel Authentication** と **All Deployments** を有効にしてください。

## セキュリティ

- ローカル実行では `127.0.0.1` にのみ公開します。VercelではDeployment Protectionの利用を推奨します。
- APIキーはローカルの `.env`、OS環境変数、またはVercelの環境変数から読み込み、HTML・JavaScript・APIレスポンスに含めません。
- APIキーの値はサーバーログやエラー表示に出力しません。
- `.env` は `.gitignore` と `.vercelignore` に登録済みです。
- 同一オリジン確認、サーバーをまたいで使える二重送信セッショントークン、厳しいCSPヘッダーで外部ページからの不正利用を抑制しています。
- OpenAI APIキーとUpstash接続情報はサーバー側の環境変数だけから読み込み、ブラウザーへ送りません。
- 不要になったキーはOpenAI Platformで無効化してください。

OpenAIの公式手順は [Developer quickstart](https://developers.openai.com/api/docs/quickstart) と [Production best practices](https://developers.openai.com/api/docs/guides/production-best-practices) を参照してください。Vercel側は [Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js)、[Environment Variables](https://vercel.com/docs/environment-variables)、[Deployment Protection](https://vercel.com/docs/deployment-protection) を参照してください。
