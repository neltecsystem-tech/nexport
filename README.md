# NexPort

このリポジトリは Xserver への自動デプロイ設定を含んでいます。

- GitHub Actions: `.github/workflows/deploy.yml`
- デプロイ方式: `expo export:web` で生成した `web-build` を FTP アップロード
