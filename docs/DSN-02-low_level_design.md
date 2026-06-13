# [DSN-02] 詳細設計書 (Low-Level Design) - ゆうぞら (Yuzora)

本ドキュメントは、基本設計書（[DSN-01-high_level_design.md](/docs/DSN-01-high_level_design.md)）で定義された設計方針に基づき、青空文庫縦書きビューアー「ゆうぞら (Yuzora)」の内部設計およびアルゴリズム仕様（Low-Level Design）を定義します。

## 0. 設計の位置づけ (Design Alignment)
* **TOGAF EA との位置づけ**:
  本ドキュメント（詳細設計書）は、**TOGAF EA** の「データアーキテクチャ (DA)」および「テクノロジーアーキテクチャ (TA)」における**物理（実装）設計**を定義します。具体的な関数仕様、変数名、正規表現の置換仕様、ページ計算アルゴリズム、LocalStorageのJSONシリアライズスキーマ、CSS変数の実数値へのマッピングなどを物理レベルで規定します。
* **ADR (Architecture Decision Record) との連携**:
  パース処理の正規表現定義や、RTLにおけるスクロール位置補正計算式など、詳細設計・実装段階で発生した個別の技術的な意思決定や制約事項は、[docs/adr/](/docs/adr/) 内のADRに背景とともに記録されます。
* **設計ドキュメント間のすみ分け**:
  基本設計（HLD）や要件定義（SRD）との詳細な記述のすみ分け、およびオーバーラップした際のすみ分け・分掌については、[文書管理・ドキュメント台帳](/docs/MNG-01-document_ledger.md) に規定されている「設計ドキュメント間のすみ分けと分掌」に従います。

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
  `［＃改ページ］` を検出した際、パース処理の段階で文書を分割し、個別のセクション要素（`<section class="reader-section">`）として分割出力することで、段組みを物理的に次のページ（見開き）から開始させます。
  - プレースホルダー: `'PAGE_BREAK'`
  - 変換結果: `</section>\n<section class="reader-section">`
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
  事前定義作品（吉川英治「宮本武蔵」8作品、夏目漱石「こころ」、魯迅「故郷」）のメタデータを `app.js` 内にオブジェクト配列として定義します。
  ```javascript
  const PREDEFINED_BOOKS = [
    // 開発者のオススメ本
    { id: "kokoro", title: "こころ", shortTitle: "こころ", cardId: 773, path: "src/books/773_yoko.txt", category: "developer", author: "夏目漱石", meta: "夏目漱石" },
    { id: "gokyo", title: "故郷", shortTitle: "故郷", cardId: 42939, path: "src/books/42939_yoko.txt", category: "developer", author: "魯迅", meta: "魯迅" },

    // 読書家のオススメ本
    { id: "musashi_01", title: "宮本武蔵 01 序、はしがき", shortTitle: "序、はしがき", cardId: 52395, path: "src/books/52395_yoko.txt", category: "reader", author: "吉川英治", meta: "01" },
    { id: "musashi_02", title: "宮本武蔵 02 地の巻", shortTitle: "地の巻", cardId: 52396, path: "src/books/52396_yoko.txt", category: "reader", author: "吉川英治", meta: "02" },
    ...
  ];
  ```
* **データの取得アルゴリズム (`loadPredefinedBook(book)`)**:
  1. ユーザーがウェルカム画面で作品を選択した際、選択された `book` オブジェクトを引数として受け取ります。
  2. `path` をターゲットとして `fetch` API を用いて非同期でテキストデータを取得し、バイナリバッファから Shift_JIS （失敗時は UTF-8）でデコードします。
     ```javascript
     function loadPredefinedBook(book) {
         currentFileName = `${book.cardId}_yoko.txt`;
         currentFileType = 'txt';
         
         fetch(book.path)
             .then(res => {
                 if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
                 return res.arrayBuffer();
             })
             .then(arrayBuffer => {
                 let text = '';
                 try {
                     const decoder = new TextDecoder('shift-jis', { fatal: true });
                     text = decoder.decode(arrayBuffer);
                 } catch (err) {
                     console.warn("Shift_JIS decode failed, falling back to UTF-8", err);
                     const utf8Decoder = new TextDecoder('utf-8');
                     text = utf8Decoder.decode(arrayBuffer);
                 }
                 currentFileContent = text;
                 displayBook();
             })
             .catch(err => {
                 console.error(err);
                 alert(`作品の読み込みに失敗しました: ${err.message}`);
             });
     }
     ```

---

## 3. 縦書きマルチカラム・スクロール位置計算 (Pagination & Scroll Physics)

ゆうぞらは、CSSのマルチカラム（段組み）機能を利用して、右から左へと横スクロールする見開きビューアーを実現しています。

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
- **進捗バークリック・ドラッグ（スクラブ）位置からの進捗率算出**:
  マウスのドラッグ開始時（`mousedown`）またはタッチ操作の開始時（`touchstart`）に、ドラッグ状態フラグ `isDraggingProgress` を `true` に設定し、コンテナに `.dragging` クラスを付与してリアルタイムに進捗率を算出・スクロール位置へ即時反映します。
  進捗率の計算はページの送り方向（RTL/LTR）により逆転します。
  $$\text{bookmarkProgress} = \begin{cases} 1 - \frac{\text{clientX} - \text{rect.left}}{\text{rect.width}} & (\text{RTL時}) \\ \frac{\text{clientX} - \text{rect.left}}{\text{rect.width}} & (\text{LTR時}) \end{cases}$$
  ドラッグ終了（`mouseup` / `touchend`）時にフラグを `false` に戻し、変更された進捗率のしおりを永続化（`saveBookmark`）します。
- **指定ページジャンプからの進捗率算出**:
  $$\text{bookmarkProgress} = \frac{\text{targetPage} - 1}{\text{pageCount} - 1} \quad (\text{if pageCount} > 1)$$

### 3.2 ページ送り（ナビゲーション）
設定されている読書方向（`config.direction`）およびスワイプジェスチャー等の入力デバイスに応じて、画面タップエリア、キーボード矢印キー、スワイプ操作が連動します。

* **右から左（RTL）時のページめくり方向**:
  * **次ページ（左方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} - \text{clientWidth}$ (左へスクロール)
  * **前ページ（右方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} + \text{clientWidth}$ (右へスクロール)
* **左から右（LTR）時のページめくり方向**:
  * **次ページ（右方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} + \text{clientWidth}$ (右へスクロール)
  * **前ページ（左方向）**: $\text{scrollLeft} \leftarrow \text{scrollLeft} - \text{clientWidth}$ (左へスクロール)
* **タッチスワイプ（1ページ送り制限）**:
  画面の横スクロール（慣性スクロール）をCSSで無効化（`overflow-x: hidden`）したうえで、`touchstart`、`touchmove`、`touchend` によるタッチ位置座標の変化（水平移動量 $\Delta x$ と垂直移動量 $\Delta y$）を用いてスワイプを検知します。
  * **RTL（右から左）設定時**:
    * **右スワイプ ($\Delta x > 50$ 且つ $\left|\Delta x\right| > \left|\Delta y\right|$)**: `nextPage()` を呼び出し、直後の1ページへ進む（左スクロール）。
    * **左スワイプ ($\Delta x < -50$ 且つ $\left|\Delta x\right| > \left|\Delta y\right|$)**: `prevPage()` を呼び出し、直前の1ページへ戻る（右スクロール）。
  * **LTR（左から右）設定時**:
    * **右スワイプ ($\Delta x > 50$ 且つ $\left|\Delta x\right| > \left|\Delta y\right|$)**: `prevPage()` を呼び出し、直前の1ページへ戻る（左スクロール）。
    * **左スワイプ ($\Delta x < -50$ 且つ $\left|\Delta x\right| > \left|\Delta y\right|$)**: `nextPage()` を呼び出し、直後の1ページへ進む（右スクロール）。

* **キーボード矢印キー操作**:
  * **RTL設定時**: `ArrowLeft` で `nextPage()`、`ArrowRight` で `prevPage()`。
  * **LTR設定時**: `ArrowRight` で `nextPage()`、`ArrowLeft` で `prevPage()`。
  * **メニュー表示切替**: `ArrowUp` または `ArrowDown` 押下で `toggleControls()` を呼び出してヘッダー/フッター表示の On/Off を切り替え、キーイベントのデフォルト動作（ブラウザスクロール）を `preventDefault()` で無効化します。

### 3.3 レイアウト変更時の位置復元とリフロー保護 (`isReflowing`)
リサイズやフォントサイズ、読書方向の変更時には、段組み寸法が変化して一時的に不規則なスクロールイベントが発生します。これを無視し元の位置を正確に維持するため、`isReflowing` 状態フラグで制御を行います。
1. 表示パラメータ変更前に `isReflowing = true` に設定。
2. スクロールイベントハンドラーは `isReflowing === true` の間、`bookmarkProgress` の上書きを行わない。
3. リフローの完了を待って（`setTimeout`）、以下の式でスクロール位置を復元したのち `isReflowing = false` に戻す。

$$\text{scrollLeft} \leftarrow \begin{cases} -(\text{bookmarkProgress} \times \text{maxScroll}) & (\text{RTL時}) \\ \text{bookmarkProgress} \times \text{maxScroll} & (\text{LTR時}) \end{cases}$$

---

## 4. LocalStorage データ保存仕様 (Storage Schema)

セッション復元やしおり機能のために、以下のスキーマでブラウザの LocalStorage を利用します。

### 4.1 UI設定 (`yuzora_config`)
- **キー名**: `yuzora_config`
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
- **キー名**: `bookmark_${currentFileName}` （例: `bookmark_52395_yoko.txt`）
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
- `.size-sm`: `font-size: 14.5px` (モバイル可読サイズ下限)
- `.size-md`: `font-size: 17px` (標準)
- `.size-lg`: `font-size: 21px` (大)
- `.size-xl`: `font-size: 25px` (特大)

#### 行間 (Line Height)
- `.line-height-tight`: `line-height: 1.7`
- `.line-height-normal`: `line-height: 2.1` (縦書きの推奨値)
- `.line-height-loose`: `line-height: 2.6`

#### 文字間 (Letter Spacing)
- `.spacing-tight`: `letter-spacing: 0.03em`
- `.spacing-normal`: `letter-spacing: 0.08em`
- `.spacing-loose`: `letter-spacing: 0.16em`

### 5.3 ルビと傍点のCSS詳細
- **ルビ (`rt`)**:
  - `font-size: 0.52em`
  - 縦書きのため、自動的に文字の右側に表示されます。
- **傍点 (`.bouten`)**:
  - `-webkit-text-emphasis: sesame` および `text-emphasis: sesame`。
  - カラーは現在の文字色（`var(--text-main)`等）に自動同期します。

### 5.4 モバイルレイアウト制限および垂直方向の上寄せ配置

#### モバイル制限 (画面幅767px以下)
* **Viewportマージンによる余白の静的確保**: 
  左右のパディング幅を狭めつつ十分な静的余白を確保するため、`--reader-padding-x` を 24px に設定します。
* **単一カラム幅制限**:
  スクロールコンテナである `.reader-viewport` が画面端から `var(--reader-padding-x)` 引き込んで配置されるため、ビューポート内の幅をそのまま占有するよう `column-width` を 100% に指定し、複数カラムが左右に並んで表示されるのを完全に防ぎます。
  ```css
  .reader-section {
      column-width: 100%;
      column-gap: 0;
  }
  ```

#### 垂直方向の上寄せ配置 (上寄せアライメント)
* **原因**: 縦書き表示時に `.reader-viewport` がフレックスコンテナ（`display: flex`）である場合、アラインメント制御（`align-items: flex-start` 等）を導入すると、ブラウザのフレックスボックス解釈により子要素 `.reader-content` の高さがコンテンツ最小バランス高（`height: auto` 相当）に縮小されてしまうバグが発生します。また、親要素に `padding` を設定して `height: 100%` を子要素に与えると、ブラウザがスクロールバーやパディングを誤って計算し、テキスト下部が画面外（ビューポート外）に押し出されて描画される問題が生じます。
* **対策**: `.reader-viewport` からフレックスレイアウト（`display: flex`, `justify-content`, `align-items`）を完全に撤廃し、絶対配置レイアウトに変更します。さらに、ヘッダー/フッターを絶対配置のオーバーレイ形式とし、読書用コンテンツの上下余白をCSS変数（`--reader-padding-top`, `--reader-padding-bottom`）として定義します。左右の余白をスクロール動作中も含めて完全に静的でかつ均等な幅に保つため、コンテナ自体の `left` および `right` に対し `var(--reader-padding-x)` を適用して画面の左右から内側に引き込み、コンテナ内部のパディングおよびマージンは `0` にリセットします。
  ```css
  .reader-viewport {
      position: absolute;
      top: 0;
      bottom: 0;
      left: var(--reader-padding-x);
      right: var(--reader-padding-x);
      z-index: 1;
      padding: 0;
  }
  .reader-content {
      height: calc(100% - var(--reader-padding-top) - var(--reader-padding-bottom));
      margin-top: var(--reader-padding-top);
      margin-bottom: var(--reader-padding-bottom);
      padding-left: 0;
      padding-right: 0;
  }
  ```

### 5.5 縦書きテキストのインライン方向（上から下）の固定

* **原因**: ページめくりのスクロール初期表示位置を制御するため、親要素 `.reader-viewport` の CSS `direction` プロパティを `rtl` または `ltr` に動的に切り替えています。しかし、子要素 `.reader-content` および `.reader-section` が `direction` を継承しない（`direction: ltr` 等を固定する）場合、RTL 読書時に段組み（マルチカラム）の超過分が左側（スクロール可能領域）ではなく右側の画面外へ溢れてしまい、2ページ目以降が空白になるバグが発生します。一方、`direction` をそのまま継承させると、縦書き文字のインライン方向（テキストの流れる方向）が「下から上」に反転してしまい、アライメント崩れを誘発します。
* **対策**: 子要素 `.reader-content` および `.reader-section` は親要素の `direction`（`rtl` または `ltr`）を継承させて、段組みの並びと溢れの方向をスクロール方向と一致させます。その上で、縦書きテキストの文字の流れる方向を常に「上から下」に維持するため、セクションの直下の子要素群に対して一括で `direction: ltr;` を指定し、文字を物理的な「上揃え」で正しく描画させます。
  ```css
  .reader-section > * {
      direction: ltr; /* 縦書きテキストの流れ方向を常に「上から下」に固定 */
  }
  ```

### 5.6 読了後の余分な空白・空ページの排除

* **原因**:
  1. ファイル終端に多数の空行（bibliographical情報以前や段落間のパディングなど）が存在する場合、パーサー（`parseAozoraText`）がそれらをすべて空段落（`<p class="empty-line">&nbsp;</p>`）に変換してしまいます。縦書きマルチカラムでは、これらが余分な空白行としてレンダリングされ、最後のページ以降に連続する空ページを生じさせます。
  2. マルチカラム要素の幅が `width: auto` である場合、親スクロールコンテナとの関係から、ブラウザ（特に Chrome/Safari）がスクロール可能な最大幅（`scrollWidth`）を余剰に見積もってしまい、最後のページ以降にも無限にスクロールできてしまうレイアウト計算上のバグが発生します。また、縦書きマルチカラムと改ページ制御の組み合わせでは、`max-content` が最初の改ページ位置で計算を打ち切ってしまい、それ以降が非表示になる Chromium のバグがあります。
* **対策**:
  1. `app.js` のテキストパーサー内において、パース完了後の配列 `parsedLines` の先頭および末尾から空段落を `shift()`/`pop()` により自動的に切り詰めます（トリミング処理）。
  2. 改ページをセクション分割によって解決した上で、`.reader-content` および `.reader-section` のスタイルに **`width: max-content;`** を適用します。これにより、マルチカラムおよびセクションコンテナの幅は生成された全カラム（ページ数）の合計幅に厳密に一致するように強制され、ブラウザによる余分なスクロール領域の自動算出を防ぎます。
  ```css
  .reader-content,
  .reader-section {
      width: max-content; /* 全カラムの合計幅にサイズを固定し、空スクロールを完全に抑止 */
  }
  ```

### 5.7 プログレスバーの左右反転とレイアウト方向制御

* **原因**: ページの送り方向（RTL / LTR）が切り替わった際、進捗状況を示すプログレスバーおよびつまみの動作・充填方向も動的に反転させる必要があります。これをビューアーコンテンツ（`.reader-content`）に適用されている `direction: rtl` 等と共通のクラスで行うと、前述のインライン方向や表示の潰れバグを誘発するため、影響範囲をレイアウト方向制御クラスとして分離する必要がありました。
* **対策**:
  1. `applySettings()` 関数内で、`document.body` に対して現在の読書方向に対応するクラス（`layout-direction-rtl` または `layout-direction-ltr`）を動的に追加します。
  2. CSSにて、これらのクラスを親セレクタとして、プログレスバーのフレックスコンテナの配置方向および絶対配置のつまみのオフセットを定義します。
  ```css
  /* RTL (右から左) の場合のプログレスバー・つまみの配置 */
  body.layout-direction-rtl .progress-bar-container {
      display: flex;
      justify-content: flex-end;
  }
  body.layout-direction-rtl .progress-thumb {
      left: -8px;
      right: auto;
  }

  /* LTR (左から右) の場合のプログレスバー・つまみの配置 */
  body.layout-direction-ltr .progress-bar-container {
      display: flex;
      justify-content: flex-start;
  }
  body.layout-direction-ltr .progress-thumb {
      right: -8px;
      left: auto;
  }
  ```

### 5.8 ページ境界での文章の左右見切れ・ページ分割防止対策

* **原因**: 
  1. 縦書きマルチカラムレイアウトにおいて、見出し（`h1`〜`h5`）の要素がカラム（ページ）の境界にまたがって分割される際、ブラウザのフォントレンダリングやパディング計算の差異によって、境界付近の文字の左右（または上下）が見切れる（欠ける）現象が発生します。なお、通常の段落（`<p>`）に改段防止（`break-inside: avoid`）を適用すると、1ページに収まらない長文段落が完全に画面外へ押し出されたり見切れたりする別の深刻なレイアウト崩れを引き起こすため、改段防止は短い見出し要素に限定する必要があります。
  2. スクロールコンテナである `.reader-viewport` を画面幅いっぱいに広げてパディングを適用すると、改ページコード（`［＃改ページ］`）によって分割された複数の `.reader-section` が並列配置された際、余白によるレイアウトずれが累積し、改ページ以降で文字の左右が見切れていました。
* **対策**: 
  1. 読書画面内の見出し（`<h1>`〜`<h5>`）に対し、改段・改ページを防止する CSS プロパティ `break-inside: avoid` およびその互換用プロパティを適用します。通常の段落（`<p>`）は、各ページ間で自然に分割されるようにします。
  2. スクロールコンテナである `.reader-viewport` 自体を `left` / `right` から `var(--reader-padding-x)` 分引き込んで配置し、左右余白を完全にコンテナの外側に静的固定します。各ページ（カラム）の合計幅はビューポート幅（`.reader-viewport` の実表示幅）の正確な整数倍となるよう同期させます。
  3. モバイル時はビューポート幅にちょうど1つのカラムが収まるよう `column-width: 100%`、`column-gap: 0` とします。PC時は見開き2カラムが綺麗に収まるよう、`column-width: calc(50% - 40px)`、`column-gap: 80px` とします。これにより、別セクション（`.reader-section`）が並んでもマージン等の補正は不要になり、スクロール位置とページ境界が完璧に一致します。
  ```css
  /* 改段・改ページ防止（見出しのみに適用） */
  .reader-content h1,
  .reader-content h2,
  .reader-content h3,
  .reader-content h4,
  .reader-content h5 {
      break-inside: avoid;
      -webkit-column-break-inside: avoid;
      page-break-inside: avoid;
  }

  /* モバイル時：1カラムをビューポート幅に同期 */
  @media (max-width: 767px) {
      .reader-section {
          column-width: 100%;
          column-gap: 0;
      }
  }

  /* PC時：見開き2カラム（column-width + column-gap）をビューポート幅に同期 */
  @media (min-width: 768px) {
      .reader-section {
          column-width: calc(50% - 40px);
          column-gap: 80px;
      }
  }
  ```

---

## 6. デバッグ機能設計仕様 (Debug Specifications)

デバッグ画面（デバッグモーダル）は、アプリケーションの実行状態を監視し、永続化されたストレージデータを段階的に初期化するための機能です。

### 6.1 アプリ内部状態モニター仕様

`updateDebugMonitor` 関数により、現在のアプリケーションの状態変数およびビューポートの物理寸法を収集し、JSON文字列として `#debug-monitor` 要素へ反映します。
デバッグ画面が表示されている間は、`setInterval` により **1000ms（1秒間隔）** で自動的にデータがリフレッシュされます。

#### 収集対象パラメータスキーマ
```json
{
  "state": {
    "currentFileName": "string (読み込み中のファイル名 / 未ロード時は空文字)",
    "currentFileType": "string (txt | html | 空文字)",
    "bookmarkProgress": "string (進捗率のパーセンテージ表記。例: 45.2%)",
    "currentPage": "number (現在ページ番号。スクロール位置から算出)",
    "pageCount": "number (総ページ数。スクロール幅から算出)"
  },
  "viewport": {
    "clientWidth": "number (表示領域幅 px)",
    "clientHeight": "number (表示領域高 px)",
    "scrollWidth": "number (コンテンツ全体のスクロール幅 px)",
    "scrollLeft": "number (現在のスクロール量 px。RTL時はマイナス値)"
  },
  "config": {
    "theme": "string (テーマ名)",
    "font": "string (書体名)",
    "size": "string (文字サイズクラス)",
    "lh": "string (行間クラス)",
    "spacing": "string (文字間クラス)",
    "direction": "string (rtl | ltr)"
  },
  "localStorageKeys": [
    "string (現在 localStorage に保存されている全キーの配列)"
  ]
}
```

### 6.2 localStorage 初期化仕様

ユーザーがデバッグボタンを押下した際、確認のダイアログ（`confirm`）を表示した後、それぞれ対象のデータ範囲に対して初期化を実行します。

| アクション名 | トリガー要素ID | 対象データ・キー | 挙動・後続処理 |
| :--- | :--- | :--- | :--- |
| **しおりデータ初期化** | `#btn-clear-bookmarks` | `last_read_file_name`<br>`last_read_file_type`<br>`last_read_file_content`<br>`bookmark_*` | 指定されたキーを `localStorage.removeItem()` で削除。しおりをクリア後、`window.location.reload()` でページをリロードする。 |
| **表示設定初期化** | `#btn-clear-config` | `yuzora_config`<br>`koizora_config` | 設定関連のキーを削除。表示設定を初期状態にリセット後、`window.location.reload()` でリロードする。 |
| **完全初期化** | `#btn-clear-all` | 全ての `localStorage` データ | `localStorage.clear()` を実行し、全データを完全削除。その後 `window.location.reload()` で初期起動状態に戻す。 |

