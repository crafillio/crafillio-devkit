import type { PartialMessages } from '../index';

/** Japanese. Untranslated keys fall back to English. */
export const messages: PartialMessages = {
  common: {
    save: '保存', cancel: 'キャンセル', delete: '削除', remove: '取り除く',
    rename: '名前を変更', create: '作成', close: '閉じる', add: '追加', edit: '編集',
    refresh: '更新', clear: 'クリア', import: 'インポート', export: 'エクスポート',
    open: '開く', run: '実行', stop: '停止', send: '送信', none: 'なし',
    name: '名前', value: '値', key: 'キー', type: '種類', status: 'ステータス',
    duration: '所要時間', size: 'サイズ', chooseFile: 'ファイルを選択',
    noFileChosen: 'ファイルが選択されていません', copied: 'コピーしました',
  },
  titlebar: {
    importCurl: 'curl をインポート', environments: '環境',
    network: 'プロキシと TLS の設定', about: 'このアプリについて', theme: 'テーマ',
    light: 'ライト', dark: 'ダーク', system: 'システムに合わせる', language: '言語',
  },
  sidebar: {
    collections: 'コレクション', workflows: 'ワークフロー', history: '履歴',
    s3: 'S3 接続', filterRequests: 'リクエストを絞り込む',
    newCollection: '新しいコレクション', newWorkflow: '新しいワークフロー',
    addConnection: '接続を追加', noCollections: 'コレクションがありません。',
    noWorkflows: 'ワークフローがありません。', noHistory: 'まだ送信していません。',
    noConnections: 'S3 接続がありません。', duplicate: '複製',
    copyAsCurl: 'curl としてコピー', newFolder: '新しいフォルダー',
  },
  request: {
    params: 'パラメーター', headers: 'ヘッダー', body: 'ボディ', auth: '認証',
    settings: '設定', loadTest: '負荷テスト', sending: '送信中',
    noResponse: 'レスポンスはまだありません', followRedirects: 'リダイレクトを追う',
    ignoreTls: 'TLS 証明書エラーを無視する',
  },
  workflow: {
    title: 'ワークフロー', addStep: 'ステップを追加', runWorkflow: 'ワークフローを実行',
    exportReport: 'レポートを書き出す', exportPdf: 'PDF を書き出す',
    openReport: 'レポートを開く', inspect: '確認', inputs: '入力', outputs: '出力',
    availableHere: 'ここで使える値', completed: 'ワークフローが完了しました',
    failed: 'ワークフローが失敗しました', removeStep: 'ステップを削除',
  },
  network: {
    title: 'ネットワーク', proxy: 'プロキシ', tls: 'TLS / SSL',
    useProxy: 'プロキシ経由で送信する', proxyHost: 'プロキシホスト', port: 'ポート',
    username: 'ユーザー名', password: 'パスワード',
    verifyTls: 'TLS 証明書を検証する', clientCerts: 'クライアント証明書',
  },
  about: { title: 'このアプリについて', creator: '作者・メンテナー', visitPortal: 'ポータルを開く',
    dataFolder: 'データフォルダー', secretStorage: 'シークレットの保存先', builtWith: '使用技術' },
  perf: { concurrency: '同時実行数', requests: 'リクエスト', throughput: 'スループット',
    errorRate: 'エラー率', mean: '平均', runLoadTest: '負荷テストを実行', errors: 'エラー' },
};
