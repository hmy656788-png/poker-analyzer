// js/modules/install-guide.js

function setupInstallGuide({ state, getEl }) {
    const INSTALL_GUIDE_DISMISS_KEY = 'poker.installGuideDismissAt';
    const INSTALL_GUIDE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

    function getDismissedInstallAt() {
        try {
            return Number(localStorage.getItem(INSTALL_GUIDE_DISMISS_KEY) || 0);
        } catch (error) {
            return 0;
        }
    }

    function setDismissedInstallAt(timestamp) {
        try {
            localStorage.setItem(INSTALL_GUIDE_DISMISS_KEY, String(timestamp));
        } catch (error) {
            // ignore write failures
        }
    }

    function isStandaloneMode() {
        return !!(
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            (window.navigator && window.navigator.standalone)
        );
    }

    function getInstallGuideMode() {
        if (!state.isMobileDevice || isStandaloneMode()) return 'none';
        if (state.deferredInstallPrompt) return 'native';
        if (state.isIOSDevice && state.isIOSSafari) return 'ios_safari';
        if (state.isIOSDevice) return 'ios_other';
        return 'none';
    }

    function shouldBlockInstallGuide() {
        if (isStandaloneMode()) return true;
        const dismissedAt = getDismissedInstallAt();
        return dismissedAt > 0 && (Date.now() - dismissedAt) < INSTALL_GUIDE_COOLDOWN_MS;
    }

    function setInstallGuideSteps(stepItems) {
        const stepList = getEl('installGuideSteps');
        if (!stepList) return;

        if (!stepItems || stepItems.length === 0) {
            stepList.hidden = true;
            stepList.innerHTML = '';
            return;
        }

        stepList.innerHTML = stepItems.map((item) => `<li>${item}</li>`).join('');
        stepList.hidden = false;
    }

    function setInstallGuideHint(text) {
        const hint = getEl('installGuideHint');
        if (!hint) return;

        if (!text) {
            hint.hidden = true;
            hint.textContent = '';
            return;
        }

        hint.textContent = text;
        hint.hidden = false;
    }

    function updateInstallGuideContent(mode) {
        const title = getEl('installGuideTitle');
        const description = getEl('installGuideDesc');
        const primaryButton = getEl('installGuidePrimary');
        if (!title || !description || !primaryButton) return;

        if (mode === 'native') {
            title.textContent = '添加到主屏幕';
            description.textContent = '支持一键安装，完成后可像原生 App 一样从桌面秒开。';
            primaryButton.textContent = '一键添加';
            setInstallGuideSteps([]);
            setInstallGuideHint('');
            return;
        }

        if (mode === 'ios_safari') {
            title.textContent = '添加到主屏幕（Safari）';
            description.textContent = 'iPhone 需要手动添加，按下面 3 步即可完成。';
            primaryButton.textContent = '我知道了';
            setInstallGuideSteps([
                '点击底部工具栏的“分享”按钮',
                '在菜单中选择“添加到主屏幕”',
                '点右上角“添加”，返回桌面即可打开',
            ]);
            setInstallGuideHint('提示：如果看不到“分享”按钮，请先向下轻滑让工具栏出现。');
            return;
        }

        title.textContent = '请切换 Safari 安装';
        description.textContent = '你当前不在 Safari，iOS 仅支持在 Safari 中添加到主屏幕。';
        primaryButton.textContent = '复制链接';
        setInstallGuideSteps([
            '点击“复制链接”',
            '打开 Safari 并粘贴访问当前页面',
            '在 Safari 里点击“分享”→“添加到主屏幕”',
        ]);
        setInstallGuideHint('复制后可直接粘贴到 Safari 地址栏。');
    }

    async function copyTextToClipboard(text) {
        if (!text) return false;
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // fallback below
            }
        }

        try {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', 'readonly');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            const success = document.execCommand('copy');
            document.body.removeChild(input);
            return success;
        } catch (error) {
            return false;
        }
    }

    function updateInstallEntry() {
        const mode = getInstallGuideMode();
        const guide = getEl('installGuide');
        const fab = getEl('installFab');

        if (mode === 'none' && guide) {
            guide.hidden = true;
        }

        if (mode !== 'none') {
            updateInstallGuideContent(mode);
        }

        if (!fab) return;
        const isGuideVisible = !!(guide && !guide.hidden);
        fab.hidden = mode === 'none' || isGuideVisible;
        if (mode === 'native') {
            fab.textContent = '一键添加到桌面';
        } else if (mode === 'ios_other') {
            fab.textContent = '部署到桌面';
        } else {
            fab.textContent = '查看安装步骤';
        }
    }

    function showInstallGuide(force = false) {
        if (!force && shouldBlockInstallGuide()) return;
        if (getInstallGuideMode() === 'none') return;

        const guide = getEl('installGuide');
        if (!guide) return;

        updateInstallGuideContent(getInstallGuideMode());
        guide.hidden = false;
        updateInstallEntry();
    }

    function hideInstallGuide() {
        const guide = getEl('installGuide');
        if (!guide) return;
        guide.hidden = true;
        updateInstallEntry();
    }

    function dismissInstallGuide() {
        setDismissedInstallAt(Date.now());
        hideInstallGuide();
    }

    async function installApp() {
        const promptEvent = state.deferredInstallPrompt;
        if (!promptEvent) {
            showInstallGuide(true);
            return;
        }

        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            state.deferredInstallPrompt = null;
            if (choice && choice.outcome === 'accepted') {
                hideInstallGuide();
            } else {
                dismissInstallGuide();
            }
        } catch (error) {
            dismissInstallGuide();
        }
    }

    async function handleInstallPrimaryAction() {
        const mode = getInstallGuideMode();

        if (mode === 'native') {
            await installApp();
            return;
        }

        if (mode === 'ios_other') {
            const copied = await copyTextToClipboard(window.location.href);
            if (copied) {
                setInstallGuideHint('链接已复制，请切换到 Safari 粘贴打开后安装。');
            } else {
                setInstallGuideHint('复制失败，请手动复制当前网址并在 Safari 中打开。');
            }
            return;
        }

        dismissInstallGuide();
    }

    async function quickInstall() {
        if (state.deferredInstallPrompt) {
            await installApp();
            return;
        }
        showInstallGuide(true);
    }

    function initInstallGuide() {
        updateInstallEntry();

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            state.deferredInstallPrompt = event;
            updateInstallEntry();
            showInstallGuide();
        });

        window.addEventListener('appinstalled', () => {
            state.deferredInstallPrompt = null;
            hideInstallGuide();
            updateInstallEntry();
        });

        window.addEventListener('pageshow', () => {
            updateInstallEntry();
        });
    }

    return {
        initInstallGuide,
        quickInstall,
        installApp,
        handleInstallPrimaryAction,
        dismissInstallGuide,
    };
}
