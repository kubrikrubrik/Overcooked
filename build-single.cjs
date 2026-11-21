// Собирает игру в ОДИН файл index.html в этой же папке (из dev.html + main.ts и остальных .ts).
// index.html открывается двойным щелчком без сервера и сразу годится для GitHub Pages.
// Запуск: npm run build
const fs = require('fs');
const path = require('path');
const esbuild = require(process.env.ESBUILD_PATH || 'esbuild');

const dir = __dirname;

esbuild
  .build({
    entryPoints: [path.join(dir, 'main.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020', 'safari15'],
    outdir: path.join(dir, '.build-tmp'),
    write: false,
    logLevel: 'warning',
    legalComments: 'none',
  })
  .then((res) => {
    const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
    const cssFile = res.outputFiles.find((f) => f.path.endsWith('.css'));
    const css = cssFile ? cssFile.text : '';
    let html = fs.readFileSync(path.join(dir, 'dev.html'), 'utf8');
    const tag = '<script type="module" src="./main.ts"></script>';
    if (!html.includes(tag)) throw new Error('В dev.html не найден тег ' + tag);
    html = html.replace(tag, () => `<style>${css}</style>\n<script>${js}</script>`);
    const out = path.join(dir, 'index.html');
    fs.writeFileSync(out, html);
    console.log(`OK index.html — ${(html.length / 1024).toFixed(0)} KB`);
  })
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
