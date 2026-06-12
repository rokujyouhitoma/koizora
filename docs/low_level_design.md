# 詳細設計書 (Low-Level Design) - コイゾラ (Koizora)

本ドキュメントは、基本設計書（[high_level_design.md](/docs/high_level_design.md)）で定義された設計方針に基づき、青空文庫縦書きビューアー「コイゾラ (Koizora)」の内部設計およびアルゴリズム仕様（Low-Level Design）を定義します。

## 0. 設計の位置づけ (Design Alignment)
* **TOGAF EA との位置づけ**:
  本ドキュメント（詳細設計書）は、**TOGAF EA** の「データアーキテクチャ (DA)」および「テクノロジーアーキテクチャ (TA)」における**物理（実装）設計**を定義します。具体的な関数仕様、変数名、正規表現の置換仕様、ページ計算アルゴリズム、LocalStorageのJSONシリアライズスキーマ、CSS変数の実数値へのマッピングなどを物理レベルで規定します。
* **ADR (Architecture Decision Record) との連携**:
  パース処理の正規表現定義や、RTLにおけるスクロール位置補正計算式など、詳細設計・実装段階で発生した個別の技術的な意思決定や制約事項は、[docs/adr/](/docs/adr/) 内のADRに背景とともに記録されます。
* **設計ドキュメント間のすみ分け**:
  基本設計（HLD）や要件定義（SRD）との詳細な記述のすみ分け、およびオーバーラップした際のすみ分け・分掌については、[文書管理・ドキュメント台帳](/docs/document_ledger.md) に規定されている「設計ドキュメント間のすみ分けと分掌」に従います。

---

## 1. プログラム内部状態管理 (State Variables)

[app.js](/src/js/app.js) の内部において、アプリケーションの動作状態は以下のグローバル変数（クロージャ内変数）で管理されます。

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

### 2.3 事前定義作品のマスターデータとロード仕様

* **マスターデータ構造**:
  事前定義作品（吉川英治「宮本武蔵」8作品）のメタデータを `app.js` 内にオブジェクト配列として定義します。
  ```javascript
  const PREDEFINED_BOOKS = [
    { id: "musashi_01", title: "宮本武蔵 01 序、はしがき", cardId: 52395, path: "src/books/52395_yoko.txt" },
    { id: "musashi_02", title: "宮本武蔵 02 地の巻", cardId: 52396, path: "src/books/52396_yoko.txt" },
    { id: "musashi_03", title: "宮本武蔵 03 水の巻", cardId: 52397, path: "src/books/52397_yoko.txt" },
    { id: "musashi_04", title: "宮本武蔵 04 火の巻", cardId: 52398, path: "src/books/52398_yoko.txt" },
    { id: "musashi_05", title: "宮本武蔵 05 風の巻", cardId: 52399, path: "src/books/52399_yoko.txt" },
    { id: "musashi_06", title: "宮本武蔵 06 空の巻", cardId: 52400, path: "src/books/52400_yoko.txt" },
    { id: "musashi_07", title: "宮本武蔵 07 二天の巻", cardId: 52401, path: "src/books/52401_yoko.txt" },
    { id: "musashi_08", title: "宮本武蔵 08 円明の巻", cardId: 52402, path: "src/books/52402_yoko.txt" }
  ];
  ```
* **データの取得アルゴリズム (`loadPredefinedBook(bookId)`)**:
  1. ユーザーがウェルカム画面で作品を選択した際、対応する `bookId` をキーとして `PREDEFINED_BOOKS` から該当するオブジェクトを抽出します。
  2. `path` をターゲットとして `fetch` API を用いて非同期でテキストデータを取得します（ローカルリソースに静的ファイルとして格納した本文を取得）。
     ```javascript
     async function loadPredefinedBook(bookId) {
         const book = PREDEFINED_BOOKS.find(b => b.id === bookId);
         if (!book) return;
         try {
             const response = await fetch(book.path);
             if (!response.ok) throw new Error('Network response was not ok');
             const text = await response.text(); // 静的ファイルは UTF-8 で配置
             // グローバル状態変数への書き込み
             currentFileName = `${book.id}.txt`;
             currentFileType = 'txt';
             currentFileContent = text;
             
             // パースと描画の実行
             displayBook(text);
         } catch (error) {
             console.error('Failed to load predefined book:', error);
             alert('作品の読み込みに失敗しました。');
         }
     }
     ```

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
  RTL（Right-to-Left）書字方向において、`scrollLeft` は `0` (右端) から負の値 (左端に向かってマイナス) に減少します。LTR（Left-to-Right）書字方向においては、`scrollLeft` は `0` (左端) から正の値 (右端に向かってプラス) に増加します。絶対値を使用することで、双方の進行状況を共通の計算式で算出します。
  $$\text{currentScroll} = \left| \text{scrollLeft} \right|$$
- **読了進捗率 (`bookmarkProgress`)**:
  $$\text{bookmarkProgress} = \frac{\text{currentScroll}}{\text{maxScroll}} \quad (0.0 \le \text{bookmarkProgress} \le 1.0)$$
- **総ページ数 (`pageCount`)**:
  $$\text{pageCount} = \text{round}\left( \frac{\text{scrollWidth}}{\text{clientWidth}} \right)$$
- **現在ページ番号 (`currentPage`)**:
  $$\text{currentPage} = \text{round}\left( \frac{\text{currentScroll}}{\text{clientWidth}} \right) + 1$$
- **進捗バークリック位置からの進捗率算出**:
  $$\text{bookmarkProgress} = \frac{\text{clientX} - \text{rect.left}}{\text{rect.width}}$$
- **指定ページジャンプからの進捗率算出**:
  $$\text{bookmarkProgress} = \frac{\text{targetPage} - 1}{\text{pageCount} - 1} \quad (\text{if pageCount} > 1)$$

### 3.2 ページ送り（ナビゲーション）
設定されている読書方向（`config.direction`）に応じて、画面タップエリア、キーボード矢印キー、およびスクロール方向が連動して変化します。

* **右から左（RTL）時のページめくり方向**:
  * **次ページ（左方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} - \text{clientWidth}$ (左へスクロール)
  * **前ページ（右方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} + \text{clientWidth}$ (右へスクロール)
* **左から右（LTR）時のページめくり方向**:
  * **次ページ（右方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} + \text{clientWidth}$ (右へスクロール)
  * **前ページ（左方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} - \text{clientWidth}$ (左へスクロール)

### 3.3 レイアウト変更時の位置復元とリフロー保護 (`isReflowing`)
リサイズやフォントサイズ、読書方向の変更時には、段組み寸法が変化して一時的に不規則なスクロールイベントが発生します。これを無視し元の位置を正確に維持するため、`isReflowing` 状態フラグで制御を行います。
1. 表示パラメータ変更前に `isReflowing = true` に設定。
2. スクロールイベントハンドラーは `isReflowing === true` の間、`bookmarkProgress` の上書きを行わない。
3. リフローの完了を待って（`setTimeout`）、以下の式でスクロール位置を復元したのち `isReflowing = false` に戻す。

$$\text{scrollLeft} \leftarrow \begin{cases} -(\text{bookmarkProgress} \times \text{maxScroll}) & (\text{RTL時}) \\ \text{bookmarkProgress} \times \text{maxScroll} & (\text{LTR時}) \end{cases}$$

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
    "direction": "rtl",
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

### 5.1 テーマ変数マッピング ([style.css](/src/css/style.css))

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

### 5.4 モバイルレイアウト制限および垂直方向の上寄せ配置

#### モバイル制限 (画面幅767px以下)
* **Viewportパディングの削減**: 
  左右のパディング幅を狭め、表示領域を最大化します。
  ```css
  .reader-viewport {
      padding: 24px 20px;
  }
  ```
* **単一カラム幅制限**:
  画面の横幅から左右のパディング値（計40px）を差し引いた値を `column-width` に指定し、複数カラムが左右に並んで表示されるのを防ぎます。
  ```css
  .reader-content {
      column-width: calc(100vw - 40px);
      column-gap: 40px;
  }
  ```

#### 垂直方向の上寄せ配置 (上寄せアライメント)
* **原因**: 縦書き表示時に `.reader-viewport` がフレックスコンテナ（`display: flex`）である場合、アラインメント制御（`align-items: flex-start` 等）を導入すると、ブラウザのフレックスボックス解釈により子要素 `.reader-content` の高さがコンテンツ最小バランス高（`height: auto` 相当）に縮小されてしまうバグが発生します。これにより、インライン方向である縦の長さが縮み、縦書きテキストが上下に2段（二段組み）に分割され、画面半分（特に上部）に巨大な空白ができる表示不具合が生じます。
* **対策**: `.reader-viewport` からフレックスレイアウト（`display: flex`, `justify-content`, `align-items`）を完全に撤廃し、標準的な**ブロックレイアウト（`display: block`）**に変更します。これにより、子要素 `.reader-content` の `height: 100%` はスクロールコンテナである `.reader-viewport` の内容高（パディング内側の高さ）と厳密に同一になり、高さの潰れや意図しない複数段への折り返しが防止されます。また、ブロック表示における標準的なコンテンツフローに従い、テキストは常に上端から配置されるため、縦位置が正確に上側に揃います。
  ```css
  .reader-viewport {
      /* display: flex およびアライメント指定を削除 */
  }
  .reader-content {
      /* align-self: flex-start を削除し、高さ 100% を保証 */
      height: 100%;
  }
  ```

### 5.5 縦書きテキストのインライン方向（上から下）の固定

* **原因**: ページめくりのスクロール初期表示位置を制御するため、親要素 `.reader-viewport` の CSS `direction` プロパティを `rtl` または `ltr` に動的に切り替えています。しかし、子要素 `.reader-content` が `direction` を継承すると、RTL 読書方向時に `direction: rtl` が適用され、縦書き文字のインライン方向（テキストの流れる方向）が「下から上」に反転してしまいます。このため、縦位置が下揃え（物理的な下端）になり、句読点（「。」など）が行頭（物理的な上端）に誤って回り込むなどの禁則処理・アライメントバグが発生します。
* **対策**: 子要素 `.reader-content` のスタイルに明示的に `direction: ltr;` を指定します。これにより、親要素から `direction: rtl` が継承されるのを防ぎ、縦書きテキストの流れる方向を常に「上から下」に維持し、文章を物理的な「上揃え」で正しく描画させます。
  ```css
  .reader-content {
      direction: ltr; /* 縦書きテキストの流れ方向を常に「上から下」に固定 */
  }
  ```

### 5.6 読了後の余分な空白・空ページの排除

* **原因**:
  1. ファイル終端に多数の空行（bibliographical情報以前や段落間のパディングなど）が存在する場合、パーサー（`parseAozoraText`）がそれらをすべて空段落（`<p class="empty-line">&nbsp;</p>`）に変換してしまいます。縦書きマルチカラムでは、これらが余分な空白行としてレンダリングされ、最後のページ以降に連続する空ページを生じさせます。
  2. マルチカラム要素である `.reader-content` の幅が `width: auto` である場合、親スクロールコンテナとの関係から、ブラウザ（特に Chrome/Safari）がスクロール可能な最大幅（`scrollWidth`）を余剰に見積もってしまい、最後のページ以降にも無限に右または左方向にスクロールできてしまうレイアウト計算上のバグが発生します。
* **対策**:
  1. `app.js` のテキストパーサー内において、パース完了後の配列 `parsedLines` の先頭および末尾から空段落を `shift()`/`pop()` により自動的に切り詰めます（トリミング処理）。
  2. `.reader-content` のスタイルに **`width: max-content;`** を適用します。これにより、マルチカラムコンテナの幅は生成された全カラム（ページ数）の合計幅（`N * column-width + (N-1) * column-gap`）に厳密に一致するように強制され、ブラウザによる余分なスクロール領域の自動算出を防ぎます。
  ```css
  .reader-content {
      width: max-content; /* 全カラムの合計幅にサイズを固定し、空スクロールを完全に抑止 */
  }
  ```
