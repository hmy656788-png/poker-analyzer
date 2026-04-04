(function (global) {
    let videoStream = null;
    let targetTarget = 'hand'; // 'hand' or 'community'
    let previewCards = [];     // cards pending confirmation
    let previewImageSrc = '';  // captured image for preview

    function DOM(id) { return document.getElementById(id); }

    function openScannerModal(modal) {
        if (!modal) return;
        modal.style.display = 'flex';
    }

    function closeScannerModal(modal) {
        if (!modal) return;
        modal.style.display = 'none';
    }

    function stopVideoStream() {
        if (!videoStream) return;
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getRenderedVideoMetrics(video) {
        const videoRect = video.getBoundingClientRect();
        const sourceWidth = video.videoWidth || 0;
        const sourceHeight = video.videoHeight || 0;
        if (!videoRect.width || !videoRect.height || !sourceWidth || !sourceHeight) {
            return null;
        }

        const sourceAspect = sourceWidth / sourceHeight;
        const boxAspect = videoRect.width / videoRect.height;
        let renderedWidth = videoRect.width;
        let renderedHeight = videoRect.height;
        let offsetX = 0;
        let offsetY = 0;

        if (sourceAspect > boxAspect) {
            renderedHeight = renderedWidth / sourceAspect;
            offsetY = (videoRect.height - renderedHeight) / 2;
        } else {
            renderedWidth = renderedHeight * sourceAspect;
            offsetX = (videoRect.width - renderedWidth) / 2;
        }

        return {
            sourceWidth,
            sourceHeight,
            renderedWidth,
            renderedHeight,
            offsetX,
            offsetY,
            videoRect
        };
    }

    function getFrameCrop(video, frame, paddingRatio) {
        if (!frame) return null;

        const metrics = getRenderedVideoMetrics(video);
        if (!metrics) return null;

        const { sourceWidth, sourceHeight, renderedWidth, renderedHeight, offsetX, offsetY, videoRect } = metrics;
        const frameRect = frame.getBoundingClientRect();

        const renderedLeft = videoRect.left + offsetX;
        const renderedTop = videoRect.top + offsetY;
        const renderedRight = renderedLeft + renderedWidth;
        const renderedBottom = renderedTop + renderedHeight;

        const cropLeft = Math.max(frameRect.left, renderedLeft);
        const cropTop = Math.max(frameRect.top, renderedTop);
        const cropRight = Math.min(frameRect.right, renderedRight);
        const cropBottom = Math.min(frameRect.bottom, renderedBottom);

        if (cropRight <= cropLeft || cropBottom <= cropTop) {
            return null;
        }

        const scaleX = sourceWidth / renderedWidth;
        const scaleY = sourceHeight / renderedHeight;
        const padding = typeof paddingRatio === 'number' ? paddingRatio : 0.05;
        const padX = (cropRight - cropLeft) * padding;
        const padY = (cropBottom - cropTop) * padding;

        const x = clamp(Math.round((cropLeft - renderedLeft - padX) * scaleX), 0, sourceWidth - 1);
        const y = clamp(Math.round((cropTop - renderedTop - padY) * scaleY), 0, sourceHeight - 1);
        const width = clamp(Math.round((cropRight - cropLeft + padX * 2) * scaleX), 1, sourceWidth - x);
        const height = clamp(Math.round((cropBottom - cropTop + padY * 2) * scaleY), 1, sourceHeight - y);

        return { x, y, width, height };
    }

    // ── Image enhancement pipeline ──────────────────────────────────────

    function applyUnsharpMask(ctx, width, height, amount) {
        // Simple unsharp mask via canvas: blur → subtract → add
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        // Simple 3x3 blur kernel
        const blurred = new Uint8ClampedArray(data.length);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                for (let c = 0; c < 3; c++) {
                    const idx = (y * width + x) * 4 + c;
                    let sum = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += copy[((y + dy) * width + (x + dx)) * 4 + c];
                        }
                    }
                    blurred[idx] = sum / 9;
                }
                blurred[(y * width + x) * 4 + 3] = 255;
            }
        }

        // Unsharp: original + amount * (original - blurred)
        for (let i = 0; i < data.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                const diff = copy[i + c] - blurred[i + c];
                data[i + c] = clamp(Math.round(copy[i + c] + amount * diff), 0, 255);
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function captureFrameAsJpeg(video, canvas, frame, options) {
        const enhance = !!(options && options.enhance);
        const crop = getFrameCrop(video, frame, enhance ? 0.01 : 0.03);
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;

        const srcX = crop ? crop.x : 0;
        const srcY = crop ? crop.y : 0;
        const srcWidth = crop ? crop.width : sourceWidth;
        const srcHeight = crop ? crop.height : sourceHeight;

        // Higher resolution for better detail
        const MAX_WIDTH = 1600;
        let targetWidth = srcWidth;
        let targetHeight = srcHeight;
        if (targetWidth > MAX_WIDTH) {
            targetHeight = Math.max(1, Math.round(targetHeight * (MAX_WIDTH / targetWidth)));
            targetWidth = MAX_WIDTH;
        }

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Improved filter chain
        if (enhance) {
            ctx.filter = 'contrast(1.35) saturate(1.4) brightness(1.05) sharpen(1)';
        } else {
            ctx.filter = 'contrast(1.18) saturate(1.2) brightness(1.03)';
        }

        ctx.drawImage(video, srcX, srcY, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
        ctx.filter = 'none';

        // Apply unsharp mask for sharper corner indexes
        if (enhance) {
            applyUnsharpMask(ctx, targetWidth, targetHeight, 1.2);
        } else {
            applyUnsharpMask(ctx, targetWidth, targetHeight, 0.6);
        }

        return canvas.toDataURL('image/jpeg', 0.92);
    }

    // ── Network request ─────────────────────────────────────────────────

    async function requestScan(base64Image, mode) {
        const response = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64Image,
                mode: mode || 'default'
            })
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload && (payload.details || payload.error)
                ? (payload.details || payload.error)
                : `HTTP Error ${response.status}`;
            throw new Error(message);
        }

        if (payload && payload.error) {
            throw new Error(payload.error);
        }

        return payload || {};
    }

    // ── Camera helpers ──────────────────────────────────────────────────

    async function requestCameraStream() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('当前浏览器不支持摄像头调用');
        }

        try {
            return await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
        } catch (error) {
            return navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
        }
    }

    async function attachVideoStream(video, status, button) {
        stopVideoStream();

        const stream = await requestCameraStream();
        videoStream = stream;
        video.srcObject = stream;

        if (video.readyState < 1) {
            await new Promise((resolve) => {
                video.onloadedmetadata = () => resolve();
            });
        }
        await video.play().catch(() => {});

        if (status) {
            status.textContent = "请将扑克牌角标对准框内，尽量贴近，避免反光";
        }
        if (button) {
            button.disabled = false;
        }
    }

    // ── Multi-frame capture ─────────────────────────────────────────────

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function captureMultipleFrames(video, canvas, frame, count) {
        const frames = [];
        for (let i = 0; i < count; i++) {
            if (i > 0) await delay(250);
            const img = captureFrameAsJpeg(video, canvas, frame, { enhance: i > 0 });
            frames.push(img);
        }
        return frames;
    }

    // ── Voting / merge logic ────────────────────────────────────────────

    function voteCards(resultArrays) {
        // resultArrays: Array of card arrays, e.g. [['Ah','Kd'], ['Ah','Ks'], ['Ah','Kd']]
        // For each position, pick the card that appears most often
        const maxLen = Math.max(...resultArrays.map(a => a.length));
        if (maxLen === 0) return [];

        const allCards = {};
        // Count total appearances across all results
        for (const cards of resultArrays) {
            for (const card of cards) {
                allCards[card] = (allCards[card] || 0) + 1;
            }
        }

        // Sort by frequency (descending), then alphabetically
        const sorted = Object.entries(allCards)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(e => e[0]);

        // Return unique cards, favoring those that appear in ≥2 results
        const seen = new Set();
        const output = [];
        for (const card of sorted) {
            if (seen.has(card)) continue;
            seen.add(card);
            output.push(card);
        }

        return output;
    }

    // ── Card parsing (from vision output text) ──────────────────────────

    function parseVisionCards(rawText) {
        const text = String(rawText || '');
        if (!text.trim()) return [];

        const cards = [];
        const seen = new Set();
        const consumedRanges = [];
        const suitSymbolMap = {
            '\u2660': 's',
            '\u2664': 's',
            '\u2665': 'h',
            '\u2661': 'h',
            '\u2666': 'd',
            '\u2662': 'd',
            '\u2663': 'c',
            '\u2667': 'c'
        };

        const normalized = text.replace(/[\u2660\u2664\u2665\u2661\u2666\u2662\u2663\u2667]/g, (symbol) => suitSymbolMap[symbol] || symbol);

        function normalizeRank(rankToken) {
            const token = String(rankToken || '').trim().toLowerCase();
            const rankMap = {
                a: 'A',
                ace: 'A',
                k: 'K',
                king: 'K',
                q: 'Q',
                queen: 'Q',
                j: 'J',
                jack: 'J',
                t: 'T',
                ten: 'T',
                '10': 'T',
                '9': '9',
                '8': '8',
                '7': '7',
                '6': '6',
                '5': '5',
                '4': '4',
                '3': '3',
                '2': '2'
            };
            return rankMap[token] || '';
        }

        function normalizeSuit(suitToken) {
            const token = String(suitToken || '').trim().toLowerCase();
            if (token === 's' || token.startsWith('spade')) return 's';
            if (token === 'h' || token.startsWith('heart')) return 'h';
            if (token === 'd' || token.startsWith('diamond')) return 'd';
            if (token === 'c' || token.startsWith('club')) return 'c';
            if (token === '黑桃') return 's';
            if (token === '红桃' || token === '红心') return 'h';
            if (token === '方块' || token === '方片') return 'd';
            if (token === '梅花' || token === '草花') return 'c';
            return '';
        }

        function addCard(rankToken, suitToken) {
            const rank = normalizeRank(rankToken);
            const suit = normalizeSuit(suitToken);
            if (!rank || !suit) return;
            const card = rank + suit;
            if (seen.has(card)) return;
            seen.add(card);
            cards.push(card);
        }

        function hasOverlap(start, end) {
            return consumedRanges.some((range) => start < range.end && end > range.start);
        }

        function recordMatch(match, rankToken, suitToken) {
            const start = typeof match.index === 'number' ? match.index : -1;
            const end = start >= 0 ? start + match[0].length : -1;
            if (start >= 0 && hasOverlap(start, end)) return;
            const beforeCount = cards.length;
            addCard(rankToken, suitToken);
            if (start >= 0 && cards.length > beforeCount) {
                consumedRanges.push({ start, end });
            }
        }

        const shorthandRegex = /(^|[\s,，；;])((?:10|[2-9TJQKA])\s*[shdc])(?=$|[\s,，；;])/gi;
        for (const match of normalized.matchAll(shorthandRegex)) {
            const token = match[2].replace(/\s+/g, '');
            recordMatch(match, token.slice(0, -1), token.slice(-1));
        }

        const wordRegex = /(^|[\s,，；;])((ace|king|queen|jack|ten|10|[2-9]|[akqjt])\s*(?:of\s+)?(spades?|hearts?|diamonds?|clubs?|[shdc]))(?=$|[\s,，；;])/gi;
        for (const match of normalized.matchAll(wordRegex)) {
            recordMatch(match, match[3], match[4]);
        }

        const unicodeWordRegex = /(^|[\s,，；;])((ace|king|queen|jack|ten|10|[2-9]|[akqjt])\s*(黑桃|红桃|红心|方块|方片|梅花|草花))(?=$|[\s,，；;])/gi;
        for (const match of normalized.matchAll(unicodeWordRegex)) {
            recordMatch(match, match[3], match[4]);
        }

        const reverseWordRegex = /(^|[\s,，；;])((spades?|hearts?|diamonds?|clubs?)\s*(?:of\s+)?(ace|king|queen|jack|ten|10|[2-9]|[akqjt]))(?=$|[\s,，；;])/gi;
        for (const match of normalized.matchAll(reverseWordRegex)) {
            recordMatch(match, match[4], match[3]);
        }

        const reverseChineseRegex = /(^|[\s,，；;])((黑桃|红桃|红心|方块|方片|梅花|草花)\s*(ace|king|queen|jack|ten|10|[2-9]|[akqjt]))(?=$|[\s,，；;])/gi;
        for (const match of normalized.matchAll(reverseChineseRegex)) {
            recordMatch(match, match[4], match[3]);
        }

        return cards;
    }

    // ── Retry heuristics ────────────────────────────────────────────────

    function countRankMentions(rawText) {
        const matches = String(rawText || '').match(/\b(ace|king|queen|jack|ten|10|[2-9]|[akqjt])\b/gi);
        return matches ? matches.length : 0;
    }

    function hasSuitMention(rawText) {
        return /(spades?|hearts?|diamonds?|clubs?|[shdc](?![a-z])|黑桃|红桃|红心|方块|方片|梅花|草花|[♠♥♦♣])/i.test(String(rawText || ''));
    }

    function shouldRetryEnhanced(rawText, parsedCards, target) {
        const text = String(rawText || '').trim();
        if (!text || text.toLowerCase() === 'none') return true;
        if (parsedCards.length === 0) return true;
        if (target === 'hand' && parsedCards.length < 2) return true;
        if (target === 'community' && parsedCards.length < 3) return true;
        return countRankMentions(text) > parsedCards.length || !hasSuitMention(text);
    }

    function mergeCardLists(primary, secondary) {
        const output = [];
        const seen = new Set();

        for (const list of [primary, secondary]) {
            for (const card of list || []) {
                if (!card || seen.has(card)) continue;
                seen.add(card);
                output.push(card);
            }
        }

        return output;
    }

    // ── Preview / confirmation UI ───────────────────────────────────────

    const RANK_DISPLAY = { '2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','T':'10','J':'J','Q':'Q','K':'K','A':'A' };
    const SUIT_DISPLAY = { s: '♠', h: '♥', d: '♦', c: '♣' };
    const SUIT_CLASS   = { s: 'black', h: 'red', d: 'red', c: 'black' };

    function buildPreviewCard(cardKey, index) {
        const rank = cardKey[0];
        const suit = cardKey[1];
        const div = document.createElement('div');
        div.className = 'preview-card ' + SUIT_CLASS[suit];
        div.dataset.idx = index;
        div.innerHTML =
            '<span class="preview-card-rank">' + (RANK_DISPLAY[rank] || rank) + '</span>' +
            '<span class="preview-card-suit">' + (SUIT_DISPLAY[suit] || suit) + '</span>';
        div.onclick = function() { openCardCorrector(index); };
        return div;
    }

    function renderPreview(cards, imageSrc) {
        const previewPanel = DOM('scannerPreview');
        const previewImg = DOM('scannerPreviewImg');
        const previewCardsList = DOM('scannerPreviewCards');
        const cameraView = document.querySelector('.scanner-body .video-container');
        const controls = document.querySelector('.scanner-controls');

        if (!previewPanel || !previewCardsList) return;

        // Save state
        previewCards = cards.slice();
        previewImageSrc = imageSrc;

        // Show preview image
        if (previewImg && imageSrc) {
            previewImg.src = imageSrc;
            previewImg.style.display = 'block';
        }

        // Render card chips
        previewCardsList.innerHTML = '';
        cards.forEach(function(card, i) {
            previewCardsList.appendChild(buildPreviewCard(card, i));
        });

        // Add "add card" button if fewer than max
        const maxCards = targetTarget === 'hand' ? 2 : 5;
        if (cards.length < maxCards) {
            const addBtn = document.createElement('div');
            addBtn.className = 'preview-card add-card';
            addBtn.innerHTML = '<span class="preview-card-rank">+</span><span class="preview-card-suit">添加</span>';
            addBtn.onclick = function() { openCardCorrector(cards.length); };
            previewCardsList.appendChild(addBtn);
        }

        // Hide camera, show preview
        if (cameraView) cameraView.style.display = 'none';
        if (controls) controls.style.display = 'none';
        previewPanel.style.display = 'flex';
    }

    function hidePreview() {
        const previewPanel = DOM('scannerPreview');
        const cameraView = document.querySelector('.scanner-body .video-container');
        const controls = document.querySelector('.scanner-controls');

        if (previewPanel) previewPanel.style.display = 'none';
        if (cameraView) cameraView.style.display = '';
        if (controls) controls.style.display = '';
    }

    function confirmPreview() {
        if (previewCards.length > 0) {
            fillCards(previewCards);
            if (global.app && global.app.vibrate) global.app.vibrate('success');
        }
        hidePreview();
        api.closeScanner();
    }

    function retakePhoto() {
        hidePreview();
        const btn = DOM('btnCaptureScan');
        const status = DOM('scannerStatus');
        if (btn) btn.disabled = false;
        if (status) status.textContent = '请重新对准牌面拍摄';
    }

    // ── Mini card corrector ─────────────────────────────────────────────

    function openCardCorrector(index) {
        const overlay = DOM('cardCorrectorOverlay');
        if (!overlay) return;

        const ranks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
        const suits = ['s','h','d','c'];

        let html = '<div class="corrector-panel">';
        html += '<div class="corrector-title">选择正确的牌</div>';
        html += '<div class="corrector-grid">';

        for (const suit of suits) {
            for (const rank of ranks) {
                const key = rank + suit;
                const colorClass = SUIT_CLASS[suit];
                html += '<button class="corrector-btn ' + colorClass + '" data-card="' + key + '">'
                    + (RANK_DISPLAY[rank] || rank)
                    + '<span>' + SUIT_DISPLAY[suit] + '</span>'
                    + '</button>';
            }
        }

        html += '</div>';
        html += '<button class="corrector-cancel" onclick="document.getElementById(\'cardCorrectorOverlay\').style.display=\'none\'">取消</button>';
        html += '</div>';

        overlay.innerHTML = html;
        overlay.style.display = 'flex';

        // Bind click events
        overlay.querySelectorAll('.corrector-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                const card = btn.dataset.card;
                if (index < previewCards.length) {
                    previewCards[index] = card;
                } else {
                    previewCards.push(card);
                }
                overlay.style.display = 'none';
                renderPreview(previewCards, previewImageSrc);
            });
        });
    }

    // ── Progress state helper ───────────────────────────────────────────

    function updateProgress(status, phase, current, total) {
        if (!status) return;
        const progressBar = DOM('scannerProgressBar');
        const progressFill = DOM('scannerProgressFill');

        const messages = {
            'sampling': '📸 正在采样第 ' + current + '/' + total + ' 帧...',
            'analyzing': '🧠 AI 正在分析识别（约3-6秒）...',
            'retrying': '🔄 首次结果不完整，增强识别中...',
            'merging': '✅ 正在合并结果...',
            'done': '✅ 识别完成！',
            'error': '❌ 识别失败'
        };

        status.textContent = messages[phase] || phase;

        if (progressBar && progressFill) {
            progressBar.style.display = 'block';
            const percent = phase === 'done' ? 100 :
                            phase === 'sampling' ? (current / total * 30) :
                            phase === 'analyzing' ? 50 :
                            phase === 'retrying' ? 70 :
                            phase === 'merging' ? 90 : 0;
            progressFill.style.width = percent + '%';
        }
    }

    // ── Fill cards into app state ────────────────────────────────────────

    function fillCards(cardKeys) {
        if (!global.app) return;

        const state = global.app.__getInternalState ? global.app.__getInternalState() : null;
        if (!state) return;

        const filled = new Set();
        state.hand.forEach(c => c && filled.add(getInternalKey(c)));
        state.community.forEach(c => c && filled.add(getInternalKey(c)));

        const internalRanks = '23456789TJQKA';
        const internalSuits = 'shdc';

        let insertedCount = 0;

        for (const key of cardKeys) {
            const rChar = key[0];
            const sChar = key[1];
            const rScore = internalRanks.indexOf(rChar);
            const sScore = internalSuits.indexOf(sChar);

            if (rScore === -1 || sScore === -1) continue;

            if (filled.has(key)) continue;

            const targetArray = targetTarget === 'hand' ? state.hand : state.community;
            const maxFill = targetTarget === 'hand' ? 2 : 5;

            let emptyIdx = -1;
            for (let i = 0; i < maxFill; i++) {
                if (targetArray[i] === null) {
                    emptyIdx = i;
                    break;
                }
            }

            if (emptyIdx !== -1) {
                targetArray[emptyIdx] = { rank: rScore, suit: sScore };
                filled.add(key);
                insertedCount++;
            }
        }

        if (insertedCount > 0) {
            if (global.app.__renderSelectedCards) global.app.__renderSelectedCards();
            if (global.app.__analyze) global.app.__analyze();
        }
    }

    function getInternalKey(cardObj) {
        if (!cardObj) return null;
        const ranks = '23456789TJQKA';
        const suits = 'shdc';
        return ranks[cardObj.rank] + suits[cardObj.suit];
    }

    // ── Main API ────────────────────────────────────────────────────────

    const api = {
        openScanner: async function (target) {
            targetTarget = target;
            const modal = DOM('scannerModal');
            const video = DOM('scannerVideo');
            const status = DOM('scannerStatus');
            const button = DOM('btnCaptureScan');

            if (!modal || !video) return;

            // Reset state
            hidePreview();
            previewCards = [];
            previewImageSrc = '';

            openScannerModal(modal);
            if (status) {
                status.textContent = "正在请求摄像头权限...";
            }
            if (button) {
                button.disabled = true;
            }

            try {
                await attachVideoStream(video, status, button);
            } catch (err) {
                if (status) {
                    status.textContent = "无法调用摄像头，请检查权限或换系统浏览器打开。(" + err.message + ")";
                }
                console.error("Camera Error:", err);
            }
        },

        closeScanner: function () {
            const modal = DOM('scannerModal');
            const video = DOM('scannerVideo');
            if (video) {
                video.pause();
                video.srcObject = null;
            }
            hidePreview();
            closeScannerModal(modal);
            stopVideoStream();
        },

        captureAndScan: async function () {
            const video = DOM('scannerVideo');
            const canvas = DOM('scannerCanvas');
            const status = DOM('scannerStatus');
            const btn = DOM('btnCaptureScan');
            const frame = document.querySelector('.scanner-frame');

            if (!video || !canvas) return;

            btn.disabled = true;
            if (global.app && global.app.vibrate) global.app.vibrate('medium');

            try {
                // Phase 1: Multi-frame sampling (2 frames for balance of speed & accuracy)
                updateProgress(status, 'sampling', 1, 2);
                const frames = await captureMultipleFrames(video, canvas, frame, 2);

                // Save first frame for preview
                const previewImage = frames[0];

                // Phase 2: Send first frame for analysis
                updateProgress(status, 'analyzing');
                const data1 = await requestScan(frames[0], 'default');
                let parsed1 = parseVisionCards(data1.cards || data1.raw || "");

                console.log("[Scanner] Frame 1 →", data1.cards, "| Model:", data1.model, "| Parsed:", parsed1);

                // Phase 3: If incomplete, send second frame with enhanced mode
                let finalCards = parsed1;

                if (shouldRetryEnhanced(data1.raw || data1.cards || "", parsed1, targetTarget)) {
                    updateProgress(status, 'retrying');
                    const data2 = await requestScan(frames[1], 'enhanced');
                    const parsed2 = parseVisionCards(data2.cards || data2.raw || "");

                    console.log("[Scanner] Frame 2 (enhanced) →", data2.cards, "| Model:", data2.model, "| Parsed:", parsed2);

                    // Vote / merge
                    updateProgress(status, 'merging');
                    finalCards = voteCards([parsed1, parsed2]);

                    console.log("[Scanner] Voted result:", finalCards);
                }

                updateProgress(status, 'done');

                if (finalCards.length === 0) {
                    status.textContent = "未能识别出完整牌面。请让牌角标更靠近镜头并避开反光后重试。";
                    btn.disabled = false;
                    return;
                }

                // Phase 4: Show preview for confirmation
                renderPreview(finalCards, previewImage);

            } catch (err) {
                updateProgress(status, 'error');
                status.textContent = "识别失败：" + (err && err.message ? err.message : err);
                console.error("Scan API Error:", err);
                btn.disabled = false;
            }
        },

        confirmPreview: confirmPreview,
        retakePhoto: retakePhoto
    };

    // Export to standalone global namespace
    global.__scannerAPI = api;

})(window);
