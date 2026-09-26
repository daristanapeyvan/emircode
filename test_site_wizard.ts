/**
 * test_site_wizard.ts
 * The "Website Oluştur" wizard: Markdown -> HTML for the user's texts, the smart text box's edit
 * operations, file names / anchors, topic defaults, the request compiler and the wizard store.
 *
 * Run: node scripts/run-ts-test.mjs test_site_wizard.ts
 */
import { markdownToHtml, inlineMarkdown, markdownTextLength } from './src/lib/wizard/markdown';
import { toggleWrap, toggleLinePrefix, insertLink, continueList } from './src/lib/wizard/markdownEdit';
import {
  compileSitePrompt,
  createWizardData,
  defaultPages,
  pageFiles,
  sectionAnchors,
  resolveCategory,
  slugify,
  newSection,
  SiteWizardData,
} from './src/lib/wizard/siteWizard';
import { useSiteWizardStore, PAGE_TEMPLATES } from './src/stores/siteWizardStore';
import { decomposeGoalIntoSubtasks } from './src/lib/agent/AgentEngine';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

function cafe(over: Partial<SiteWizardData> = {}): SiteWizardData {
  const data = createWizardData('simple');
  return {
    ...data,
    siteName: 'Kahve Durağı',
    siteType: 'Kafe',
    description: 'Kadıköy’de taze kavrulmuş kahve ve ev yapımı tatlılar sunan samimi bir kafe.',
    pages: defaultPages('yemek', false, 'tr'),
    ...over,
  };
}

async function run() {
  // =====================================================================
  section('1. The user’s texts become ready HTML');
  // =====================================================================
  check(markdownToHtml('Merhaba **dünya**, *hoş* geldin.') === '<p>Merhaba <strong>dünya</strong>, <em>hoş</em> geldin.</p>', 'Bold and italic');
  check(markdownToHtml('- Espresso\n- Latte') === '<ul><li>Espresso</li><li>Latte</li></ul>', 'Bullet list');
  check(markdownToHtml('1. Kavur\n2. Öğüt\n3) Demle') === '<ol><li>Kavur</li><li>Öğüt</li><li>Demle</li></ol>', 'Numbered list');
  check(markdownToHtml('## Hikâyemiz\nİlk satır\nikinci satır\n\nYeni paragraf') === '<h3>Hikâyemiz</h3>\n<p>İlk satır<br>ikinci satır</p>\n<p>Yeni paragraf</p>', 'Heading, line breaks, paragraphs');
  check(markdownToHtml('> Harika bir yer!\n> — Ayşe') === '<blockquote><p>Harika bir yer!<br>— Ayşe</p></blockquote>', 'Quote');
  check(inlineMarkdown('[Menü](menu.html) ve [site](https://ornek.com) ve [kötü](javascript:alert(1))') === '<a href="menu.html">Menü</a> ve <a href="https://ornek.com">site</a> ve kötü', 'Safe links kept, script links dropped');
  check(markdownToHtml('<script>x</script> & "tırnak"') === '<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;tırnak&quot;</p>', 'HTML in the text is escaped');
  check(markdownToHtml('3*4*5 ve snake_case_name') === '<p>3*4*5 ve snake_case_name</p>', 'No false emphasis inside words / numbers');
  check(markdownTextLength('**Kalın** metin') === 11, 'Text length ignores formatting');

  // =====================================================================
  section('2. Smart text box operations');
  // =====================================================================
  let r = toggleWrap('merhaba dünya', 8, 13, '**', 'kalın');
  check(r.text === 'merhaba **dünya**' && r.selStart === 10 && r.selEnd === 15, 'Bold wraps the selection', r);
  r = toggleWrap(r.text, r.selStart, r.selEnd, '**', 'kalın');
  check(r.text === 'merhaba dünya' && r.selStart === 8 && r.selEnd === 13, 'Bold again unwraps', r);
  r = toggleWrap('abc', 3, 3, '*', 'italik');
  check(r.text === 'abc*italik*' && r.text.slice(r.selStart, r.selEnd) === 'italik', 'No selection inserts a selected placeholder', r);
  r = toggleWrap('kalın metin', 0, 6, '**', 'x');
  check(r.text === '**kalın** metin', 'Trailing space stays outside the markers', r);
  r = toggleLinePrefix('Espresso\nLatte', 0, 14, 'bullet');
  check(r.text === '- Espresso\n- Latte', 'Bullets on every selected line', r);
  r = toggleLinePrefix(r.text, 0, r.text.length, 'bullet');
  check(r.text === 'Espresso\nLatte', 'Bullets toggle off', r);
  r = toggleLinePrefix('- a\n- b', 0, 7, 'numbered');
  check(r.text === '1. a\n2. b', 'Bullets become numbers (counted)', r);
  r = toggleLinePrefix('Başlık', 3, 3, 'heading');
  check(r.text === '## Başlık' && r.selStart === 6, 'Heading on the caret line keeps the caret', r);
  r = insertLink('Menüye git', 0, 10, 'bağlantı');
  check(r.text === '[Menüye git](https://)' && r.text.slice(r.selStart, r.selEnd) === 'https://', 'Link with the URL selected', r);
  const c1 = continueList('- Espresso', 10);
  check(!!c1 && c1.text === '- Espresso\n- ' && c1.selStart === 13, 'Enter continues a bullet list', c1);
  const c2 = continueList('1. Kavur', 8);
  check(!!c2 && c2.text === '1. Kavur\n2. ', 'Enter continues a numbered list', c2);
  const c3 = continueList('- a\n- ', 6);
  check(!!c3 && c3.text === '- a\n' && c3.selStart === 4, 'Enter on an empty item ends the list', c3);
  check(continueList('düz metin', 9) === null, 'Plain text: normal Enter');

  // =====================================================================
  section('3. Files, anchors and topic defaults');
  // =====================================================================
  check(slugify('Hakkımızda & İletişim Çağrısı') === 'hakkimizda-iletisim-cagrisi', 'Turkish slug');
  const pages = [
    { id: '1', name: 'Ana Sayfa', sections: [] },
    { id: '2', name: 'Hakkımızda', sections: [] },
    { id: '3', name: 'Hakkımızda', sections: [] },
    { id: '4', name: '', sections: [] },
  ];
  check(JSON.stringify(pageFiles(pages)) === JSON.stringify(['index.html', 'hakkimizda.html', 'hakkimizda-2.html', 'sayfa-4.html']), 'Page files: index first, unique names', pageFiles(pages));
  const anchors = sectionAnchors({ id: 'p', name: 'x', sections: [newSection('about'), newSection('about'), { ...newSection('custom'), title: 'Kampanyalar' }] }, 'tr');
  check(JSON.stringify(anchors) === JSON.stringify(['hakkimizda', 'hakkimizda-2', 'kampanyalar']), 'Unique section anchors', anchors);
  check(resolveCategory({ category: 'auto', siteType: 'Kafe', description: '', siteName: '' }) === 'yemek', 'Kafe -> Yemek & Kafe');
  check(resolveCategory({ category: 'auto', siteType: 'Diş kliniği', description: '', siteName: '' }) === 'doga_saglik', 'Diş kliniği -> Doğa & Sağlık');
  check(resolveCategory({ category: 'auto', siteType: '', description: 'Emekli öğretmenler için', siteName: '' }) === 'genel', 'Unknown -> Genel');
  check(resolveCategory({ category: 'luks', siteType: 'Kafe', description: '', siteName: '' }) === 'luks', 'A chosen category wins');
  check(defaultPages('yemek', false, 'tr')[0].sections.map((s) => s.kind).join(',') === 'hero,about,menu,gallery,testimonials,contact', 'Cafe one-pager sections');
  check(defaultPages('teknoloji', true, 'tr').map((p) => p.name).join(',') === 'Ana Sayfa,Fiyatlar,Hakkımızda,İletişim', 'Tech site pages');
  check(defaultPages('kurumsal', true, 'en')[0].name === 'Home', 'English page names');

  // =====================================================================
  section('4. The generated request');
  // =====================================================================
  const one = compileSitePrompt(cafe({ contact: { ...createWizardData().contact, phone: '0216 555 12 34', instagram: '@kahveduragi' } }), { year: 2026 });
  const p = one.prompt;
  check(p.startsWith('"Kahve Durağı" için tek sayfalık bir web sitesi oluştur.'), 'Heading line', p.slice(0, 120));
  check(p.includes('- Site türü: Kafe.') && p.includes('Sayfadaki tüm metinler Türkçe olsun.'), 'About the site + language');
  check(p.includes('- index.html (tek sayfa).') && p.includes('Hakkımızda (#hakkimizda), Menü (#menu), Galeri (#galeri), İletişim (#iletisim)'), 'One-page menu links to the section anchors', p);
  const order = ['Karşılama (id="giris")', 'Hakkımızda (id="hakkimizda")', 'Menü (id="menu")', 'Galeri (id="galeri")', 'Yorumlar (id="yorumlar")', 'İletişim (id="iletisim")'];
  check(order.every((s, i) => i === 0 || p.indexOf(s) > p.indexOf(order[i - 1])), 'Sections in order with their ids');
  check(p.includes('Metni sen yaz: kategorilere ayrılmış ürünler'), 'Empty sections: the agent writes with guidance');
  check(p.includes('- Telefon: 0216 555 12 34') && p.includes('Instagram https://instagram.com/kahveduragi'), 'Contact details and social links');
  check(p.includes('İletişim formu:') && !p.includes('SSS bölümünde') && !p.includes('Galeride bir görsele'), 'Only features the page can use');
  check(p.includes('2026 yılını kullan') && p.includes('Harici görsel kullanma'), 'Year and image rule');
  check(one.checklist.length === 0 && decomposeGoalIntoSubtasks(p).length >= 1, 'One page: no checklist from the wizard');
  check(one.design.enabled && one.design.themeId === null && one.design.category === 'yemek', 'Automatic theme by the cafe topic', one.design);
  check(one.displayGoal.includes('"Kahve Durağı"') && one.displayGoal.includes('1 sayfa') && one.displayGoal.includes('6 bölüm'), 'Short title for the timeline', one.displayGoal);
  check(compileSitePrompt(cafe(), { year: 2026 }).prompt === compileSitePrompt(cafe(), { year: 2026 }).prompt, 'Deterministic output');

  const multiData = cafe({ multiPage: true, pages: defaultPages('yemek', true, 'tr'), theme: 'fırın-yok' });
  multiData.pages[1].sections[0].content = '## Sıcak içecekler\n1. Espresso — 45 ₺\n2. Latte — 65 ₺\n\n**Vegan** seçenekler var.';
  multiData.pages[1].sections[0].title = 'Menümüz';
  const multi = compileSitePrompt(multiData, { year: 2026 });
  check(multi.checklist.length === 4 && multi.checklist[0].startsWith('index.html — Ana Sayfa:') && multi.checklist[1].startsWith('menu.html — Menü: Menümüz'), 'One checklist item per page file', multi.checklist);
  check(multi.prompt.includes('SAYFA 2: menu.html (Menü) — bölümler bu sırayla:') && multi.prompt.includes('- Menü (id="menu") — başlık: "Menümüz". İçerik olarak bu HTML’i aynen kullan:'), 'Page blocks with the user heading', multi.prompt);
  check(multi.prompt.includes('<h3>Sıcak içecekler</h3>\n<ol><li>Espresso — 45 ₺</li><li>Latte — 65 ₺</li></ol>\n<p><strong>Vegan</strong> seçenekler var.</p>'), 'User text embedded as HTML', multi.prompt);
  check(multi.prompt.includes('Her sayfada aynı üst menü') && multi.stats.userTexts === 1, 'Shared menu/footer rule and stats');
  check(multi.design.enabled && multi.design.themeId === null, 'Unknown theme id falls back to automatic');

  const fixed = compileSitePrompt(cafe({ theme: 'dergi' }), { year: 2026 });
  check(fixed.design.enabled && fixed.design.themeId === 'dergi' && fixed.displayGoal.includes('tema: Dergi'), 'A picked theme goes to the run');
  const none = compileSitePrompt(cafe({ theme: 'none', colorMode: 'dark' }), { year: 2026 });
  check(!none.design.enabled && none.prompt.includes('Koyu renkli bir tasarım kullan.'), 'No theme: the model designs (dark wish passed on)');
  const en = compileSitePrompt(cafe({ language: 'en', siteName: 'Corner Coffee', pages: defaultPages('yemek', false, 'en') }), { year: 2026 });
  check(en.prompt.startsWith('Create a one-page website for "Corner Coffee".') && en.prompt.includes('All page text is in English.') && en.prompt.includes('About (#about)'), 'English site, English request', en.prompt.slice(0, 400));
  const empty = compileSitePrompt(createWizardData(), { year: 2026 });
  check(empty.warnings.some((w) => /Site adı boş/.test(w)) && empty.prompt.includes('"Web Sitem"'), 'Empty name: warning and a neutral name');
  const long = cafe();
  long.pages[0].sections[1].content = 'kelime '.repeat(1200);
  check(compileSitePrompt(long, { year: 2026 }).warnings.some((w) => /uzun/.test(w)), 'Very long texts: warning for small models');

  // =====================================================================
  section('5. Wizard store');
  // =====================================================================
  const store = useSiteWizardStore.getState();
  store.reset();
  store.update({ siteName: 'Kahve Durağı', siteType: 'Kafe' });
  let s = useSiteWizardStore.getState();
  check(s.data.pages[0].sections.map((x) => x.kind).join(',') === 'hero,about,menu,gallery,testimonials,contact', 'Topic change: untouched pages follow the topic');
  s.toggleSection('faq');
  s = useSiteWizardStore.getState();
  const kinds = s.data.pages[0].sections.map((x) => x.kind);
  check(kinds.includes('faq') && kinds[kinds.length - 1] === 'contact' && kinds[0] === 'hero' && s.data.pagesTouched, 'Adding a section keeps hero first and contact last', kinds);
  s.update({ siteType: 'Hukuk bürosu' });
  check(useSiteWizardStore.getState().data.pages[0].sections.some((x) => x.kind === 'faq'), 'Touched pages survive a topic change');
  const aboutId = useSiteWizardStore.getState().data.pages[0].sections.find((x) => x.kind === 'about')!.id;
  s.updateSection(useSiteWizardStore.getState().data.pages[0].id, aboutId, { content: 'Bizim **hikâyemiz**' });
  useSiteWizardStore.getState().setMultiPage(true);
  s = useSiteWizardStore.getState();
  const homeKinds = s.data.pages[0].sections.map((x) => x.kind);
  const aboutPage = s.data.pages.find((pg) => pg.sections.some((x) => x.id === aboutId));
  check(
    s.data.pages.length > 1 &&
      !homeKinds.includes('about') &&
      !homeKinds.includes('contact') &&
      s.data.pages.slice(1).some((pg) => pg.sections.some((x) => x.kind === 'faq')),
    'To several pages: sections with their own page move there (FAQ to the services page of a law firm)',
    homeKinds
  );
  check(!!aboutPage && aboutPage !== s.data.pages[0] && aboutPage.sections.find((x) => x.id === aboutId)!.content === 'Bizim **hikâyemiz**', 'The user’s text moves with its section');
  s.addPage('gallery');
  s = useSiteWizardStore.getState();
  const names = s.data.pages.map((x) => x.name);
  check(names[names.length - 2] === 'Galeri' && names[names.length - 1] === 'İletişim', 'A new page goes before the contact page', names);
  const galleryId = s.data.pages[names.length - 2].id;
  s.movePage(galleryId, -1);
  s.removePage(galleryId);
  check(!useSiteWizardStore.getState().data.pages.some((x) => x.id === galleryId), 'Pages can be moved and removed');
  s = useSiteWizardStore.getState();
  const firstPage = s.data.pages[0];
  s.updateSection(firstPage.id, firstPage.sections[1].id, { content: '**Özel** metin', title: 'Biz kimiz' });
  s.moveSection(firstPage.id, firstPage.sections[1].id, 1);
  s = useSiteWizardStore.getState();
  check(s.data.pages[0].sections[2].title === 'Biz kimiz' && s.data.pages[0].sections[2].content === '**Özel** metin', 'Section text and order are stored');
  s.setMultiPage(false);
  s = useSiteWizardStore.getState();
  check(s.data.pages.length === 1 && s.data.pages[0].sections.some((x) => x.title === 'Biz kimiz') && s.data.pages[0].sections.some((x) => x.kind === 'contact'), 'Back to one page: sections of the other pages are merged');
  s.setMode('detailed');
  check(useSiteWizardStore.getState().data.mode === 'detailed' && useSiteWizardStore.getState().step === 0, 'Mode switch keeps the answers');
  check(PAGE_TEMPLATES.every((t) => t.sections.length > 0), 'Every page template has sections');

  console.log(`\n===========================================`);
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    failures.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} SITE WIZARD TESTS PASSED`);
  console.log(`===========================================`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
