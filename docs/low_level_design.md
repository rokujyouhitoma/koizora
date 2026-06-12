# 詳細設計書 (Low-Level Design) - コイゾラ (Koizora)

本ドキュメントは、基本設計書（[high_level_design.md](file:///workspace/koizora/docs/high_level_design.md)）で定義された設計方針に基づき、青空文庫縦書きビューアー「コイゾラ (Koizora)」の内部設計およびアルゴリズム仕様（Low-Level Design）を定義します。

## 0. 設計の位置づけ (Design Alignment)
* **TOGAF EA との位置づけ**:
  本ドキュメント（詳細設計書）は、**TOGAF EA** の「データアーキテクチャ (DA)」および「テクノロジーアーキテクチャ (TA)」における**物理（実装）設計**を定義します。具体的な関数仕様、変数名、正規表現の置換仕様、ページ計算アルゴリズム、LocalStorageのJSONシリアライズスキーマ、CSS変数の実数値へのマッピングなどを物理レベルで規定します。
* **ADR (Architecture Decision Record) との連携**:
  パース処理の正規表現定義や、RTLにおけるスクロール位置補正計算式など、詳細設計・実装段階で発生した個別の技術的な意思決定や制約事項は、[docs/adr/](file:///workspace/koizora/docs/adr/) 内のADRに背景とともに記録されます。

---

## 1. プログラム内部状態管理 (State Variables)

[app.js](file:///workspace/koizora/app.js) の内部において、アプリケーションの動作状態は以下のグローバル変数（クロージャ内変数）で管理されます。

| 変数名 | 型 | 初期値 | 役割・説明 |
| :--- | :--- | :--- | :--- |
| `currentFileName` | `string` | `""` | 読み込み中のファイルの名前（例: `yushin.txt`）。LocalStorageにおけるしおり保存用の個別キー名として利用されます。 |
| `currentFileContent` | `string` | `""` | 読み込まれ、デコードされたファイルの生のテキスト/HTMLコンテンツ。セッション復元時にLocalStorageへ一時保存されます。 |
| `currentFileType` | `string` | `""` | 拡張子から抽出したファイル形式（`"txt"` または `"html"`）。パース処理の分岐決定に使用されます。 |
| `bookmarkProgress` | `number` | `0` | 現在の閲覧位置を示す進捗率（`0.0` 〜 `1.0`）。スクロール位置と連動し、ページ幅が変化した際の再計算基準になります。 |
| `headerTimeout` | `number \| null` | `null` | ヘッダーおよび操作UIの自動非表示タイマーID（`setTimeout` の返り値）。マウス移動やタップの度にリセットされます。 |
| `config` | `Object` | (下記参照) | アプリケーションの表示設定オブジェクト。 |

### `config` オブジェクトの構成
```json
{
  "theme": "sepia",       // 適用中テーマ ("sepia" | "light" | "dark" | "black")
  "font": "font-mincho",  // 適用中書体 ("font-mincho" | "font-gothic")
  "size": "size-md",      // 文字サイズ ("size-sm" | "size-md" | "size-lg" | "size-xl")
  "lh": "line-height-normal", // 行間 ("line-height-tight" | "line-height-normal" | "line-height-loose")
  "spacing": "spacing-normal"  // 文字間 ("spacing-tight" | "spacing-normal" | "spacing-loose")
}
```

---

## 2. ファイル解析・パースロジック (File Parsing & Conversion)

### 2.1 テキストファイルのパース (`parseAozoraText`)
Shift_JIS または UTF-8 から文字列へとデコードされたプレーンテキストは、以下のステップでHTMLへとパースされます。

1. **行分割**: テキストを改行コード（`\r\n` または `\n`）で配列に分割します。
2. **タイトル・著者名の自動抽出**: 配列の1行目をタイトル、2行目を著者名として抽出し、ヘッダーに適用します。
3. **メタデータ・ヘッダー情報のクレンジング**: 
   - `inHeader` フラグ（初期値: `true`）を用いて管理します。
   - ルール：`-------------------------------------------------------`（ダッシュ境界）または `［＃` で始まる開始指示（目次や始まり）を検知するまで、または一定行（5行以上）を超えてテキストが始まるまで、ヘッダー行として描画対象から除外します。
4. **メタデータ・フッター情報のクレンジング**: 
   - 行内に `底本：` または `青空文庫作成ファイル：` が検出された場合、それ以降の行は後書き・メタデータと判定し、ループ処理を即座にブレイクして除去します。
5. **青空文庫記法の置換 (`formatAozoraMarkup`)**: 各行に対して下記のマークアップ置換（正規表現）を順次適用します。

#### マークアップ置換規則
- **エスケープ処理 (XSS対策)**:
  最優先でHTMLタグ文字を実体参照にエスケープし、入力ファイル内のスクリプト実行を排除します。
  ```javascript
  line = line.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;');
  ```
- **ルビ（境界記号あり）**:
  全角 `｜` または半角 `|` から始まり、ルビ記号 `《...》` で囲まれた箇所を `<ruby>` タグに置換します。
  - 正規表現: `/[｜|]([^《\r\n]+)《([^》]+)》/g`
  - 置換後: `<ruby>$1<rt>$2</rt></ruby>`
- **ルビ（境界記号なし）**:
  漢字（Iteration Markを含む）に直後に続く `《...》` を `<ruby>` タグに置換します。
  - 正規表現: `/([一-龠々〆ヶ]+)《([^》]+)》/g`
  - 置換後: `<ruby>$1<rt>$2</rt></ruby>`
- **改ページ注記**:
  `［＃改ページ］` を検出した際、CSSのマルチカラムをブレイクして次の列から表示を開始させるためのダミー要素を挿入します。
  - 正規表現: `/［＃改ページ］/g`
  - 置換後: `<div class="page-break" style="break-before: column; height: 100%;"></div>`
- **傍点（強調マーク）注記**:
  `［＃「...」に傍点］` を検出した際、傍点表示クラスを適用します。
  - 正規表現: `/［＃「([^」]+)」に傍点］/g`
  - 置換後: `<span class="bouten">$1</span>`
- **その他システム注記の除去**:
  `［＃ここから...］` や `［＃ここで...］` など、レイアウト指示に用いられるその他の注記を一括で除去します。
  - 正規表現: `/［＃ここから([^］]+)］/g`, `/［＃ここで([^］]+)］/g`, `/［＃([^］]+)］/g`
  - 置換後: `""` (空文字)
- **制御文字の除去**:
  改ページ以外の不可視の不要な制御文字（Form FeedやBOM等）を除去します。
  - 正規表現: `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g`
  - 置換後: `""` (空文字)

### 2.2 HTML/XHTMLファイルのパース (`parseAozoraHTML`)
1. ブラウザ標準の `DOMParser` を生成し、文字列を `text/html` としてパースします。
2. `<title>` タグから作品タイトルを抽出します。
3. 本文部分（`.main_body` または `body`）を取得します。
4. HTML版青空文庫特有のフッター要素（文献情報 `.bibliographical_information` およびカードリンク `.card_link`）をDOM操作で明示的に `remove()` 処理します。

---

## 3. 縦書きマルチカラム・スクロール位置計算 (Pagination & Scroll Physics)

コイゾラは、CSSのマルチカラム（段組み）機能を利用して、右から左へと横スクロールする見開きビューアーを実現しています。

```
 +-------------------------------------------------------+
 | <---- [ページ送り方向 (RTL Scroll)]                   |
 |                                                       |
 | +-------------------+ +-------------------+  Viewport |
 | |                   | |                   |  (表示窓) |
 | |   2ページ目       | |   1ページ目       |           |
 | |   (左側カラム)     | |   (右側カラム)     |           |
 | |                   | |                   |           |
 | +-------------------+ +-------------------+           |
 +-------------------------------------------------------+
```

### 3.1 ページ計算式
- **全体の幅 (`scrollWidth`)**: 描画された本全体の横幅（隙間（ギャップ）を含む全ページ分の合計幅）。
- **表示領域幅 (`clientWidth`)**: 現在のブラウザに表示されている1画面（見開き）分の横幅。
- **最大スクロール幅 (`maxScroll`)**: 
  $$\text{maxScroll} = \text{scrollWidth} - \text{clientWidth}$$
- **現在の絶対スクロール位置 (`currentScroll`)**:
  RTL（Right-to-Left）書字方向において、`scrollLeft` は `0` (右端) から負の値 (左端に向かってマイナス) に減少します。そのため、計算時には絶対値を使用します。
  $$\text{currentScroll} = \left| \text{scrollLeft} \right|$$
- **読了進捗率 (`bookmarkProgress`)**:
  $$\text{bookmarkProgress} = \frac{\text{currentScroll}}{\text{maxScroll}} \quad (0.0 \le \text{bookmarkProgress} \le 1.0)$$
- **総ページ数 (`pageCount`)**:
  $$\text{pageCount} = \text{round}\left( \frac{\text{scrollWidth}}{\text{clientWidth}} \right)$$
- **現在ページ番号 (`currentPage`)**:
  $$\text{currentPage} = \text{round}\left( \frac{\text{currentScroll}}{\text{clientWidth}} \right) + 1$$

### 3.2 ページ送り（ナビゲーション）
縦書きの進行方向（RTL）に対応するため、左右ナビゲーションボタンおよびキーボード操作の方向は以下の挙動をとります。

- **次のページへ進む (画面左側のクリック / 左矢印キー)**:
  スクロール方向を左に進めるため、負の方向にスクロールします。
  $$\text{scrollLeft} \leftarrow \text{scrollLeft} - \text{clientWidth}$$
  (JS: `readerViewport.scrollBy({ left: -clientWidth, behavior: 'smooth' })`)
- **前のページへ戻る (画面右側のクリック / 右矢印キー)**:
  スクロール方向を右に戻すため、正の方向にスクロールします。
  $$\text{scrollLeft} \leftarrow \text{scrollLeft} + \text{clientWidth}$$
  (JS: `readerViewport.scrollBy({ left: clientWidth, behavior: 'smooth' })`)

### 3.3 リサイズ・フォントサイズ変更時のレイアウト維持
ウィンドウサイズ変更時やフォントサイズが変更されると、段組み全体の `scrollWidth` や `clientWidth` が変化し、現在の表示位置がズレてしまいます。コイゾラでは、変更直後に進捗率を用いてスクロール位置を正確に再計算・復元します。
```javascript
function restoreScrollPosition() {
    const maxScroll = readerViewport.scrollWidth - readerViewport.clientWidth;
    // 負のスクロール位置を計算して適用
    readerViewport.scrollLeft = -(bookmarkProgress * maxScroll);
}
```

---

## 4. LocalStorage データ保存仕様 (Storage Schema)

セッション復元やしおり機能のために、以下のスキーマでブラウザの LocalStorage を利用します。

### 4.1 UI設定 (`koizora_config`)
- **キー名**: `koizora_config`
- **値**: 設定オブジェクトのJSONシリアライズ文字列
- **スキーマ例**:
  ```json
  {
    "theme": "sepia",
    "font": "font-mincho",
    "size": "size-md",
    "lh": "line-height-normal",
    "spacing": "spacing-normal"
  }
  ```

### 4.2 しおり進捗率 (`bookmark_<filename>`)
- **キー名**: `bookmark_${currentFileName}` （例: `bookmark_musashi_01.txt`）
- **値**: 進捗率を示す文字列（実数値、例: `"0.4578"`)

### 4.3 セッション復元データ
再起動時に直前の状態に戻すため、以下のデータを保持します。
- `last_read_file_name` : 最後に読んだファイル名 (`string`)
- `last_read_file_type` : ファイルの拡張子形式 (`"txt"` または `"html"`)
- `last_read_file_content` : 最後にデコードされた状態のテキスト/HTML本文 (`string`)

---

## 5. CSS定義・スタイリング詳細 (CSS Variables & Styles)

テーマやカスタマイズ設定は、CSSのクラス切り替えとカスタムプロパティ（CSS変数）により実現されます。

### 5.1 テーマ変数マッピング ([style.css](file:///workspace/koizora/style.css))

| CSS変数名 | `:root` (和紙/Sepia) | `.theme-light` (明) | `.theme-dark` (暗) | `.theme-black` (漆黒) |
| :--- | :--- | :--- | :--- | :--- |
| `--bg-app` | `#f5eedc` | `#f8f9fa` | `#18181a` | `#000000` |
| `--bg-card` | `#fdfaf2` | `#ffffff` | `#222225` | `#121212` |
| `--bg-ui` | `rgba(253, 250, 242, 0.85)` | `rgba(255, 255, 255, 0.85)` | `rgba(34, 34, 37, 0.85)` | `rgba(18, 18, 18, 0.85)` |
| `--text-main` | `#2c221e` | `#1a1a1a` | `#e3e3e6` | `#b8b8b8` |
| `--text-muted` | `#705f55` | `#666666` | `#95959f` | `#6e6e6e` |
| `--border-color` | `rgba(112, 95, 85, 0.15)` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.08)` | `rgba(255, 255, 255, 0.05)` |
| `--accent-color` | `#a67c52` | `#4f46e5` | `#818cf8` | `#a78bfa` |
| `--accent-hover` | `#8e623b` | `#4338ca` | `#6366f1` | `#8b5cf6` |
| `--ruby-color` | `#8c7667` | `#555555` | `#b0b0b8` | `#8a8a8a` |

### 5.2 フォントサイズ・間隔のクラスマッピング

#### 文字サイズ
- `.size-sm`: `font-size: 1.0rem` (モバイル可読サイズ下限)
- `.size-md`: `font-size: 1.25rem` (標準)
- `.size-lg`: `font-size: 1.5rem` (大)
- `.size-xl`: `font-size: 1.85rem` (特大)

#### 行間 (Line Height)
- `.line-height-tight`: `line-height: 1.6`
- `.line-height-normal`: `line-height: 1.95` (縦書きの推奨値)
- `.line-height-loose`: `line-height: 2.4`

#### 文字間 (Letter Spacing)
- `.spacing-tight`: `letter-spacing: 0.04em`
- `.spacing-normal`: `letter-spacing: 0.08em`
- `.spacing-loose`: `letter-spacing: 0.15em`

### 5.3 ルビと傍点のCSS詳細
- **ルビ (`rt`)**:
  - `font-size: 0.45em`
  - 縦書きのため、自動的に文字の右側に表示されます。
- **傍点 (`.bouten`)**:
  - `text-emphasis: sesame` もしくは `text-emphasis: dot`（ブラウザ互換性のために `-webkit-text-emphasis` も併記）。
  - カラーは現在の文字色（`var(--text-color)`）に同期します。
