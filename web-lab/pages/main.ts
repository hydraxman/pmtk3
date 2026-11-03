import './style.css';
import type { ChapterGuide } from './content';
import type { PublicCatalog, PublicDemo, PublicDetail } from './types';

const main = document.querySelector<HTMLElement>('#main')!;
let catalog: PublicCatalog, current = '', query = '', mode = 'all', page = 0, generation = 0;
const pageSize = 24;
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const chapterUrl = (key: string) => `#/chapter/${encodeURIComponent(key)}`;
const demoUrl = (id: string) => `#/demo/${encodeURIComponent(id)}`;
const kindLabel = (entry: PublicDemo) => entry.kind === 'original' ? '原版 · Octave' : entry.kind === 'reproduction' ? '独立复现 · TypeScript' : '辅助函数';
const statusNames: Record<string, string> = { success: '成功', failed: '运行失败', timeout: '超时', blocked: '安全策略阻止', unsupported: '平台不支持', helper: '辅助文件' };
function chapterLabel(key: string) { return catalog.chapters.find(chapter => chapter.key === key)?.title ?? key; }
function humanize(id: string) { return id.replace(/Demo|Fig$/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); }
function tags(entry: PublicDemo) {
  return `<span class="badge ${entry.kind}">${kindLabel(entry)}</span>${entry.chapters.map(key =>
    `<a class="chapter-tag" href="${chapterUrl(key)}">第 ${key} 章 · ${escape(chapterLabel(key))}</a>`).join('')}`;
}
function updateActive(key: string) {
  document.querySelectorAll('#chapter-nav a').forEach(link => {
    if (link.getAttribute('href') === (key ? chapterUrl(key) : '#/')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
function cover(entry: PublicDemo) {
  return entry.thumbnail ? `<img src="${entry.thumbnail.url}" alt="${escape(entry.thumbnail.title)}" loading="lazy" decoding="async">` :
    `<div class="no-image"><span>∑</span><strong>${entry.runnable ? '计算结果 · 非图形例子' : '辅助函数'}</strong><small>不以图片数量判断运行成功</small></div>`;
}
function card(entry: PublicDemo) {
  return `<article class="demo-card"><a class="card-image" href="${demoUrl(entry.id)}" aria-label="打开 ${escape(entry.id)}">${cover(entry)}
    <span class="image-count">${entry.imageCount ? `${entry.imageCount} 张图` : '代码与说明'}</span></a>
    <div class="card-body"><span class="badge ${entry.kind}">${kindLabel(entry)}</span><h3><a href="${demoUrl(entry.id)}">${escape(entry.kind === 'reproduction' ? entry.title : humanize(entry.id))}</a></h3>
    <code>${escape(entry.id)}</code><p>${escape(entry.description || (entry.chapters.length ? chapterLabel(entry.chapters[0]) : '计算过程与可视化实验'))}</p>
    <div class="card-bottom"><span>${entry.chapters.length ? `CH ${entry.chapters.join(' · ')}` : '未确认章节归属'}</span><a href="${demoUrl(entry.id)}" aria-label="查看 ${escape(entry.id)}">查看实验 ↗</a></div></div></article>`;
}
function guideMarkup(guide: ChapterGuide, recommended = false) {
  return `<section class="math-guide"><div class="guide-intro"><p class="eyebrow">${recommended ? 'EDITORIAL STUDY CONNECTION · 编辑推荐主题' : 'A SMALL MATHEMATICAL NOTE · 数学速记'}</p><h2>${escape(guide.title)}</h2><p>${escape(guide.summary)}</p></div>
    <div class="formula-box"><span>核心关系 · 非每个例子的完整推导</span><div class="formula" role="math" aria-label="${escape(guide.formula)}">${escape(guide.formula)}</div><p>${escape(guide.symbols)}</p></div>
    <div class="read-chart"><h3>怎样读这些图？</h3><p>${escape(guide.intuition)}</p><ul>${guide.lookFor.map(note => `<li>${escape(note)}</li>`).join('')}</ul><small>预备知识：${escape(guide.prerequisites)}</small></div></section>`;
}
function hero(key: string) {
  const guide = catalog.chapters.find(chapter => chapter.key === key);
  if (guide) return `<header class="chapter-hero"><p class="eyebrow">CHAPTER ${String(guide.number).padStart(2, '0')} / ${escape(guide.english)}</p>
    <h1>${escape(guide.title)}<span>。</span></h1><p>${escape(guide.subtitle)}</p><div class="hero-meta">${guide.count} 个官方映射案例 <span>·</span> 原创中文导读 <span>·</span> 实际计算输出</div></header>${guideMarkup(guide)}`;
  if (key === 'unmapped') return `<header class="chapter-hero"><p class="eyebrow">BEYOND THE PUBLISHED CHAPTER MAP</p><h1>其他实验<span>，</span><br>不强行归类。</h1><p>${catalog.stats.unmapped} 份源文件没有已确认的官方章节映射。详情中的学习主题仅为编辑建议，不冒充书中章节归属。</p></header>`;
  const spotlight = catalog.entries.find(entry => entry.id === 'mixGaussVbDemoFaithful' && entry.thumbnail) ?? catalog.entries.find(entry => entry.thumbnail)!;
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow">A VISUAL COMPANION TO PROBABILISTIC LEARNING</p><h1>把抽象的概率，<br>变成<span>看得见的理解。</span></h1>
    <p>从一枚硬币到隐变量模型。沿着章节读一点数学，<br class="desktop-break">再走进真正计算出来的图。</p><div class="hero-actions"><a class="button primary" href="#/chapter/2">从概率开始 <span>↗</span></a><a class="button light" href="#experiments" id="explore">浏览全部实验 ↓</a></div>
    <div class="hero-note"><span class="dot"></span>无需安装 · 无需登录 · 所有图片静态可访问</div></div>
    <a class="hero-visual" href="${demoUrl(spotlight.id)}"><div class="visual-top"><span>FIGURE / ${escape(spotlight.id)}</span><span>● VERIFIED OUTPUT ARCHIVE</span></div>${cover(spotlight)}<div class="visual-caption"><span>混合模型 · 用潜在结构理解数据</span><span>打开实验 ↗</span></div></a></section>
    <section class="stats" aria-label="图谱统计">${[
      [catalog.stats.runnable, '独立案例', '511 个原版 + 52 个独立复现'],
      [catalog.stats.chapterCount, '章节', '只采用已确认的官方关联'],
      [catalog.stats.uniqueImages.toLocaleString(), '张计算图', '按内容去重 · 非书页截图'],
      [catalog.stats.mapped, '书中映射案例', '其余源文件保留独立分区'],
    ].map(([number, title, note]) => `<div><strong>${number}</strong><span>${title}</span><small>${note}</small></div>`).join('')}</section>
    <section class="learning-path"><div><p class="eyebrow">A SUGGESTED PATH</p><h2>循序渐进，也可以自由探索。</h2></div><div class="path-links">${['2', '5', '7', '11', '17', '28'].map((item, i) =>
      `<a href="${chapterUrl(item)}"><span>${String(i + 1).padStart(2, '0')}</span><strong>${escape(chapterLabel(item))}</strong><small>CH ${item} ↗</small></a>`).join('')}</div></section>`;
}
function filtered() {
  const search = query.trim().toLocaleLowerCase();
  return catalog.entries.filter(entry => (current === 'unmapped' ? !entry.chapters.length : !current || entry.chapters.includes(current)) &&
    (mode === 'all' ? entry.runnable : mode === 'helper' ? !entry.runnable : entry.kind === mode) &&
    (!search || `${entry.id} ${entry.title} ${entry.description} ${entry.chapters.map(chapterLabel).join(' ')} ${catalog.guides.find(guide => guide.key === entry.guide)?.title}`.toLocaleLowerCase().includes(search)));
}
function renderCards() {
  const items = filtered(), pages = Math.max(1, Math.ceil(items.length / pageSize));
  page = Math.min(page, pages - 1);
  document.querySelector('#result-count')!.textContent = `${items.length} 个案例`;
  document.querySelector('#cards')!.innerHTML = items.length ? items.slice(page * pageSize, (page + 1) * pageSize).map(card).join('') :
    '<div class="empty"><h3>暂时没有匹配的实验</h3><p>换个关键词或切换内容类型，再试一次。</p><button id="reset" class="button light">清除筛选</button></div>';
  document.querySelector('#pagination')!.innerHTML = pages > 1 ? `<button class="button light" id="previous" ${page === 0 ? 'disabled' : ''}>← 上一页</button><span>第 ${page + 1} / ${pages} 页</span><button class="button light" id="next" ${page === pages - 1 ? 'disabled' : ''}>下一页 →</button>` : '';
  document.querySelector('#previous')?.addEventListener('click', () => { page--; renderCards(); document.querySelector('#experiments')?.scrollIntoView(); });
  document.querySelector('#next')?.addEventListener('click', () => { page++; renderCards(); document.querySelector('#experiments')?.scrollIntoView(); });
  document.querySelector('#reset')?.addEventListener('click', () => { query = ''; mode = 'all'; renderCatalog(); });
}
function renderCatalog() {
  main.innerHTML = `${hero(current)}<section id="experiments" class="experiments"><div class="section-title"><div><p class="eyebrow">THE EXPERIMENT COLLECTION</p><h2>${current ? '本分区实验' : '进入一个例子，看清一种思想。'}</h2></div><span id="result-count" aria-live="polite"></span></div>
    <div class="filters"><label class="search"><span>⌕</span><input type="search" id="search" aria-label="搜索实验" placeholder="搜索模型、方法或案例名称…" value="${escape(query)}"><kbd>/</kbd></label>
    <label class="type-filter">内容<select id="mode" aria-label="筛选内容类型"><option value="all">所有独立案例</option><option value="original">原版成功运行</option><option value="reproduction">独立可视化复现</option><option value="helper">辅助文件</option></select></label></div>
    <p class="collection-note">原版运行与替代复现分开标注。数学速记提供阅读背景，不声称每幅图都验证了整章理论。</p>
    <div class="cards" id="cards"></div><nav id="pagination" class="pagination" aria-label="实验列表翻页"></nav></section>`;
  (document.querySelector('#mode') as HTMLSelectElement).value = mode;
  document.querySelector('#search')!.addEventListener('input', event => { query = (event.target as HTMLInputElement).value; page = 0; renderCards(); });
  document.querySelector('#mode')!.addEventListener('change', event => { mode = (event.target as HTMLSelectElement).value; page = 0; renderCards(); });
  document.querySelector('#explore')?.addEventListener('click', event => { event.preventDefault(); document.querySelector('#experiments')?.scrollIntoView({ behavior: 'smooth' }); });
  renderCards();
}
async function renderDetail(id: string, token: number) {
  const summary = catalog.entries.find(entry => entry.id === id);
  if (!summary) throw new Error('没有找到这个案例。');
  main.innerHTML = '<p class="loading" role="status">正在打开实验与计算图…</p>';
  const response = await fetch(summary.detail);
  if (!response.ok) throw new Error(`案例数据读取失败（${response.status}）。`);
  const detail: PublicDetail = await response.json();
  if (token !== generation) return;
  const guide = catalog.guides.find(item => item.key === detail.guide)!;
  const sourceUrl = `${catalog.repository}/blob/${catalog.sourceCommit}/${detail.source.split('/').map(encodeURIComponent).join('/')}`;
  const back = detail.chapters.length ? chapterUrl(detail.chapters[0]) : chapterUrl('unmapped');
  document.title = `${detail.id} · PMTK 概率学习图谱`;
  main.innerHTML = `<a class="back-link" href="${back}">← ${detail.chapters.length ? `第 ${detail.chapters[0]} 章` : '其他实验'}</a>
    <header class="detail-hero"><div class="tag-row">${tags(detail)}</div><h1>${escape(detail.kind === 'original' ? humanize(detail.id) : detail.title)}</h1>
    <code>${escape(detail.id)}</code><p>${escape(detail.description)}</p><a class="source-link" href="${sourceUrl}" target="_blank" rel="noreferrer">查看对应源码 ↗</a></header>
    ${detail.chapters.length ? '' : '<p class="notice">这个案例没有已确认的官方章节归属。以下数学主题为编辑推荐，便于学习，不代表书籍中的位置。</p>'}
    ${guideMarkup(guide, !detail.chapters.length)}
    ${detail.reproduction ? `<section class="repro-notes"><div><p class="eyebrow">REPRODUCTION, NOT A RELABELLED ORIGINAL</p><h2>这个例子，现在怎样跑？</h2><p><strong>实际方法：</strong>${escape(detail.reproduction.method)}</p><p>原 MATLAB / Octave 状态：${escape(statusNames[detail.status] ?? detail.status)}。以下图片来自独立 TypeScript 实现，种子 ${detail.reproduction.seed}，不是原程序成功运行的证明。</p></div>
      <details open><summary>与原案例的差异 · 数据、方法及实验规模</summary><ul>${detail.reproduction.differences.map(note => `<li>${escape(note)}</li>`).join('')}</ul></details>
      <div class="metrics">${Object.entries(detail.reproduction.metrics).map(([key, value]) =>
        `<div><span>${escape(key)}</span><strong>${escape(typeof value === 'number' ? Number(value.toPrecision(6)) : value)}</strong></div>`).join('')}</div>
      <details><summary>${detail.reproduction.checks.length} 项数值检查通过 · 查看范围</summary><ul>${detail.reproduction.checks.map(check => `<li>${escape(check.name)}${check.detail ? ` — ${escape(check.detail)}` : ''}</li>`).join('')}</ul></details></section>` :
      `<p class="provenance">${detail.kind === 'original' ? `来自原版代码的实际 Octave 输出 · ${detail.attempt?.seconds?.toFixed(2) ?? '—'} 秒 · ${escape(detail.attempt?.finishedAt.slice(0, 10) ?? '')}。运行成功不等于所有数值结论已被独立证明。` : '这是配套辅助函数，不是一个需要单独执行的完整演示。'}</p>`}
    <section class="figures-section"><div class="section-title"><div><p class="eyebrow">OBSERVE THE RESULT</p><h2>把公式放回图里。</h2></div><span>${detail.images.length} 张去重计算图</span></div>
      <p class="collection-note">点击任一图片打开原始分辨率。页面只读取静态文件，不在访问者设备上运行原始脚本。</p>
      <div id="figures" class="figure-grid"></div><button id="more-images" class="button light">继续查看图片</button>
      ${detail.images.length ? '' : '<div class="empty"><span class="empty-symbol">∑</span><h3>这个案例没有生成图形</h3><p>非图形例子可能输出数值、检查或结构。这里保留真实状态，不补造“成功图片”。请通过源码了解计算内容。</p></div>'}</section>
      <details class="evidence"><summary>可追溯来源</summary><p>源代码提交：<a href="${catalog.repository}/commit/${catalog.sourceCommit}">${catalog.sourceCommit.slice(0, 12)}</a></p><p>源文件 SHA-256：<code>${detail.sourceSha256}</code></p><p>本例公开元数据：<a href="${detail.detail}" target="_blank" rel="noreferrer">JSON ↗</a></p></details>`;
  let shown = 0;
  const appendImages = () => {
    const next = detail.images.slice(shown, shown + 12);
    document.querySelector('#figures')!.insertAdjacentHTML('beforeend', next.map((image, index) => `<figure>
      <a href="${image.url}" target="_blank" rel="noreferrer"><img src="${image.url}" loading="lazy" decoding="async" alt="${escape(image.title)}"></a>
      <figcaption><span>FIG ${String(shown + index + 1).padStart(2, '0')}</span><strong>${escape(image.title)}</strong><small>${image.kind === 'original' ? '原版实际输出' : '独立复现计算图'} · 打开大图 ↗</small></figcaption></figure>`).join(''));
    shown += next.length;
    (document.querySelector('#more-images') as HTMLButtonElement).hidden = shown >= detail.images.length;
  };
  appendImages();
  document.querySelector('#more-images')!.addEventListener('click', appendImages);
}
function renderAbout() {
  main.innerHTML = `<header class="chapter-hero"><p class="eyebrow">OPEN EXPERIMENTS. HONEST PROVENANCE.</p><h1>美观之外，<br>也要<span>说清来处。</span></h1><p>本图谱是《Machine Learning: A Probabilistic Perspective》配套 PMTK3 工程的独立学习入口，不是该书的电子版。</p></header>
    <section class="about-grid"><article><h2>章节怎么组织？</h2><p>${catalog.stats.mapped} 个案例的章节关系来自原项目 docs/demoOutput/bookDemos 目录，共 ${catalog.stats.chapterCount} 组。原发布目录没有第 9、20、22 章的分区；本站不据此推断这些章节在书中不存在。</p><p>另外 ${catalog.stats.unmapped} 份源文件放入“未确认章节归属”。其中的学习主题是编辑建议，与官方映射明确分开。</p></article>
    <article><h2>数学说明是什么？</h2><p>这里的中文摘要、核心公式解释、读图问题与预备知识均为独立编写的学习笔记。公式只提供代表性背景，不替代完整推导，不复制或翻译书中段落、页图或章节正文。</p><p><a href="https://probml.github.io/pml-book/book0.html" target="_blank" rel="noreferrer">作者的书籍信息与正式阅读入口 ↗</a></p></article>
    <article><h2>哪些图是真的运行结果？</h2><p>${catalog.stats.originalSuccesses} 个案例来自源哈希匹配的成功 Octave 运行；${catalog.stats.reproductions} 个案例使用独立 TypeScript 实现，逐项披露合成数据、缩小规模或方法变化。相同图片按 SHA-256 去重。</p><p>不使用历史参考图冒充当前输出。非图形例子照实显示；旧框架失败和超时状态不会被改成成功。</p></article>
    <article><h2>许可与致谢</h2><p>原 PMTK3 由 Kevin Murphy、Matt Dunham 及其他贡献者编写，采用 <a href="./license.txt">MIT 许可</a>。依赖保留各自许可，不把所有上游组件重新授权。本站仅发布计算图与精简公开元数据，不分发原始数据集或原生运行库。</p><p><a href="https://github.com/probml/pmtk3" target="_blank" rel="noreferrer">官方项目 ↗</a> · <a href="${catalog.repository}" target="_blank" rel="noreferrer">本 fork 与复现源码 ↗</a></p></article></section>
    <section class="publication-note"><h2>这一版图谱</h2><p>生成时间：${escape(catalog.generatedAt)}<br>源代码提交：<a href="${catalog.repository}/commit/${catalog.sourceCommit}">${catalog.sourceCommit.slice(0, 12)}</a><br>${catalog.stats.sources} 份源文件 · ${catalog.stats.runnable} 个独立案例 · ${catalog.stats.uniqueImages} 张去重计算图</p><a href="./publication.json" target="_blank" rel="noreferrer">公开发布清单 ↗</a><p>GitHub Pages 是只读静态站。要调整种子、重跑原程序或继续开发，请克隆仓库并使用本地实验室。</p></section>`;
}
async function route() {
  const token = ++generation;
  const [kind, encoded] = location.hash.replace(/^#\/?/, '').split('/');
  query = ''; mode = 'all'; page = 0;
  document.querySelector('#chapter-nav')!.classList.remove('open');
  document.querySelector('#menu-toggle')!.setAttribute('aria-expanded', 'false');
  document.title = 'PMTK · 概率学习图谱';
  try {
    const id = encoded ? decodeURIComponent(encoded) : '';
    if (kind === 'demo') { current = ''; updateActive(''); await renderDetail(id, token); }
    else if (kind === 'about') { updateActive(''); renderAbout(); }
    else {
      if (kind && kind !== 'chapter') throw new Error('没有找到这个页面。');
      current = kind === 'chapter' ? id : '';
      if (current && current !== 'unmapped' && !catalog.chapters.some(chapter => chapter.key === current)) throw new Error('没有找到这个章节。');
      updateActive(current); renderCatalog();
    }
  } catch (error) {
    if (token === generation) main.innerHTML = `<div class="empty" role="alert"><h1>暂时无法展开这一页</h1><p>${escape(error instanceof Error ? error.message : '读取失败')}</p><a class="button primary" href="#/">回到图谱</a></div>`;
  }
  if (token === generation) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}
async function start() {
  const response = await fetch('./catalog.json');
  if (!response.ok) throw new Error(`图谱索引读取失败（${response.status}）。请刷新页面重试。`);
  catalog = await response.json();
  if (catalog.schema !== 1 || !Array.isArray(catalog.entries)) throw new Error('图谱数据版本不兼容。');
  document.querySelector('#total-badge')!.textContent = String(catalog.stats.runnable);
  document.querySelector('#chapters')!.innerHTML = catalog.chapters.map(chapter =>
    `<a href="${chapterUrl(chapter.key)}"><span class="chapter-number">${String(chapter.number).padStart(2, '0')}</span><span>${escape(chapter.title)}</span><small>${chapter.count}</small></a>`).join('');
  window.addEventListener('hashchange', () => void route());
  await route();
}
document.querySelector('#menu-toggle')!.addEventListener('click', () => {
  const open = document.querySelector('#chapter-nav')!.classList.toggle('open');
  document.querySelector('#menu-toggle')!.setAttribute('aria-expanded', String(open));
});
document.querySelector('.skip')!.addEventListener('click', event => {
  event.preventDefault(); main.focus(); main.scrollIntoView();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
    const input = document.querySelector<HTMLInputElement>('#search');
    if (input) { event.preventDefault(); input.focus(); }
  }
});
void start().catch((error: unknown) => {
  main.innerHTML = `<div class="empty" role="alert"><h1>图谱未能加载</h1><p>${escape(error instanceof Error ? error.message : '请稍后重试')}</p><button class="button primary" id="reload">重新加载</button></div>`;
  document.querySelector('#reload')!.addEventListener('click', () => location.reload());
});
