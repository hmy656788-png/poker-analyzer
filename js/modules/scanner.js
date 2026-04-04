(function (global) {
    let videoStream = null;
    let targetTarget = 'hand'; // 'hand' or 'community'

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

    function captureFrameAsJpeg(video, canvas, frame, options) {
        const enhance = !!(options && options.enhance);
        const crop = getFrameCrop(video, frame, enhance ? 0.025 : 0.05);
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;

        const srcX = crop ? crop.x : 0;
        const srcY = crop ? crop.y : 0;
        const srcWidth = crop ? crop.width : sourceWidth;
        const srcHeight = crop ? crop.height : sourceHeight;

        const MAX_WIDTH = enhance ? 960 : 760;
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
        ctx.filter = enhance ? 'contrast(1.18) saturate(1.22) brightness(1.04)' : 'contrast(1.08) saturate(1.08)';
        ctx.drawImage(video, srcX, srcY, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
        ctx.filter = 'none';

        return canvas.toDataURL('image/jpeg', enhance ? 0.84 : 0.76);
    }

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

    async function requestCameraStream() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('当前浏览器不支持摄像头调用');
        }

        try {
            return await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
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
            status.textContent = "请将扑克牌放在框内清晰可见，然后点击拍摄";
        }
        if (button) {
            button.disabled = false;
        }
    }

    const api = {
        openScanner: async function (target) {
            targetTarget = target;
            const modal = DOM('scannerModal');
            const video = DOM('scannerVideo');
            const status = DOM('scannerStatus');
            const button = DOM('btnCaptureScan');

            if (!modal || !video) return;

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
            status.textContent = "正在裁剪牌框并识别牌面...";
            if (global.app && global.app.vibrate) global.app.vibrate('medium');

            try {
                const primaryImage = captureFrameAsJpeg(video, canvas, frame, { enhance: false });
                let data = await requestScan(primaryImage, 'default');
                let parsedCards = parseVisionCards(data.cards || data.raw || "");

                if (shouldRetryForSuit(data.raw || data.cards || "", parsedCards)) {
                    status.textContent = "正在放大角标，二次识别花色...";
                    const enhancedImage = captureFrameAsJpeg(video, canvas, frame, { enhance: true });
                    const retryData = await requestScan(enhancedImage, 'suit-focus');
                    const retryCards = parseVisionCards(retryData.cards || retryData.raw || "");
                    const mergedCards = mergeCardLists(parsedCards, retryCards);
                    if (retryCards.length >= parsedCards.length) {
                        data = retryData;
                    }
                    parsedCards = mergedCards;
                }

                status.textContent = "识别成功，正在填入牌槽...";
                if (global.app && global.app.vibrate) global.app.vibrate('success');

                console.log("[Scanner] RAW Vision Output:", data.raw);

                if (parsedCards.length === 0) {
                    status.textContent = "识别到了点数，但没看清完整花色。请让牌更靠近并避开反光后重试。";
                    btn.disabled = false;
                    return;
                }

                fillCards(parsedCards);

                setTimeout(() => {
                    api.closeScanner();
                }, 1000);

            } catch (err) {
                status.textContent = "识别失败：" + (err && err.message ? err.message : err);
                console.error("Scan API Error:", err);
                btn.disabled = false;
            }
        }
    };

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

    function countRankMentions(rawText) {
        const matches = String(rawText || '').match(/\b(ace|king|queen|jack|ten|10|[2-9]|[akqjt])\b/gi);
        return matches ? matches.length : 0;
    }

    function hasSuitMention(rawText) {
        return /(spades?|hearts?|diamonds?|clubs?|[shdc](?![a-z])|黑桃|红桃|红心|方块|方片|梅花|草花|[♠♥♦♣])/i.test(String(rawText || ''));
    }

    function shouldRetryForSuit(rawText, parsedCards) {
        const text = String(rawText || '').trim();
        if (!text) return false;
        if (parsedCards.length >= 2) return false;
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

    // Export to standalone global namespace (app.js will bridge these into window.app)
    global.__scannerAPI = api;

})(window);
