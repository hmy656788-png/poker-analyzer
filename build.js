const esbuild = require('esbuild');
const fs = require('fs');

if (!fs.existsSync('dist/js')) fs.mkdirSync('dist/js', { recursive: true });
if (!fs.existsSync('dist/css')) fs.mkdirSync('dist/css', { recursive: true });

async function build() {
    console.log('🚀 开始打包 JS 和 CSS...');
    
    // JavaScript 构建 (由于涉及到 Worker 还有多个独立入口，所以将其全数保留为入口点)
    await esbuild.build({
        entryPoints: ['js/app.js', 'js/poker.js', 'js/simulator.js', 'js/worker.js'],
        bundle: true,
        minify: true,
        outdir: 'dist/js',
        format: 'iife'
    }).catch((e) => {
        console.error('JS build failed', e);
        process.exit(1);
    });

    // CSS 构建
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
