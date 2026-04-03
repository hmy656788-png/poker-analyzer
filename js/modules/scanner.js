(function (global) {
    let videoStream = null;
    let targetTarget = 'hand'; // 'hand' or 'community'

    function DOM(id) { return document.getElementById(id); }

    const api = {
        openScanner: async function (target) {
            targetTarget = target;
            const modal = DOM('scannerModal');
            const video = DOM('scannerVideo');
            const status = DOM('scannerStatus');

            if (!modal || !video) return;

            status.textContent = "正在请求摄像头权限...";
            DOM('btnCaptureScan').disabled = true;

            try {
                videoStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });
                video.srcObject = videoStream;
                modal.showModal();

                video.onloadedmetadata = () => {
                    video.play();
                    status.textContent = "请将扑克牌放在框内清晰可见，然后点击拍摄";
                    DOM('btnCaptureScan').disabled = false;
                };

            } catch (err) {
                status.textContent = "无法调用摄像头，请检查权限。(" + err.message + ")";
                console.error("Camera Error:", err);
            }
        },

        closeScanner: function () {
            const modal = DOM('scannerModal');
            if (modal) {
                modal.close();
            }
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
                videoStream = null;
            }
        },

        captureAndScan: async function () {
            const video = DOM('scannerVideo');
            const canvas = DOM('scannerCanvas');
            const status = DOM('scannerStatus');
            const btn = DOM('btnCaptureScan');

            if (!video || !canvas) return;

            btn.disabled = true;
            status.textContent = "正在拍摄并发送识别请求...";
            if (global.app && global.app.vibrate) global.app.vibrate('medium');

            // Set canvas to a resized dimension to reduce payload
            const MAX_WIDTH = 800;
            let width = video.videoWidth;
            let height = video.videoHeight;
            if (width > MAX_WIDTH) {
                height = Math.floor(height * (MAX_WIDTH / width));
                width = MAX_WIDTH;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, width, height);

            const base64Image = canvas.toDataURL('image/jpeg', 0.8);

            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: base64Image })
                });

                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }

                const data = await response.json();
                if (data.error) throw new Error(data.error);

                status.textContent = "识别成功！正在填入槽位...";
                if (global.app && global.app.vibrate) global.app.vibrate('success');

                console.log("[Scanner] RAW Vision Output:", data.raw);

                const parsedCards = parseVisionCards(data.cards || data.raw || "");
                if (parsedCards.length === 0) {
                    status.textContent = "未能在画面中识别到清晰的扑克牌。";
                    btn.disabled = false;
                    return;
                }

                fillCards(parsedCards);

                setTimeout(() => {
                    api.closeScanner();
                }, 1000);

            } catch (err) {
                status.textContent = "识别失败：" + err.message;
                console.error("Scan API Error:", err);
                btn.disabled = false;
            }
        }
    };

    function parseVisionCards(rawText) {
        // Find matches like As, Tc, 10d, 9H, Ah ...
        const regex = /(?:[2-9TJQKA]|10)[shdc]/gi;
        const matches = rawText.match(regex);
        if (!matches) return [];
        
        return matches.map(m => {
            let rank = m.slice(0, -1).toUpperCase();
            let suit = m.slice(-1).toLowerCase();
            // Normalize 10 to T
            if (rank === '10') rank = 'T';
            return rank + suit;
        });
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
