const esbuild = require('esbuild');
const fs = require('fs');

if (!fs.existsSync('dist/js')) fs.mkdirSync('dist/js', { recursive: true });
if (!fs.existsSync('dist/css')) fs.mkdirSync('dist/css', { recursive: true });

async function build() {
    console.log('🚀 开始打包 JS 和 CSS...');

    // 1. poker.js 和 simulator.js 不需要 bundle（没有 import），
    //    只做 minify，保留顶层变量为全局可见
    await esbuild.build({
        entryPoints: ['js/poker.js', 'js/simulator.js'],
        bundle: false,
        minify: true,
        outdir: 'dist/js',
    }).catch((e) => {
        console.error('poker/simulator build failed', e);
        process.exit(1);
    });

    // 2. app.js 需要 bundle（有 import 语句），用 IIFE 格式，
    //    并在末尾暴露 window.app 供 HTML onclick 调用
    await esbuild.build({
        entryPoints: ['js/app.js'],
        bundle: true,
        minify: true,
        outdir: 'dist/js',
        format: 'iife',
    }).catch((e) => {
        console.error('app.js build failed', e);
        process.exit(1);
    });

    // 3. worker.js 独立运行在 Worker 上下文，IIFE 无影响
    await esbuild.build({
        entryPoints: ['js/worker.js'],
        bundle: false,
        minify: true,
        outdir: 'dist/js',
    }).catch((e) => {
        console.error('worker.js build failed', e);
        process.exit(1);
    });

    // 4. CSS 构建
    await esbuild.build({
        entryPoints: ['css/style.css'],
        bundle: true,
        minify: true,
        outdir: 'dist/css'
    }).catch((e) => {
        console.error('CSS build failed', e);
        process.exit(1);
    });

    console.log('⚡ 打包压缩完成！核心文件已输出到 dist/ 目录下');
}

build();
