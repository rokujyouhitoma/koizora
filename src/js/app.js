/**
 * コイゾラ - 青空文庫 縦書きビューアー JS
 */

document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================================
    // DOM Elements
    // ==========================================================================
    const app = document.getElementById('app');
    const welcomeScreen = document.getElementById('welcome-screen');
    const readerScreen = document.getElementById('reader-screen');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const readerViewport = document.getElementById('reader-viewport');
    const readerContent = document.getElementById('reader-content');
    const bookTitle = document.getElementById('book-title');
    
    // Controls & Navigation
    const btnBack = document.getElementById('btn-back');
    const btnSettings = document.getElementById('btn-settings');
    const btnFirstPage = document.getElementById('btn-first-page');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const settingsDrawer = document.getElementById('settings-drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const pageNavLeft = document.getElementById('page-nav-left');
    const pageNavRight = document.getElementById('page-nav-right');
    const readerHeader = document.querySelector('.reader-header');
    const readerFooter = document.querySelector('.reader-footer');
    
    // Progress
    const progressBarContainer = document.querySelector('.progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    const readingPercentage = document.getElementById('reading-percentage');
    const readingIndex = document.getElementById('reading-index');
    
    // Predefined Books Grid
    const predefinedBooksGrid = document.getElementById('predefined-books-grid');

    const PREDEFINED_BOOKS = [
        { id: "musashi_01", title: "宮本武蔵 01 序、はしがき", shortTitle: "序、はしがき", cardId: 52395, path: "src/books/52395_yoko.txt" },
        { id: "musashi_02", title: "宮本武蔵 02 地の巻", shortTitle: "地の巻", cardId: 52396, path: "src/books/52396_yoko.txt" },
        { id: "musashi_03", title: "宮本武蔵 03 水の巻", shortTitle: "水の巻", cardId: 52397, path: "src/books/52397_yoko.txt" },
        { id: "musashi_04", title: "宮本武蔵 04 火の巻", shortTitle: "火の巻", cardId: 52398, path: "src/books/52398_yoko.txt" },
        { id: "musashi_05", title: "宮本武蔵 05 風の巻", shortTitle: "風の巻", cardId: 52399, path: "src/books/52399_yoko.txt" },
        { id: "musashi_06", title: "宮本武蔵 06 空の巻", shortTitle: "空の巻", cardId: 52400, path: "src/books/52400_yoko.txt" },
        { id: "musashi_07", title: "宮本武蔵 07 二天の巻", shortTitle: "二天の巻", cardId: 52401, path: "src/books/52401_yoko.txt" },
        { id: "musashi_08", title: "宮本武蔵 08 円明の巻", shortTitle: "円明の巻", cardId: 52402, path: "src/books/52402_yoko.txt" }
    ];

    // ==========================================================================
    // State Variables
    // ==========================================================================
    let currentFileName = '';
    let currentFileContent = '';
    let currentFileType = ''; // 'txt' or 'html'
    let bookmarkProgress = 0; // 0 to 1 scroll percentage
    let headerTimeout = null;
    let isReflowing = false;

    // Viewport layout configurations
    const config = {
        theme: 'sepia',
        font: 'font-mincho',
        direction: 'rtl',
        size: 'size-md',
        lh: 'line-height-normal',
        spacing: 'spacing-normal'
    };

    // ==========================================================================
    // Initialization & Event Listeners
    // ==========================================================================
    loadSettings();
    applySettings();

    // File Drop & Select Events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Drawer settings toggle
    btnSettings.addEventListener('click', openSettings);
    btnCloseSettings.addEventListener('click', closeSettings);
    drawerOverlay.addEventListener('click', closeSettings);

    // Back to Welcome Screen
    btnBack.addEventListener('click', () => {
        saveBookmark();
        readerScreen.classList.add('hidden');
        welcomeScreen.classList.remove('hidden');
        currentFileName = '';
        currentFileContent = '';
        document.title = 'コイゾラ - 青空文庫縦書きビューアー';
    });

    // First Page Navigation
    if (btnFirstPage) {
        btnFirstPage.addEventListener('click', () => {
            bookmarkProgress = 0;
            restoreScrollPositionSmooth();
            updateProgress();
            saveBookmark();
        });
    }

    // Progress Bar click to jump
    if (progressBarContainer) {
        progressBarContainer.addEventListener('click', (e) => {
            const rect = progressBarContainer.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickProgress = Math.min(1, Math.max(0, clickX / rect.width));
            
            bookmarkProgress = clickProgress;
            restoreScrollPositionSmooth();
            updateProgress();
            saveBookmark();
        });
    }

    // Page number specify jump
    if (readingIndex) {
        readingIndex.title = "クリックしてページ移動";
        readingIndex.addEventListener('click', () => {
            const clientWidth = readerViewport.clientWidth;
            const scrollWidth = readerViewport.scrollWidth;
            const pageCount = Math.round(scrollWidth / clientWidth);
            
            const targetPageStr = prompt(`移動先ページ番号を入力してください (1 〜 ${pageCount}):`);
            if (targetPageStr === null) return; // cancelled
            
            const targetPage = parseInt(targetPageStr, 10);
            if (isNaN(targetPage) || targetPage < 1 || targetPage > pageCount) {
                alert("正しくないページ番号です。");
                return;
            }
            
            const newProgress = pageCount > 1 ? (targetPage - 1) / (pageCount - 1) : 0;
            
            bookmarkProgress = newProgress;
            restoreScrollPositionSmooth();
            updateProgress();
            saveBookmark();
        });
    }

    // Navigation Buttons
    pageNavLeft.addEventListener('click', () => {
        if (config.direction === 'rtl') {
            nextPage(); // Left goes forward in RTL
        } else {
            prevPage(); // Left goes backward in LTR
        }
    });
    pageNavRight.addEventListener('click', () => {
        if (config.direction === 'rtl') {
            prevPage(); // Right goes backward in RTL
        } else {
            nextPage(); // Right goes forward in LTR
        }
    });

    // Scroll & Window Resize Events
    let scrollSaveTimeout = null;
    function handleScrollDebounced() {
        handleScroll();
        clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => {
            saveBookmark();
        }, 300);
    }
    
    readerViewport.addEventListener('scroll', handleScrollDebounced);
    window.addEventListener('resize', handleResize);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (readerScreen.classList.contains('hidden')) return;
        if (config.direction === 'rtl') {
            if (e.key === 'ArrowLeft') {
                nextPage(); // RTL: left is forward
            } else if (e.key === 'ArrowRight') {
                prevPage(); // RTL: right is backward
            }
        } else {
            if (e.key === 'ArrowRight') {
                nextPage(); // LTR: right is forward
            } else if (e.key === 'ArrowLeft') {
                prevPage(); // LTR: left is backward
            }
        }
    });

    // Controls Toggle & Auto-Hide Behaviour
    readerViewport.addEventListener('click', toggleControls);

    // Button controls in Drawer
    setupDrawerControls();

    // Render Predefined Books Grid
    if (predefinedBooksGrid) {
        PREDEFINED_BOOKS.forEach(book => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.setAttribute('data-id', book.id);
            card.innerHTML = `
                <div class="book-card-cover">
                    <div class="book-card-title">${book.shortTitle}</div>
                </div>
                <div class="book-card-meta">${book.title.split(' ')[1]}</div>
            `;
            card.addEventListener('click', () => {
                loadPredefinedBook(book);
            });
            predefinedBooksGrid.appendChild(card);
        });
    }

    // Save bookmark on visibility change
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveBookmark();
        }
    });

    // Try to auto-load last session if available
    checkLastSession();

    // ==========================================================================
    // File Handling & Parsing
    // ==========================================================================
    function handleFile(file) {
        currentFileName = file.name;
        currentFileType = file.name.split('.').pop().toLowerCase();
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const arrayBuffer = e.target.result;
            let text = '';
            try {
                const decoder = new TextDecoder('shift-jis', { fatal: true });
                text = decoder.decode(arrayBuffer);
            } catch (err) {
                console.warn("Shift_JIS decode failed (fatal=true), falling back to UTF-8", err);
                const utf8Decoder = new TextDecoder('utf-8');
                text = utf8Decoder.decode(arrayBuffer);
            }

            currentFileContent = text;
            displayBook();
        };

        reader.readAsArrayBuffer(file);
    }

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
                    console.warn("Shift_JIS decode failed (fatal=true), falling back to UTF-8 for predefined book", err);
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

    function displayBook() {
        let parsedHTML = '';
        let title = currentFileName;

        if (currentFileType === 'txt') {
            // Parse plain text with Aozora annotation
            const parsed = parseAozoraText(currentFileContent);
            parsedHTML = parsed.body;
            title = parsed.title || currentFileName.replace('.txt', '');
        } else {
            // XHTML/HTML
            const parsed = parseAozoraHTML(currentFileContent);
            parsedHTML = parsed.body;
            title = parsed.title || currentFileName.replace(/\.(x?html)/, '');
        }

        // Override with predefined book title if matched
        const predefinedBook = PREDEFINED_BOOKS.find(b => currentFileName.includes(b.cardId.toString()));
        if (predefinedBook) {
            title = predefinedBook.title;
        }

        // Apply to viewer
        bookTitle.textContent = title;
        document.title = `${title} - コイゾラ`;
        readerContent.innerHTML = parsedHTML;

        // Display Reader, Hide Welcome Screen
        welcomeScreen.classList.add('hidden');
        readerScreen.classList.remove('hidden');

        // Check if there is a saved bookmark for this file
        const savedProgress = localStorage.getItem(`bookmark_${currentFileName}`);
        if (savedProgress) {
            bookmarkProgress = parseFloat(savedProgress);
        } else {
            bookmarkProgress = 0;
        }

        // Wait a tick for rendering to complete before restoring scroll position
        isReflowing = true;
        setTimeout(() => {
            restoreScrollPosition();
            updateProgress();
            triggerHeaderShow();
            setTimeout(() => {
                isReflowing = false;
            }, 50);
        }, 100);
    }

    /**
     * Parses Plain Text Aozora Formatting (Rubies, Page breaks, etc.)
     */
    function parseAozoraText(text) {
        let lines = text.split(/\r?\n/);
        let parsedLines = [];
        let title = '';
        let author = '';
        let inHeader = true;
        let mainBodyStarted = false;
        
        // Remove Aozora metadata headers and footers (lines before first long line or metadata separator)
        // Usually, the first line is the title, the second is the author.
        if (lines.length > 2) {
            title = lines[0].trim();
            author = lines[1].trim();
        }

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Detect end of header metadata (often dashes or empty lines)
            if (inHeader) {
                if (line.includes('-------------------------------------------------------')) {
                    inHeader = false;
                    continue;
                }
                // Skip introduction headers
                if (line.includes('［＃') && (line.includes('始まり') || line.includes('目次'))) {
                    inHeader = false;
                }
                // If we hit a very long line or paragraph without ［＃, start main body
                if (line.trim().length > 0 && !line.startsWith('［＃') && i > 5) {
                    inHeader = false;
                }
                if (inHeader) continue; // Skip header lines
            }

            // Detect Aozora footer metadata separator
            if (line.includes('底本：') || line.includes('青空文庫作成ファイル：')) {
                break;
            }

            // Convert Aozora rubies and formatting
            line = formatAozoraMarkup(line);

            // Output lines
            if (line.trim().length === 0) {
                // Keep empty lines as spacing paragraph or combine
                parsedLines.push('<p class="empty-line">&nbsp;</p>');
            } else {
                // Handle headings
                if (line.startsWith('<h2>') || line.startsWith('<h3>')) {
                    parsedLines.push(line);
                } else {
                    parsedLines.push(`<p>${line}</p>`);
                }
            }
        }

        // Trim empty lines from the end of parsedLines to prevent trailing blank spaces
        while (parsedLines.length > 0 && parsedLines[parsedLines.length - 1] === '<p class="empty-line">&nbsp;</p>') {
            parsedLines.pop();
        }
        // Also trim from the start to clean up leading empty space
        while (parsedLines.length > 0 && parsedLines[0] === '<p class="empty-line">&nbsp;</p>') {
            parsedLines.shift();
        }

        // Wrap paragraphs
        let bodyContent = parsedLines.join('\n');

        return {
            title: title + (author ? ` (${author})` : ''),
            body: bodyContent
        };
    }

    function formatAozoraMarkup(line) {
        // Escapes HTML tags to prevent cross-site scripting
        line = line.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');

        // 1. Ruby with explicit delimiter: ｜漢字《かんじ》 or |漢字《かんじ》
        // Match both full-width ｜ and half-width |
        line = line.replace(/[｜|]([^《\r\n]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 2. Ruby without explicit delimiter: 漢字《かんじ》
        // Match Chinese characters (Kanji, including iteration marks like 々)
        line = line.replace(/([一-龠々〆ヶ]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 3. Page breaks: ［＃改ページ］
        line = line.replace(/［＃改ページ］/g, '<div class="page-break" style="break-before: column; height: 100%;"></div>');

        // 4. Accent notes: ［＃「...」に傍点］
        // (Simplified placeholder handling: highlight text)
        line = line.replace(/［＃「([^」]+)」に傍点］/g, '<span class="bouten">$1</span>');

        // 5. General annotations (usually clean up for clean reading)
        // e.g. ［＃ここから１字下げ］ -> Remove from display but keep formatting if possible
        line = line.replace(/［＃ここから([^］]+)］/g, '');
        line = line.replace(/［＃ここで([^］]+)］/g, '');
        line = line.replace(/［＃([^］]+)］/g, ''); // Remove other Aozora system annotations

        // Remove input control characters (like Form Feed or byte order marks)
        line = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        return line;
    }

    /**
     * Parses XHTML Aozora Formatting
     */
    function parseAozoraHTML(htmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        
        const titleEl = doc.querySelector('title');
        let title = titleEl ? titleEl.textContent : '';

        // Extract main body
        let mainBody = doc.querySelector('.main_body');
        if (!mainBody) {
            mainBody = doc.querySelector('body');
        }

        // Clean up metadata section if present in the HTML (usually near bottom or inside wrapper)
        const bibliographicalInfo = mainBody.querySelector('.bibliographical_information');
        if (bibliographicalInfo) bibliographicalInfo.remove();
        
        const cardLink = mainBody.querySelector('.card_link');
        if (cardLink) cardLink.remove();

        return {
            title: title,
            body: mainBody.innerHTML
        };
    }

    // ==========================================================================
    // Scrolling, Paging, and Bookmarks
    // ==========================================================================
    function handleScroll() {
        if (isReflowing) return;
        
        const maxScroll = readerViewport.scrollWidth - readerViewport.clientWidth;
        
        if (maxScroll <= 0) return;

        // In RTL writing mode, scrollLeft is negative or zero.
        // Convert to absolute value for progress calculation.
        const currentScroll = Math.abs(readerViewport.scrollLeft);
        bookmarkProgress = currentScroll / maxScroll;
        
        updateProgress();
    }

    function updateProgress() {
        const clientWidth = readerViewport.clientWidth;
        const scrollWidth = readerViewport.scrollWidth;
        const maxScroll = scrollWidth - clientWidth;
        const currentScroll = Math.abs(readerViewport.scrollLeft);

        // Progress bar percentage (0 to 100)
        const percentage = Math.min(100, Math.max(0, Math.round(bookmarkProgress * 100)));
        progressBar.style.width = `${percentage}%`;
        readingPercentage.textContent = `${percentage}%`;

        // Calculate pages based on viewport clientWidth and gaps
        // Gap is 80px, so effective page width is clientWidth + gap.
        const pageCount = Math.round(scrollWidth / clientWidth);
        const currentPage = Math.min(pageCount, Math.max(1, Math.round(currentScroll / clientWidth) + 1));
        readingIndex.textContent = `${currentPage} / ${pageCount} ページ`;
    }

    function restoreScrollPosition() {
        const maxScroll = readerViewport.scrollWidth - readerViewport.clientWidth;
        if (config.direction === 'rtl') {
            // In vertical-rl, scrolling forward is in the negative direction.
            readerViewport.scrollLeft = -(bookmarkProgress * maxScroll);
        } else {
            // In vertical-lr, scrolling forward is in the positive direction.
            readerViewport.scrollLeft = bookmarkProgress * maxScroll;
        }
    }

    function restoreScrollPositionSmooth() {
        const maxScroll = readerViewport.scrollWidth - readerViewport.clientWidth;
        const targetScroll = config.direction === 'rtl' ? -(bookmarkProgress * maxScroll) : (bookmarkProgress * maxScroll);
        readerViewport.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }

    function nextPage() {
        const amount = readerViewport.clientWidth;
        if (config.direction === 'rtl') {
            // Forward in RTL layout means scrolling Left (negative direction)
            readerViewport.scrollBy({ left: -amount, behavior: 'smooth' });
        } else {
            // Forward in LTR layout means scrolling Right (positive direction)
            readerViewport.scrollBy({ left: amount, behavior: 'smooth' });
        }
    }

    function prevPage() {
        const amount = readerViewport.clientWidth;
        if (config.direction === 'rtl') {
            // Backward in RTL layout means scrolling Right (positive direction)
            readerViewport.scrollBy({ left: amount, behavior: 'smooth' });
        } else {
            // Backward in LTR layout means scrolling Left (negative direction)
            readerViewport.scrollBy({ left: -amount, behavior: 'smooth' });
        }
    }

    function handleResize() {
        // Layout columns width changes, so we must restore scroll position based on percentage
        if (!readerScreen.classList.contains('hidden')) {
            isReflowing = true;
            restoreScrollPosition();
            updateProgress();
            setTimeout(() => {
                isReflowing = false;
            }, 150);
        }
    }

    // Bookmark saving
    function saveBookmark() {
        if (currentFileName) {
            localStorage.setItem(`bookmark_${currentFileName}`, bookmarkProgress.toString());
            localStorage.setItem('last_read_file_name', currentFileName);
            localStorage.setItem('last_read_file_type', currentFileType);
            localStorage.setItem('last_read_file_content', currentFileContent);
        }
    }

    // Auto save bookmark on tab close
    window.addEventListener('beforeunload', saveBookmark);

    function checkLastSession() {
        const lastName = localStorage.getItem('last_read_file_name');
        const lastContent = localStorage.getItem('last_read_file_content');
        const lastType = localStorage.getItem('last_read_file_type');

        if (lastName && lastContent && lastType) {
            currentFileName = lastName;
            currentFileContent = lastContent;
            currentFileType = lastType;
            displayBook();
        }
    }

    // ==========================================================================
    // UI Setting Controls & Customizations
    // ==========================================================================
    function setupDrawerControls() {
        // Theme Selector
        setupButtonGroup('.theme-selector button', 'theme', (val) => {
            // Apply theme class to body
            document.body.className = '';
            document.body.classList.add(`theme-${val}`);
        });

        // Font Family
        setupButtonGroup('.font-selector button', 'font', (val) => {
            isReflowing = true;
            readerContent.classList.remove('font-mincho', 'font-gothic');
            readerContent.classList.add(val);
            setTimeout(() => {
                restoreScrollPosition();
                updateProgress();
                isReflowing = false;
            }, 150);
        });

        // Reading Direction
        setupButtonGroup('.direction-selector button', 'direction', (val) => {
            isReflowing = true;
            readerContent.classList.remove('direction-rtl', 'direction-ltr');
            readerContent.classList.add(`direction-${val}`);
            
            // Adjust overlay title tooltips dynamically
            if (val === 'rtl') {
                pageNavLeft.title = "次のページへ";
                pageNavRight.title = "前のページへ";
            } else {
                pageNavLeft.title = "前のページへ";
                pageNavRight.title = "次のページへ";
            }
            
            setTimeout(() => {
                restoreScrollPosition();
                updateProgress();
                isReflowing = false;
            }, 150);
        });

        // Font Size
        setupButtonGroup('.size-selector button', 'size', (val) => {
            isReflowing = true;
            readerContent.classList.remove('size-sm', 'size-md', 'size-lg', 'size-xl');
            readerContent.classList.add(val);
            setTimeout(() => {
                restoreScrollPosition();
                updateProgress();
                isReflowing = false;
            }, 150);
        });

        // Line Height
        setupButtonGroup('.lh-selector button', 'lh', (val) => {
            isReflowing = true;
            readerContent.classList.remove('line-height-tight', 'line-height-normal', 'line-height-loose');
            readerContent.classList.add(val);
            setTimeout(() => {
                restoreScrollPosition();
                updateProgress();
                isReflowing = false;
            }, 150);
        });

        // Letter Spacing
        setupButtonGroup('.spacing-selector button', 'spacing', (val) => {
            isReflowing = true;
            readerContent.classList.remove('spacing-tight', 'spacing-normal', 'spacing-loose');
            readerContent.classList.add(val);
            setTimeout(() => {
                restoreScrollPosition();
                updateProgress();
                isReflowing = false;
            }, 150);
        });
    }

    function setupButtonGroup(selector, configKey, callback) {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const value = btn.getAttribute(`data-${configKey}`);
                config[configKey] = value;
                
                callback(value);
                saveSettings();
            });
        });
    }

    function saveSettings() {
        localStorage.setItem('koizora_config', JSON.stringify(config));
    }

    function loadSettings() {
        const saved = localStorage.getItem('koizora_config');
        if (saved) {
            try {
                Object.assign(config, JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse config", e);
            }
        }
    }

    function applySettings() {
        // Apply settings config values to target elements
        document.body.className = '';
        document.body.classList.add(`theme-${config.theme}`);

        // Update CSS direction dynamically to align scroll origin with text flow direction
        readerViewport.style.direction = config.direction;

        readerContent.className = 'reader-content';
        readerContent.classList.add(config.font, `direction-${config.direction}`, config.size, config.lh, config.spacing);

        // Update navigation overlays page titles based on direction
        if (config.direction === 'rtl') {
            pageNavLeft.title = "次のページへ";
            pageNavRight.title = "前のページへ";
        } else {
            pageNavLeft.title = "前のページへ";
            pageNavRight.title = "次のページへ";
        }

        // Update Button States in Drawer UI
        syncButtonState('.theme-selector button', 'theme', config.theme);
        syncButtonState('.font-selector button', 'font', config.font);
        syncButtonState('.direction-selector button', 'direction', config.direction);
        syncButtonState('.size-selector button', 'size', config.size);
        syncButtonState('.lh-selector button', 'lh', config.lh);
        syncButtonState('.spacing-selector button', 'spacing', config.spacing);
    }

    function syncButtonState(selector, attrName, value) {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(btn => {
            if (btn.getAttribute(`data-${attrName}`) === value) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function openSettings() {
        settingsDrawer.classList.add('open');
        drawerOverlay.classList.add('open');
    }

    function closeSettings() {
        settingsDrawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        triggerHeaderShow();
    }

    // ==========================================================================
    // Header & Footer UI Toggle/Auto-Hide
    // ==========================================================================
    function hideControls() {
        if (!settingsDrawer.classList.contains('open')) {
            readerHeader.classList.add('hidden');
            if (readerFooter) {
                readerFooter.classList.add('hidden');
            }
        }
    }

    function triggerHeaderShow() {
        readerHeader.classList.remove('hidden');
        if (readerFooter) {
            readerFooter.classList.remove('hidden');
        }
        
        clearTimeout(headerTimeout);
        headerTimeout = setTimeout(() => {
            hideControls();
        }, 3000); // Hide after 3 seconds of inactivity
    }

    function toggleControls(e) {
        // Prevent toggle if clicking interactive elements inside reader viewport
        if (e.target.closest('a') || e.target.closest('ruby') || e.target.closest('button')) {
            return;
        }

        if (readerHeader.classList.contains('hidden')) {
            triggerHeaderShow();
        } else {
            clearTimeout(headerTimeout);
            hideControls();
        }
    }
});
