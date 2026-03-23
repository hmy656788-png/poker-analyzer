const sharp = require('sharp');
const fs = require('fs');

if (!fs.existsSync('assets')) {
    fs.mkdirSync('assets');
}

const svgCode = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="112" fill="#0a0e17"/>
    <text x="50%" y="55%" font-family="-apple-system, sans-serif" font-size="320" font-weight="bold" fill="#ffcc00" text-anchor="middle" dominant-baseline="middle">♠</text>
</svg>
`;

const svgBuffer = Buffer.from(svgCode);

Promise.all([
    sharp(svgBuffer).resize(192, 192).png().toFile('assets/icon-192.png'),
    sharp(svgBuffer).resize(512, 512).png().toFile('assets/icon-512.png')
]).then(() => {
    console.log('✅ 成功生成 192x192 和 512x512 尺寸的 PWA 图标到 assets/ 目录！');
}).catch(err => {
    console.error('❌ 图标生成失败:', err);
});
