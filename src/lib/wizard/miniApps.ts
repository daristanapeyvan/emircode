/**
 * miniApps.ts — catalog and request compiler of the Mini App wizard: single-file web tools
 * (calculators, timers, lists, games...). Every tool is data: fields, the features it always has,
 * the rules that keep small models away from their usual mistakes (eval in calculators,
 * Math.random for passwords, drifting timers) and the design category of its theme. Nothing is
 * tied to one country: money, dates and sample lists follow the user's language and locale.
 */
import type { DesignCategory } from '../design/themes';
import { getTheme } from '../design/themes';
import type { DesignOverride } from '../design/DesignTheme';
import { ParamField, ParamValues, Text, Lang, tx, describeValues, defaultValues } from './params';

export interface ToolCategory {
  id: string;
  icon: string;
  title: Text;
}

export interface MiniAppDef {
  id: string;
  category: string;
  icon: string;
  title: Text;
  description: Text;
  designCategory: DesignCategory;
  /** Features every version of the tool has. */
  base: Text[];
  /** Rules against typical small-model mistakes. */
  rules: Text[];
  fields: ParamField[];
}

const t = (tr: string, en: string): Text => ({ tr, en });

const CURRENCY: ParamField = {
  key: 'currency',
  type: 'choice',
  label: t('Para birimi', 'Currency'),
  default: 'auto',
  options: [
    {
      value: 'auto',
      label: t('Otomatik', 'Automatic'),
      prompt: t(
        'Para birimi tarayıcının dil ve bölge ayarından gelsin (Intl.NumberFormat); kullanıcı uygulamada başka bir para birimi seçebilsin.',
        'Take the currency from the browser’s language and region (Intl.NumberFormat); the user can pick another currency in the app.'
      ),
    },
    { value: 'usd', label: t('$ Dolar', '$ Dollar'), prompt: t('Para birimi $ (USD).', 'Currency: $ (USD).') },
    { value: 'eur', label: t('€ Euro', '€ Euro'), prompt: t('Para birimi € (EUR).', 'Currency: € (EUR).') },
    { value: 'gbp', label: t('£ Sterlin', '£ Pound'), prompt: t('Para birimi £ (GBP).', 'Currency: £ (GBP).') },
    { value: 'try', label: t('₺ Lira', '₺ Lira'), prompt: t('Para birimi ₺ (TRY).', 'Currency: ₺ (TRY).') },
  ],
};

export const MINI_APP_CATEGORIES: ToolCategory[] = [
  { id: 'hesaplama', icon: 'calculator', title: t('Hesaplama', 'Calculators') },
  { id: 'verimlilik', icon: 'timer', title: t('Verimlilik', 'Productivity') },
  { id: 'takip', icon: 'wallet', title: t('Takip', 'Tracking') },
  { id: 'yardimci', icon: 'wrench', title: t('Yardımcı Araçlar', 'Utilities') },
  { id: 'eglence', icon: 'gamepad-2', title: t('Eğlence & Öğrenme', 'Fun & Learning') },
];

export const MINI_APPS: MiniAppDef[] = [
  // ------------------------------------------------------------------ Hesaplama
  {
    id: 'hesap-makinesi',
    category: 'hesaplama',
    icon: 'calculator',
    title: t('Hesap Makinesi', 'Calculator'),
    description: t('Dört işlem, yüzde ve işlem geçmişi; istersen bilimsel mod.', 'Arithmetic, percent and history; optional scientific mode.'),
    designCategory: 'teknoloji',
    base: [
      t('Rakam, dört işlem, ondalık ayırıcı, yüzde, işaret değiştirme (±), silme (⌫) ve temizleme (C) tuşları olan bir hesap makinesi.', 'A calculator with digit keys, the four operations, decimal separator, percent, sign (±), backspace (⌫) and clear (C).'),
      t('İşlem önceliğine uy (çarpma ve bölme önce); girilen ifade üstte küçük, sonuç altta büyük görünsün.', 'Respect operator precedence; show the expression small on top and the result large below.'),
    ],
    rules: [
      t('eval() veya Function() kullanma; ifadeyi kendi yazdığın küçük bir ayrıştırıcıyla hesapla.', 'Do not use eval() or Function(); evaluate with your own small parser.'),
      t('Sıfıra bölmede ve geçersiz girişte uygulama çökmesin; ekranda anlaşılır bir mesaj göster.', 'Division by zero and invalid input must not break the app; show a clear message.'),
      t('Kayan nokta hatalarını gizle (0.1 + 0.2 sonucu 0.3 görünsün); sayıları tarayıcının bölge ayarıyla biçimlendir.', 'Hide floating point artefacts (0.1 + 0.2 shows 0.3); format numbers with the browser’s locale.'),
    ],
    fields: [
      {
        key: 'mode',
        type: 'choice',
        label: t('Mod', 'Mode'),
        default: 'basic',
        options: [
          { value: 'basic', label: t('Basit', 'Basic') },
          {
            value: 'scientific',
            label: t('Bilimsel', 'Scientific'),
            prompt: t('Bilimsel mod: karekök, üs (xʸ), sin/cos/tan (derece), log, ln, π ve parantez tuşları.', 'Scientific mode: square root, power (xʸ), sin/cos/tan (degrees), log, ln, π and brackets.'),
          },
        ],
      },
      { key: 'history', type: 'toggle', label: t('İşlem geçmişi', 'History'), default: true, on: t('Son 10 işlemi gösteren bir geçmiş paneli; bir kayda tıklayınca sonuç ekrana gelsin.', 'A history panel with the last 10 calculations; clicking one recalls its result.') },
      { key: 'keyboard', type: 'toggle', label: t('Klavye desteği', 'Keyboard support'), default: true, on: t('Klavye desteği: rakamlar, + - * /, Enter (=), Backspace ve Esc (C).', 'Keyboard support: digits, + - * /, Enter (=), Backspace and Esc (C).') },
      { key: 'memory', type: 'toggle', label: t('Bellek tuşları', 'Memory keys'), default: false, on: t('Bellek tuşları: MC, MR, M+, M-.', 'Memory keys: MC, MR, M+, M-.') },
      {
        key: 'precision',
        type: 'choice',
        label: t('Ondalık', 'Decimals'),
        default: 'auto',
        options: [
          { value: 'auto', label: t('Otomatik', 'Automatic') },
          { value: '2', label: t('2 basamak', '2 digits'), prompt: t('Sonuçları 2 ondalık basamağa yuvarla.', 'Round results to 2 decimals.') },
          { value: '4', label: t('4 basamak', '4 digits'), prompt: t('Sonuçları 4 ondalık basamağa yuvarla.', 'Round results to 4 decimals.') },
        ],
      },
    ],
  },
  {
    id: 'birim-cevirici',
    category: 'hesaplama',
    icon: 'arrow-left-right',
    title: t('Birim Çevirici', 'Unit Converter'),
    description: t('Uzunluk, ağırlık, sıcaklık ve daha fazlası; yazarken anında çeviri.', 'Length, weight, temperature and more; converts as you type.'),
    designCategory: 'genel',
    base: [t('Bir sayı kutusu, kaynak ve hedef birim seçimi ve yönleri değiştiren bir düğme; sonuç yazarken anında güncellensin.', 'A number field, source and target units and a swap button; the result updates as you type.')],
    rules: [t('Dönüşüm katsayılarını tek bir nesnede doğru tanımla; sıcaklıkta formül kullan (°C, °F, K).', 'Define the factors correctly in one object; use formulas for temperature (°C, °F, K).')],
    fields: [
      {
        key: 'groups',
        type: 'multi',
        label: t('Birim grupları', 'Unit groups'),
        default: ['length', 'weight', 'temperature', 'volume'],
        min: 1,
        prompt: t('Birim grupları (sekme olarak): {items}.', 'Unit groups (as tabs): {items}.'),
        options: [
          { value: 'length', label: t('Uzunluk', 'Length') },
          { value: 'weight', label: t('Ağırlık', 'Weight') },
          { value: 'temperature', label: t('Sıcaklık', 'Temperature') },
          { value: 'volume', label: t('Hacim', 'Volume') },
          { value: 'area', label: t('Alan', 'Area') },
          { value: 'speed', label: t('Hız', 'Speed') },
          { value: 'data', label: t('Veri boyutu', 'Data size') },
          { value: 'time', label: t('Zaman', 'Time') },
        ],
      },
      { key: 'decimals', type: 'number', label: t('Ondalık basamak', 'Decimals'), default: 4, min: 0, max: 10, prompt: t('Sonuçlarda en fazla {value} ondalık basamak.', 'At most {value} decimals in results.') },
      { key: 'table', type: 'toggle', label: t('Tüm birimler tablosu', 'All-units table'), default: false, on: t('Girilen değerin gruptaki tüm birimlerde karşılığını gösteren bir tablo.', 'A table with the value in every unit of the group.') },
    ],
  },
  {
    id: 'kredi-hesaplayici',
    category: 'hesaplama',
    icon: 'landmark',
    title: t('Kredi Hesaplayıcı', 'Loan Calculator'),
    description: t('Aylık taksit, toplam geri ödeme ve ödeme planı tablosu.', 'Monthly payment, total repayment and a payment schedule.'),
    designCategory: 'kurumsal',
    base: [t('Kredi tutarı, faiz oranı (%) ve vade (ay) alanları; aylık taksit, toplam geri ödeme ve toplam faiz.', 'Loan amount, interest rate (%) and term (months); monthly payment, total repayment and total interest.')],
    rules: [
      t('Taksiti eşit taksit (anüite) formülüyle hesapla; faiz 0 ise tutarı vadeye böl.', 'Use the annuity formula; with 0 % interest divide the amount by the term.'),
      t('Tutarları tarayıcının bölge ayarıyla biçimlendir (Intl.NumberFormat).', 'Format amounts with the browser’s locale (Intl.NumberFormat).'),
    ],
    fields: [
      CURRENCY,
      {
        key: 'rate',
        type: 'choice',
        label: t('Faiz oranı', 'Interest rate'),
        default: 'annual',
        options: [
          { value: 'annual', label: t('Yıllık', 'Annual'), prompt: t('Girilen faiz oranı yıllıktır (aylık oran = yıllık / 12).', 'The entered rate is annual (monthly rate = annual / 12).') },
          { value: 'monthly', label: t('Aylık', 'Monthly'), prompt: t('Girilen faiz oranı aylıktır.', 'The entered rate is monthly.') },
          { value: 'both', label: t('Seçilebilir', 'Selectable'), prompt: t('Kullanıcı faiz oranının yıllık mı aylık mı olduğunu seçebilsin.', 'The user chooses whether the rate is annual or monthly.') },
        ],
      },
      { key: 'schedule', type: 'toggle', label: t('Ödeme planı', 'Schedule'), default: true, on: t('Her ay için taksit, anapara, faiz ve kalan borç tablosu.', 'A table with payment, principal, interest and balance for every month.') },
      { key: 'chart', type: 'toggle', label: t('Grafik', 'Chart'), default: false, on: t('Anapara ve faizi gösteren bir halka grafik (canvas, kütüphanesiz).', 'A donut chart of principal vs. interest (canvas, no library).') },
      { key: 'fees', type: 'toggle', label: t('Ek masraflar', 'Extra costs'), default: false, on: t('Tek seferlik masraf ve aylık sigorta gibi ek masraf alanları; toplam maliyete eklensin.', 'Fields for a one-off fee and monthly costs such as insurance, added to the total cost.') },
    ],
  },
  {
    id: 'hesap-bolusme',
    category: 'hesaplama',
    icon: 'receipt',
    title: t('Hesap Bölüşme', 'Bill Splitter'),
    description: t('Adisyonu kişilere böl, bahşişi ekle, kişi başını gör.', 'Split the bill, add a tip, see the share per person.'),
    designCategory: 'yemek',
    base: [t('Toplam tutar, bahşiş yüzdesi ve kişi sayısı; kişi başı tutar ve genel toplam büyük yazıyla.', 'Bill total, tip percentage and number of people; share per person and grand total in large type.')],
    rules: [],
    fields: [
      CURRENCY,
      { key: 'tips', type: 'text', label: t('Bahşiş düğmeleri (%)', 'Tip buttons (%)'), default: '10, 15, 20', maxLength: 40, prompt: t('Hazır bahşiş yüzdesi düğmeleri: {value}; özel yüzde de girilebilsin.', 'Tip preset buttons: {value}; a custom percentage is possible too.') },
      { key: 'itemized', type: 'toggle', label: t('Ayrıntılı bölüşme', 'Itemised split'), default: false, on: t('Herkesin kendi siparişini girdiği ayrıntılı bölüşme modu.', 'An itemised mode where everyone enters what they ordered.') },
      { key: 'rounding', type: 'toggle', label: t('Yukarı yuvarlama', 'Round up'), default: true, on: t('Kişi başı tutarı yukarı yuvarlama seçeneği.', 'An option to round the share up.') },
    ],
  },
  {
    id: 'tarih-hesaplayici',
    category: 'hesaplama',
    icon: 'calendar-days',
    title: t('Tarih Hesaplayıcı', 'Date Calculator'),
    description: t('İki tarih arası fark, yaş hesaplama, tarihe gün ekleme.', 'Days between dates, age, adding days to a date.'),
    designCategory: 'genel',
    base: [t('Sekmelerle ayrılmış hesaplama modları; sonuçlar girdiler değişince anında güncellensin.', 'Calculation modes in tabs; results update as the inputs change.')],
    rules: [t('Tarih hesaplarında saat dilimi kaymalarına dikkat et (tarihleri gün başı olarak al).', 'Avoid time zone shifts (treat dates as start of day).')],
    fields: [
      {
        key: 'modes',
        type: 'multi',
        label: t('Modlar', 'Modes'),
        default: ['diff', 'age', 'add'],
        min: 1,
        prompt: t('Modlar: {items}.', 'Modes: {items}.'),
        options: [
          { value: 'diff', label: t('İki tarih arası', 'Between dates'), prompt: t('iki tarih arasındaki gün, hafta ve ay farkı', 'days, weeks and months between two dates') },
          { value: 'age', label: t('Yaş', 'Age'), prompt: t('doğum tarihinden yaş (yıl, ay, gün) ve sonraki doğum gününe kalan gün', 'age (years, months, days) and days to the next birthday') },
          { value: 'add', label: t('Gün ekle/çıkar', 'Add/subtract'), prompt: t('bir tarihe gün, hafta veya ay ekleme/çıkarma', 'adding or subtracting days, weeks or months') },
          { value: 'workdays', label: t('İş günü', 'Working days'), prompt: t('iki tarih arasındaki iş günü sayısı (hafta sonları hariç)', 'working days between two dates (weekends excluded)') },
        ],
      },
      {
        key: 'format',
        type: 'choice',
        label: t('Tarih biçimi', 'Date format'),
        default: 'local',
        options: [
          { value: 'local', label: t('Bölgeye göre', 'By locale'), prompt: t('Tarihleri tarayıcının bölge ayarına göre göster (toLocaleDateString).', 'Show dates in the browser’s locale format (toLocaleDateString).') },
          { value: 'dmy', label: t('GG.AA.YYYY', 'DD.MM.YYYY'), prompt: t('Tarihleri GG.AA.YYYY biçiminde göster.', 'Show dates as DD.MM.YYYY.') },
          { value: 'mdy', label: t('AA/GG/YYYY', 'MM/DD/YYYY'), prompt: t('Tarihleri AA/GG/YYYY biçiminde göster.', 'Show dates as MM/DD/YYYY.') },
          { value: 'iso', label: t('YYYY-AA-GG', 'YYYY-MM-DD'), prompt: t('Tarihleri YYYY-AA-GG biçiminde göster.', 'Show dates as YYYY-MM-DD.') },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ Verimlilik
  {
    id: 'pomodoro',
    category: 'verimlilik',
    icon: 'timer',
    title: t('Pomodoro Zamanlayıcı', 'Pomodoro Timer'),
    description: t('Odak ve mola döngüleri, sesli uyarı ve günlük istatistik.', 'Focus and break cycles, sound alerts and daily stats.'),
    designCategory: 'genel',
    base: [
      t('Büyük bir geri sayım (dakika:saniye), dairesel ilerleme göstergesi, Başlat/Duraklat, Sıfırla ve Atla düğmeleri; odak ve molalar sırayla değişsin.', 'A large countdown (mm:ss), a circular progress ring, Start/Pause, Reset and Skip; focus and breaks alternate.'),
      t('Sayfa başlığında kalan süre görünsün.', 'The page title shows the remaining time.'),
    ],
    rules: [
      t('Süreyi setInterval saymasıyla değil başlangıç zamanına göre hesapla (sekme arka plandayken de doğru kalsın).', 'Compute time from the start timestamp, not by counting intervals (stays right in background tabs).'),
      t('Ses dosyası kullanma; Web Audio API ile kısa bir zil sesi üret.', 'No audio files; generate a short chime with the Web Audio API.'),
    ],
    fields: [
      { key: 'focus', type: 'number', label: t('Odak süresi', 'Focus'), default: 25, min: 1, max: 120, unit: t('dk', 'min'), prompt: t('Odak süresi {value} dakika.', 'Focus lasts {value} minutes.') },
      { key: 'short', type: 'number', label: t('Kısa mola', 'Short break'), default: 5, min: 1, max: 60, unit: t('dk', 'min'), prompt: t('Kısa mola {value} dakika.', 'Short break lasts {value} minutes.') },
      { key: 'longBreak', type: 'toggle', label: t('Uzun mola', 'Long break'), default: true, on: t('Belirli sayıda odak turundan sonra uzun mola.', 'A long break after a number of focus rounds.') },
      { key: 'long', type: 'number', label: t('Uzun mola süresi', 'Long break length'), default: 15, min: 1, max: 90, unit: t('dk', 'min'), showIf: { key: 'longBreak', equals: true }, prompt: t('Uzun mola {value} dakika.', 'Long break lasts {value} minutes.') },
      { key: 'rounds', type: 'number', label: t('Uzun molaya kadar tur', 'Rounds before long break'), default: 4, min: 2, max: 12, showIf: { key: 'longBreak', equals: true }, prompt: t('Uzun molaya kadar {value} odak turu.', '{value} focus rounds before a long break.') },
      { key: 'sound', type: 'toggle', label: t('Sesli uyarı', 'Sound'), default: true, on: t('Her süre bitiminde kısa bir zil sesi.', 'A short chime when a period ends.') },
      { key: 'notify', type: 'toggle', label: t('Masaüstü bildirimi', 'Desktop notification'), default: false, on: t('Süre bitince masaüstü bildirimi (izin iste).', 'A desktop notification when a period ends (ask for permission).') },
      { key: 'autoStart', type: 'toggle', label: t('Otomatik başlat', 'Auto start'), default: false, on: t('Bir süre bitince sonraki süre kendiliğinden başlasın.', 'The next period starts automatically.') },
      { key: 'stats', type: 'toggle', label: t('Günlük istatistik', 'Daily stats'), default: true, on: t('Bugün tamamlanan odak turları ve toplam odak süresi (localStorage ile kalıcı).', "Today's completed rounds and focus time (saved in localStorage).") },
      { key: 'task', type: 'toggle', label: t('Görev alanı', 'Task field'), default: false, on: t('Üzerinde çalışılan görevi yazmak için bir alan; tamamlanan turlar göreve eklensin.', 'A field for the current task; completed rounds are added to it.') },
    ],
  },
  {
    id: 'yapilacaklar',
    category: 'verimlilik',
    icon: 'list-checks',
    title: t('Yapılacaklar Listesi', 'To-Do List'),
    description: t('Görev ekle, tamamla, düzenle ve filtrele; tarayıcıda kalıcı.', 'Add, complete, edit and filter tasks; saved in the browser.'),
    designCategory: 'genel',
    base: [t('Görev ekleme kutusu (Enter ile eklesin), tamamlandı işareti, çift tıklayarak düzenleme, silme ve kalan görev sayacı.', 'An input that adds on Enter, a done checkbox, double-click to edit, delete and a remaining counter.')],
    rules: [t('Kullanıcı metnini innerHTML ile değil textContent ile ekle.', 'Insert user text with textContent, never innerHTML.')],
    fields: [
      { key: 'persist', type: 'toggle', label: t('Kalıcı kayıt', 'Persistence'), default: true, on: t('Görevler localStorage ile kalıcı olsun.', 'Tasks are saved in localStorage.') },
      { key: 'filters', type: 'toggle', label: t('Filtreler', 'Filters'), default: true, on: t('Tümü / Aktif / Tamamlanan filtreleri ve tamamlananları temizle düğmesi.', 'All / Active / Done filters and a clear-completed button.') },
      { key: 'priority', type: 'toggle', label: t('Öncelik', 'Priority'), default: false, on: t('Öncelik seçimi (düşük, orta, yüksek) ve önceliğe göre renkli işaret.', 'Priority (low, medium, high) with a coloured marker.') },
      { key: 'dueDate', type: 'toggle', label: t('Son tarih', 'Due date'), default: false, on: t('Son tarih seçimi; tarihi geçen görevler vurgulansın.', 'A due date; overdue tasks are highlighted.') },
      { key: 'tags', type: 'toggle', label: t('Etiketler', 'Tags'), default: false, on: t('Etiketler ve etikete göre filtreleme.', 'Tags and filtering by tag.') },
      { key: 'dragSort', type: 'toggle', label: t('Sürükle-bırak', 'Drag and drop'), default: false, on: t('Sürükle-bırak ile sıralama.', 'Reorder by drag and drop.') },
      { key: 'exportImport', type: 'toggle', label: t('Dışa/içe aktar', 'Export/import'), default: false, on: t('Görevleri JSON dosyası olarak dışa ve içe aktarma.', 'Export and import tasks as a JSON file.') },
    ],
  },
  {
    id: 'not-defteri',
    category: 'verimlilik',
    icon: 'notebook-pen',
    title: t('Not Defteri', 'Notes'),
    description: t('Aranabilir notlar, Markdown önizleme ve otomatik kayıt.', 'Searchable notes, Markdown preview and autosave.'),
    designCategory: 'yaratici',
    base: [t('Solda not listesi (başlık ve son değişiklik tarihi), sağda düzenleyici; yeni not ve silme düğmeleri.', 'A note list on the left (title and last change), an editor on the right; new and delete buttons.')],
    rules: [t("Markdown'ı kendin basitçe dönüştür (başlık, kalın, italik, liste, bağlantı) ve önce HTML karakterlerini kaçır (XSS olmasın).", 'Convert Markdown yourself (headings, bold, italic, lists, links) and escape HTML first (no XSS).')],
    fields: [
      { key: 'markdown', type: 'toggle', label: t('Markdown önizleme', 'Markdown preview'), default: true, on: t('Markdown önizleme sekmesi.', 'A Markdown preview tab.') },
      { key: 'search', type: 'toggle', label: t('Arama', 'Search'), default: true, on: t('Başlık ve içerikte arama.', 'Search in titles and content.') },
      { key: 'autosave', type: 'toggle', label: t('Otomatik kayıt', 'Autosave'), default: true, on: t('Yazarken otomatik kayıt (localStorage).', 'Autosave while typing (localStorage).') },
      { key: 'pin', type: 'toggle', label: t('Sabitleme', 'Pinning'), default: false, on: t('Notları listenin başına sabitleme.', 'Pin notes to the top.') },
      { key: 'export', type: 'toggle', label: t('Dışa aktar', 'Export'), default: false, on: t('Notu .md veya .txt dosyası olarak indirme.', 'Download a note as .md or .txt.') },
    ],
  },
  {
    id: 'geri-sayim',
    category: 'verimlilik',
    icon: 'hourglass',
    title: t('Geri Sayım & Kronometre', 'Countdown & Stopwatch'),
    description: t('Hedef tarihe geri sayım, kronometre ve tur zamanları.', 'Countdown to a date, a stopwatch with laps.'),
    designCategory: 'teknoloji',
    base: [t('Büyük, okunaklı rakamlar ve sekmelerle ayrılmış modlar.', 'Large, readable digits and modes in tabs.')],
    rules: [t('Süreleri Date.now() farkıyla hesapla; sekme arka plandayken sapma olmasın.', 'Compute durations from Date.now() differences so background tabs do not drift.')],
    fields: [
      {
        key: 'modes',
        type: 'multi',
        label: t('Modlar', 'Modes'),
        default: ['countdown', 'stopwatch', 'timer'],
        min: 1,
        prompt: t('Modlar: {items}.', 'Modes: {items}.'),
        options: [
          { value: 'countdown', label: t('Tarihe geri sayım', 'Countdown to a date'), prompt: t('bir hedef tarih ve saate geri sayım (gün, saat, dakika, saniye)', 'a countdown to a target date and time (days, hours, minutes, seconds)') },
          { value: 'stopwatch', label: t('Kronometre', 'Stopwatch'), prompt: t('tur kaydeden kronometre', 'a stopwatch with laps') },
          { value: 'timer', label: t('Zamanlayıcı', 'Timer'), prompt: t('dakika ve saniye girilen geri sayım zamanlayıcısı', 'a timer set in minutes and seconds') },
        ],
      },
      { key: 'fullscreen', type: 'toggle', label: t('Tam ekran', 'Full screen'), default: false, on: t('Tam ekran düğmesi.', 'A full screen button.') },
      { key: 'sound', type: 'toggle', label: t('Sesli uyarı', 'Sound'), default: true, on: t('Süre bitince Web Audio ile kısa bir sesli uyarı.', 'A short Web Audio alert when time is up.') },
    ],
  },

  // ------------------------------------------------------------------ Takip
  {
    id: 'harcama-takibi',
    category: 'takip',
    icon: 'wallet',
    title: t('Harcama Takibi', 'Expense Tracker'),
    description: t('Gelir-gider kaydı, kategori özeti ve aylık grafik.', 'Income and expenses, category summary and a monthly chart.'),
    designCategory: 'kurumsal',
    base: [t('Tutar, açıklama, kategori ve tarihle kayıt ekleme; gelir/gider türü; toplam gelir, gider ve bakiye kartları; kayıt listesi ve silme.', 'Add entries with amount, note, category and date; income/expense type; income, expense and balance cards; entry list with delete.')],
    rules: [t('Kayıtlar localStorage ile kalıcı olsun; tutarları para birimi biçimiyle göster.', 'Entries are saved in localStorage; amounts are shown in currency format.')],
    fields: [
      CURRENCY,
      {
        key: 'categories',
        type: 'list',
        label: t('Kategoriler', 'Categories'),
        default: t('Market\nFaturalar\nUlaşım\nEğlence\nSağlık', 'Groceries\nBills\nTransport\nFun\nHealth'),
        placeholder: t('Her satıra bir kategori', 'One category per line'),
        prompt: t('Kategoriler:\n{items}', 'Categories:\n{items}'),
      },
      { key: 'chart', type: 'toggle', label: t('Grafik', 'Chart'), default: true, on: t('Kategorilere göre harcama dağılımı grafiği (canvas, kütüphanesiz).', 'A chart of spending by category (canvas, no library).') },
      { key: 'budget', type: 'toggle', label: t('Bütçe limiti', 'Budget limit'), default: false, on: t('Aylık bütçe limiti ve aşılınca uyarı.', 'A monthly budget with a warning when exceeded.') },
      { key: 'monthFilter', type: 'toggle', label: t('Ay filtresi', 'Month filter'), default: true, on: t('Aya göre filtreleme.', 'Filter by month.') },
      { key: 'csv', type: 'toggle', label: t('CSV dışa aktar', 'CSV export'), default: false, on: t('Kayıtları CSV olarak dışa aktarma.', 'Export entries as CSV.') },
    ],
  },
  {
    id: 'aliskanlik-takibi',
    category: 'takip',
    icon: 'calendar-check',
    title: t('Alışkanlık Takibi', 'Habit Tracker'),
    description: t('Günlük alışkanlıklar, seri sayacı ve aylık görünüm.', 'Daily habits, streaks and a monthly view.'),
    designCategory: 'doga_saglik',
    base: [t('Alışkanlık ekleme ve silme; her alışkanlık için bugünü işaretleme; mevcut ve en uzun seri; veriler localStorage ile kalıcı.', 'Add and remove habits; tick today per habit; current and longest streak; saved in localStorage.')],
    rules: [],
    fields: [
      { key: 'calendar', type: 'toggle', label: t('Ay takvimi', 'Month calendar'), default: true, on: t('Her alışkanlık için ay takvimi ızgarası; işaretli günler renkli.', 'A month grid per habit with ticked days coloured.') },
      { key: 'goal', type: 'toggle', label: t('Haftalık hedef', 'Weekly goal'), default: false, on: t('Haftalık hedef (ör. haftada 3 gün) ve ilerleme çubuğu.', 'A weekly goal (e.g. 3 days a week) with a progress bar.') },
      { key: 'notes', type: 'toggle', label: t('Günlük not', 'Daily note'), default: false, on: t('İşaretlenen güne kısa not ekleme.', 'A short note on a ticked day.') },
    ],
  },
  {
    id: 'vki-hesaplayici',
    category: 'takip',
    icon: 'heart-pulse',
    title: t('VKİ Hesaplayıcı', 'BMI Calculator'),
    description: t('Boy ve kiloyla vücut kitle indeksi, kategori ve ideal kilo aralığı.', 'Body mass index, category and a healthy weight range.'),
    designCategory: 'doga_saglik',
    base: [t('Boy ve kilo alanları; VKİ, kategorisi (zayıf, normal, fazla kilolu, obez) ve renkli bir gösterge çubuğu.', 'Height and weight fields; BMI, its category and a coloured gauge.')],
    rules: [t('Kategori sınırlarında Dünya Sağlık Örgütü değerlerini kullan; sonucun tıbbi tavsiye olmadığını küçük bir notla belirt.', 'Use WHO category limits; add a small note that this is not medical advice.')],
    fields: [
      {
        key: 'units',
        type: 'choice',
        label: t('Birimler', 'Units'),
        default: 'both',
        options: [
          { value: 'metric', label: t('cm / kg', 'cm / kg'), prompt: t('Birimler: cm ve kg.', 'Units: cm and kg.') },
          { value: 'imperial', label: t('ft-in / lb', 'ft-in / lb'), prompt: t('Birimler: fit-inç ve pound.', 'Units: feet-inches and pounds.') },
          { value: 'both', label: t('İkisi', 'Both'), prompt: t('Metrik ve fit-inç/pound birimleri arasında geçiş düğmesi.', 'A switch between metric and imperial units.') },
        ],
      },
      { key: 'ideal', type: 'toggle', label: t('İdeal kilo aralığı', 'Healthy range'), default: true, on: t('Boya göre sağlıklı kilo aralığını göster.', 'Show the healthy weight range for the height.') },
      { key: 'history', type: 'toggle', label: t('Ölçüm geçmişi', 'History'), default: false, on: t('Ölçümleri tarihleriyle kaydeden kalıcı bir geçmiş ve basit bir çizgi grafik (canvas).', 'A saved measurement history with a simple line chart (canvas).') },
    ],
  },

  // ------------------------------------------------------------------ Yardımcı araçlar
  {
    id: 'sifre-uretici',
    category: 'yardimci',
    icon: 'key-round',
    title: t('Şifre Üretici', 'Password Generator'),
    description: t('Güçlü rastgele şifreler, güç göstergesi ve tek tıkla kopyalama.', 'Strong random passwords, a strength meter and one-click copy.'),
    designCategory: 'teknoloji',
    base: [t('Uzunluk kaydırıcısı, karakter türü seçenekleri, Üret ve Kopyala düğmeleri; kopyalanınca kısa bir onay mesajı.', 'A length slider, character set options, Generate and Copy buttons; a short confirmation after copying.')],
    rules: [t('Rastgelelik için yalnızca crypto.getRandomValues kullan (Math.random değil); şifreyi hiçbir yere gönderme veya kaydetme.', 'Use only crypto.getRandomValues (never Math.random); never send or store passwords.')],
    fields: [
      { key: 'length', type: 'number', label: t('Uzunluk', 'Length'), default: 16, min: 6, max: 64, prompt: t('Varsayılan uzunluk {value} karakter (6-64 arası seçilebilsin).', 'Default length {value} characters (6-64 selectable).') },
      {
        key: 'sets',
        type: 'multi',
        label: t('Karakter türleri', 'Character sets'),
        default: ['upper', 'lower', 'digits', 'symbols'],
        min: 1,
        prompt: t('Karakter türleri (her biri açılıp kapanabilsin, seçili her türden en az bir karakter olsun): {items}.', 'Character sets (each can be toggled; at least one of every selected set): {items}.'),
        options: [
          { value: 'upper', label: t('Büyük harf', 'Upper case') },
          { value: 'lower', label: t('Küçük harf', 'Lower case') },
          { value: 'digits', label: t('Rakam', 'Digits') },
          { value: 'symbols', label: t('Sembol', 'Symbols') },
        ],
      },
      { key: 'noSimilar', type: 'toggle', label: t('Benzer karakterleri çıkar', 'Exclude look-alikes'), default: true, on: t('Benzer karakterleri (0/O, 1/l/I) dışarıda bırakma seçeneği.', 'An option to exclude look-alike characters (0/O, 1/l/I).') },
      { key: 'count', type: 'number', label: t('Aynı anda şifre', 'Passwords at once'), default: 1, min: 1, max: 10, prompt: t('Tek seferde {value} şifre üret.', 'Generate {value} password(s) at once.') },
      { key: 'strength', type: 'toggle', label: t('Güç göstergesi', 'Strength meter'), default: true, on: t('Entropiye göre renkli şifre gücü göstergesi.', 'A coloured strength meter based on entropy.') },
      { key: 'passphrase', type: 'toggle', label: t('Parola cümlesi modu', 'Passphrase mode'), default: false, on: t('Kelimelerden oluşan akılda kalıcı parola modu (arayüz dilinde, uygulamaya gömülü en az 100 kelimelik bir listeyle).', 'A memorable passphrase mode (with a built-in list of at least 100 words in the interface language).') },
    ],
  },
  {
    id: 'renk-paleti',
    category: 'yardimci',
    icon: 'palette',
    title: t('Renk Paleti Üretici', 'Color Palette Generator'),
    description: t('Uyumlu paletler üret, renkleri kilitle, kodları kopyala.', 'Harmonious palettes, lock colours, copy the codes.'),
    designCategory: 'yaratici',
    base: [t('5 renklik palet; her rengin üstünde kodu, tıklayınca kopyalama; Boşluk tuşu veya düğmeyle yeni palet.', 'A five-colour palette with the code on each colour, click to copy; Space or a button for a new palette.')],
    rules: [t('Renk uyumlarını HSL üzerinden hesapla; metin rengini zemine göre okunaklı seç (açık zeminde koyu yazı).', 'Compute harmonies in HSL; pick readable text colour on each swatch.')],
    fields: [
      {
        key: 'harmony',
        type: 'choice',
        label: t('Uyum türü', 'Harmony'),
        default: 'analogous',
        options: [
          { value: 'analogous', label: t('Analog', 'Analogous'), prompt: t('Varsayılan uyum: analog renkler; kullanıcı uyum türünü değiştirebilsin.', 'Default harmony: analogous; the user can switch.') },
          { value: 'complementary', label: t('Tamamlayıcı', 'Complementary'), prompt: t('Varsayılan uyum: tamamlayıcı renkler; kullanıcı uyum türünü değiştirebilsin.', 'Default harmony: complementary; the user can switch.') },
          { value: 'triadic', label: t('Üçlü', 'Triadic'), prompt: t('Varsayılan uyum: üçlü renkler; kullanıcı uyum türünü değiştirebilsin.', 'Default harmony: triadic; the user can switch.') },
          { value: 'mono', label: t('Tek renk', 'Monochrome'), prompt: t('Varsayılan uyum: tek rengin tonları; kullanıcı uyum türünü değiştirebilsin.', 'Default harmony: shades of one hue; the user can switch.') },
        ],
      },
      {
        key: 'formats',
        type: 'multi',
        label: t('Kod biçimleri', 'Code formats'),
        default: ['hex'],
        min: 1,
        prompt: t('Renk kodu biçimleri: {items}.', 'Colour code formats: {items}.'),
        options: [
          { value: 'hex', label: t('HEX', 'HEX') },
          { value: 'rgb', label: t('RGB', 'RGB') },
          { value: 'hsl', label: t('HSL', 'HSL') },
        ],
      },
      { key: 'lock', type: 'toggle', label: t('Renk kilitleme', 'Lock colours'), default: true, on: t('Her rengi kilitleyerek yeni üretimde sabit tutma.', 'Lock a colour to keep it on regenerate.') },
      { key: 'contrast', type: 'toggle', label: t('Kontrast kontrolü', 'Contrast check'), default: false, on: t('Her rengin beyaz ve siyah yazıyla WCAG kontrast oranı.', 'WCAG contrast of each colour with white and black text.') },
      { key: 'css', type: 'toggle', label: t('CSS değişkeni kopyala', 'Copy as CSS'), default: false, on: t('Paleti CSS değişkenleri olarak kopyalama.', 'Copy the palette as CSS variables.') },
    ],
  },
  {
    id: 'metin-araclari',
    category: 'yardimci',
    icon: 'type',
    title: t('Metin Araçları', 'Text Tools'),
    description: t('Sayaç, harf dönüştürme ve metin temizleme araçları.', 'Counter, case converter and cleanup tools.'),
    designCategory: 'teknoloji',
    base: [t('Büyük bir metin alanı ve altında araç düğmeleri; sonuç aynı alana yazılsın, bir Geri al düğmesi olsun.', 'A large text area with tool buttons below; results replace the text, with an Undo button.')],
    rules: [
      t(
        'Harf dönüşümlerinde toLocaleUpperCase / toLocaleLowerCase’i arayüz dilinin yerel ayarıyla kullan (ör. Türkçede i/İ ve ı/I doğru dönüşsün).',
        'Use toLocaleUpperCase / toLocaleLowerCase with the interface language’s locale (e.g. Turkish i/İ and ı/I convert correctly).'
      ),
    ],
    fields: [
      {
        key: 'tools',
        type: 'multi',
        label: t('Araçlar', 'Tools'),
        default: ['counter', 'case', 'spaces', 'dedupe'],
        min: 1,
        prompt: t('Araçlar: {items}.', 'Tools: {items}.'),
        options: [
          { value: 'counter', label: t('Sayaç', 'Counter'), prompt: t('karakter, kelime, satır ve okuma süresi sayacı (yazarken güncellensin)', 'a live counter of characters, words, lines and reading time') },
          { value: 'case', label: t('Harf dönüştürme', 'Case'), prompt: t('BÜYÜK, küçük, Başlık Düzeni ve Cümle düzeni', 'UPPER, lower, Title Case and Sentence case') },
          { value: 'spaces', label: t('Boşluk temizleme', 'Spaces'), prompt: t('fazla boşlukları ve boş satırları temizleme', 'removing extra spaces and blank lines') },
          { value: 'dedupe', label: t('Tekrarları kaldır', 'Dedupe'), prompt: t('tekrarlı satırları kaldırma', 'removing duplicate lines') },
          { value: 'sort', label: t('Satır sıralama', 'Sort lines'), prompt: t('satırları A-Z / Z-A sıralama (localeCompare ile, dilin alfabesine göre)', 'sorting lines A-Z / Z-A (localeCompare, following the language’s alphabet)') },
          { value: 'slug', label: t('URL uyumlu', 'Slug'), prompt: t('aksanlı harfleri sadeleştirip (ç→c, é→e, ß→ss) URL uyumlu metin yapma', 'turning text into a URL slug (ç→c, é→e, ß→ss)') },
        ],
      },
    ],
  },
  {
    id: 'rastgele-secici',
    category: 'yardimci',
    icon: 'dices',
    title: t('Rastgele Seçici', 'Random Picker'),
    description: t('Listeden rastgele seçim: dönen çark, kart çekme veya sade kura.', 'Pick from a list: spinning wheel, card draw or a simple draw.'),
    designCategory: 'eglenceli',
    base: [t('Satır satır seçenek girilen bir liste ve Seç düğmesi; seçilen sonuç büyük görünsün.', 'A list with one option per line and a Pick button; the result is shown large.')],
    rules: [t('Seçimi crypto.getRandomValues ile yap; animasyon sonucu değiştirmesin, önceden seçilen sonuçta dursun.', 'Pick with crypto.getRandomValues; the animation stops on the result chosen beforehand.')],
    fields: [
      {
        key: 'view',
        type: 'choice',
        label: t('Görünüm', 'Style'),
        default: 'wheel',
        options: [
          { value: 'wheel', label: t('Çark', 'Wheel'), prompt: t('Görünüm: canvas üzerinde renkli dilimli, yavaşlayarak duran bir çark.', 'Style: a coloured wheel on canvas that slows down and stops.') },
          { value: 'cards', label: t('Kart', 'Cards'), prompt: t('Görünüm: kartların karışıp birinin açıldığı animasyon.', 'Style: cards shuffle and one is revealed.') },
          { value: 'simple', label: t('Sade', 'Simple'), prompt: t('Görünüm: sade, büyük bir sonuç kutusu.', 'Style: a simple large result box.') },
        ],
      },
      {
        key: 'items',
        type: 'list',
        label: t('Başlangıç seçenekleri', 'Initial options'),
        default: t('Pizza\nMakarna\nSalata\nÇorba', 'Pizza\nPasta\nSalad\nSoup'),
        placeholder: t('Her satıra bir seçenek', 'One option per line'),
        prompt: t('Başlangıç seçenekleri:\n{items}', 'Initial options:\n{items}'),
      },
      { key: 'removePicked', type: 'toggle', label: t('Seçileni çıkar', 'Remove picked'), default: false, on: t('Seçilen seçeneği listeden çıkarma seçeneği.', 'An option to remove the picked item.') },
      { key: 'persist', type: 'toggle', label: t('Listeyi hatırla', 'Remember list'), default: true, on: t('Liste localStorage ile kalıcı olsun.', 'The list is saved in localStorage.') },
    ],
  },

  // ------------------------------------------------------------------ Eğlence & Öğrenme
  {
    id: 'bilgi-yarismasi',
    category: 'eglence',
    icon: 'circle-help',
    title: t('Bilgi Yarışması', 'Quiz'),
    description: t('Çoktan seçmeli sorular, süre, puan ve sonuç ekranı.', 'Multiple choice questions, a timer, score and results.'),
    designCategory: 'eglenceli',
    base: [t('Başlangıç ekranı; soru ekranı (soru, dört şık, ilerleme çubuğu); sonuç ekranı (puan, doğru/yanlış özeti, yeniden başla).', 'A start screen; a question screen (question, four answers, progress bar); a result screen (score, summary, restart).')],
    rules: [t('Şıkların sırasını her oyunda karıştır; doğru cevabı yeşil, yanlışı kırmızı göster ve doğruyu belirt.', 'Shuffle answers every game; mark the right answer green and a wrong pick red.')],
    fields: [
      {
        key: 'source',
        type: 'choice',
        label: t('Sorular', 'Questions'),
        default: 'topic',
        options: [
          { value: 'topic', label: t('Konu vereyim', 'From a topic') },
          { value: 'own', label: t('Kendi sorularım', 'My own') },
        ],
      },
      {
        key: 'topic',
        type: 'text',
        label: t('Konu', 'Topic'),
        default: t('Genel kültür', 'General knowledge'),
        placeholder: t('ör. dünya coğrafyası', 'e.g. world geography'),
        maxLength: 120,
        showIf: { key: 'source', equals: 'topic' },
        prompt: t('Konu: {value}. Bu konuda doğru bilgilere dayanan sorular yaz.', 'Topic: {value}. Write questions based on accurate facts.'),
      },
      { key: 'count', type: 'number', label: t('Soru sayısı', 'Question count'), default: 10, min: 3, max: 30, showIf: { key: 'source', equals: 'topic' }, prompt: t('Soru sayısı: {value}.', 'Number of questions: {value}.') },
      {
        key: 'questions',
        type: 'list',
        label: t('Sorular', 'Questions'),
        default: '',
        placeholder: t('Soru | Doğru cevap | Yanlış 1 | Yanlış 2 | Yanlış 3', 'Question | Right | Wrong 1 | Wrong 2 | Wrong 3'),
        showIf: { key: 'source', equals: 'own' },
        prompt: t('Bu soruları aynen kullan (biçim: soru | doğru | yanlışlar):\n{items}', 'Use exactly these questions (question | right | wrong answers):\n{items}'),
      },
      { key: 'timer', type: 'toggle', label: t('Süre sınırı', 'Time limit'), default: true, on: t('Her soru için 20 saniyelik süre çubuğu; süre bitince soru yanlış sayılsın.', 'A 20-second bar per question; time out counts as wrong.') },
      { key: 'highScore', type: 'toggle', label: t('En yüksek puan', 'High score'), default: true, on: t('En yüksek puanı localStorage ile sakla.', 'Keep the high score in localStorage.') },
    ],
  },
  {
    id: 'bilgi-kartlari',
    category: 'eglence',
    icon: 'layers',
    title: t('Bilgi Kartları', 'Flashcards'),
    description: t('Çevrilen kartlarla ezber: kelime, tanım, soru-cevap.', 'Flip cards to memorise words, definitions and answers.'),
    designCategory: 'eglenceli',
    base: [t('Tıklayınca 3B dönen kart (ön/arka), önceki/sonraki düğmeleri ve ilerleme göstergesi.', 'A card that flips in 3D on click, previous/next buttons and progress.')],
    rules: [],
    fields: [
      {
        key: 'cards',
        type: 'list',
        label: t('Kartlar', 'Cards'),
        default: t('merhaba | hello\nteşekkürler | thank you\nlütfen | please', 'hello | hola\nthank you | gracias\nplease | por favor'),
        placeholder: t('ön yüz | arka yüz', 'front | back'),
        prompt: t('Başlangıç kartları (ön | arka):\n{items}', 'Initial cards (front | back):\n{items}'),
      },
      { key: 'shuffle', type: 'toggle', label: t('Karıştır', 'Shuffle'), default: true, on: t('Karıştırma düğmesi.', 'A shuffle button.') },
      { key: 'mark', type: 'toggle', label: t('Bildim / Tekrar', 'Known / Again'), default: true, on: t('Bildim / Tekrar et işaretleme; tekrar edilecekler sonra yeniden gelsin.', 'Known / Again marking; cards to repeat come back later.') },
      { key: 'edit', type: 'toggle', label: t('Kart düzenleme', 'Edit cards'), default: true, on: t('Uygulama içinden kart ekleme ve düzenleme; kartlar localStorage ile kalıcı.', 'Add and edit cards in the app; saved in localStorage.') },
    ],
  },
  {
    id: 'yazma-hizi',
    category: 'eglence',
    icon: 'keyboard',
    title: t('Yazma Hızı Testi', 'Typing Speed Test'),
    description: t('Dakikadaki kelime (WPM), doğruluk ve en iyi skor.', 'Words per minute, accuracy and the best score.'),
    designCategory: 'teknoloji',
    base: [
      t('Yazılacak metin, harf harf doğru/yanlış renklendirme, süre, WPM ve doğruluk; bitince sonuç kartı.', 'The text to type, per-letter right/wrong colouring, time, WPM and accuracy; a result card at the end.'),
      t('Metinler arayüz dilinde olsun; uygulamaya gömülü en az 10 farklı cümle.', 'Texts in the interface language; at least 10 built-in sentences.'),
    ],
    rules: [],
    fields: [
      {
        key: 'duration',
        type: 'choice',
        label: t('Süre', 'Duration'),
        default: '60',
        options: [
          { value: '30', label: t('30 sn', '30 s'), prompt: t('Test süresi 30 saniye.', 'The test lasts 30 seconds.') },
          { value: '60', label: t('60 sn', '60 s'), prompt: t('Test süresi 60 saniye.', 'The test lasts 60 seconds.') },
          { value: '120', label: t('120 sn', '120 s'), prompt: t('Test süresi 120 saniye.', 'The test lasts 120 seconds.') },
        ],
      },
      { key: 'best', type: 'toggle', label: t('En iyi skor', 'Best score'), default: true, on: t('En iyi skoru localStorage ile sakla.', 'Keep the best score in localStorage.') },
    ],
  },
  {
    id: 'hafiza-oyunu',
    category: 'eglence',
    icon: 'brain',
    title: t('Hafıza Oyunu', 'Memory Game'),
    description: t('Eşleşen kartları bul; hamle sayacı, süre ve zorluk.', 'Find matching pairs; moves, time and difficulty.'),
    designCategory: 'eglenceli',
    base: [t('Ters çevrilmiş kartlardan oluşan ızgara; iki kart açılır, eşleşmezse kısa süre sonra kapanır; bütün eşler bulununca tebrik ekranı.', 'A grid of face-down cards; two open at a time and close again if they do not match; a congratulations screen at the end.')],
    rules: [t('Kartları Fisher-Yates ile karıştır; iki kart açıkken üçüncü tıklamayı yok say.', 'Shuffle with Fisher-Yates; ignore a third click while two cards are open.')],
    fields: [
      {
        key: 'grid',
        type: 'choice',
        label: t('Zorluk', 'Difficulty'),
        default: '4x4',
        options: [
          { value: '4x4', label: t('Kolay 4×4', 'Easy 4×4'), prompt: t('Izgara 4×4.', 'Grid 4×4.') },
          { value: '4x5', label: t('Orta 4×5', 'Medium 4×5'), prompt: t('Izgara 4×5.', 'Grid 4×5.') },
          { value: '6x6', label: t('Zor 6×6', 'Hard 6×6'), prompt: t('Izgara 6×6.', 'Grid 6×6.') },
        ],
      },
      {
        key: 'symbols',
        type: 'choice',
        label: t('Kart yüzleri', 'Card faces'),
        default: 'shapes',
        options: [
          { value: 'shapes', label: t('Şekiller', 'Shapes'), prompt: t('Kart yüzlerinde CSS veya SVG ile çizilmiş renkli şekiller.', 'Coloured shapes drawn with CSS or SVG on the faces.') },
          { value: 'numbers', label: t('Sayılar', 'Numbers'), prompt: t('Kart yüzlerinde büyük sayılar.', 'Large numbers on the faces.') },
          { value: 'letters', label: t('Harfler', 'Letters'), prompt: t('Kart yüzlerinde harfler.', 'Letters on the faces.') },
        ],
      },
      { key: 'stats', type: 'toggle', label: t('Hamle ve süre', 'Moves and time'), default: true, on: t('Hamle sayacı ve süre.', 'A move counter and a timer.') },
      { key: 'best', type: 'toggle', label: t('En iyi skor', 'Best score'), default: true, on: t('Her zorluk için en iyi skoru localStorage ile sakla.', 'Keep the best score per difficulty in localStorage.') },
    ],
  },
  {
    id: 'yilan-oyunu',
    category: 'eglence',
    icon: 'gamepad-2',
    title: t('Yılan Oyunu', 'Snake'),
    description: t('Klasik yılan: yem ye, büyü, rekoru kır.', 'Classic snake: eat, grow, beat the record.'),
    designCategory: 'teknoloji',
    base: [t('Canvas üzerinde ızgara tabanlı oyun; ok tuşları ve WASD ile kontrol; skor, oyun bitti ekranı; Boşluk ile duraklat.', 'A grid-based canvas game controlled by arrows and WASD; score, a game over screen; Space pauses.')],
    rules: [t('Oyun döngüsünü requestAnimationFrame ve sabit adım süresiyle kur; yılan ters yöne anında dönemesin.', 'Use requestAnimationFrame with a fixed step; the snake cannot reverse instantly.')],
    fields: [
      {
        key: 'speed',
        type: 'choice',
        label: t('Hız', 'Speed'),
        default: 'normal',
        options: [
          { value: 'slow', label: t('Yavaş', 'Slow'), prompt: t('Başlangıç hızı yavaş.', 'Starting speed: slow.') },
          { value: 'normal', label: t('Normal', 'Normal'), prompt: t('Başlangıç hızı normal.', 'Starting speed: normal.') },
          { value: 'fast', label: t('Hızlı', 'Fast'), prompt: t('Başlangıç hızı hızlı.', 'Starting speed: fast.') },
        ],
      },
      {
        key: 'walls',
        type: 'choice',
        label: t('Duvarlar', 'Walls'),
        default: 'die',
        options: [
          { value: 'die', label: t('Çarpınca biter', 'Deadly'), prompt: t('Duvara çarpınca oyun biter.', 'Hitting a wall ends the game.') },
          { value: 'wrap', label: t('Geçilebilir', 'Wrap around'), prompt: t('Yılan kenardan çıkınca karşı taraftan girsin.', 'The snake wraps around the edges.') },
        ],
      },
      { key: 'speedUp', type: 'toggle', label: t('Giderek hızlan', 'Speed up'), default: true, on: t('Her yemde hız hafifçe artsın.', 'Each food speeds the game up a little.') },
      { key: 'touch', type: 'toggle', label: t('Dokunmatik kontrol', 'Touch controls'), default: true, on: t('Mobil için ekran üstü yön düğmeleri ve kaydırma (swipe) desteği.', 'On-screen arrows and swipe support for phones.') },
      { key: 'highScore', type: 'toggle', label: t('En yüksek skor', 'High score'), default: true, on: t('En yüksek skoru localStorage ile sakla.', 'Keep the high score in localStorage.') },
    ],
  },
];

export function getMiniApp(id: string | null | undefined): MiniAppDef | undefined {
  return MINI_APPS.find((a) => a.id === id);
}

export interface MiniAppCommon {
  /** App title shown in the page ('' = the tool's name). */
  title: string;
  /** Interface language of the app (the request is written in it too). */
  language: Lang;
  /** 'auto' (by the tool), 'none' or a theme id. */
  theme: string;
  /** Extra wishes (optional; the wizard leaves them to the composer). */
  notes?: string;
}

export interface CompiledTool {
  prompt: string;
  displayGoal: string;
  design: DesignOverride;
  checklist: string[];
  contracts: boolean;
  /** Files the run writes before the model's first step (scripts: the safety module). */
  seedFiles?: Array<{ path: string; content: string }>;
  /** Files only the generated program may create (scripts: its log and backups). */
  scriptOutputs?: string[];
  /** The flag with which the generated script changes files (scripts: --uygula / --apply). */
  applyFlag?: string;
}

/** The request for a single-file web tool. */
export function compileMiniAppPrompt(app: MiniAppDef, values: ParamValues, common: MiniAppCommon): CompiledTool {
  const lang = common.language;
  const L = (tr: string, en: string) => (lang === 'en' ? en : tr);
  const kind = tx(app.title, lang);
  const title = common.title.trim() || kind;
  const merged = { ...defaultValues(app.fields, lang), ...values };
  const lines: string[] = [];
  // "Pomodoro Zamanlayıcı" named after the tool needs no second mention of the tool.
  const what = title === kind ? tx(app.description, lang) : `${kind} — ${tx(app.description, lang)}`;

  lines.push(L(`"${title}" adında tek dosyalık bir web uygulaması oluştur: ${what}`, `Create a single-file web app called "${title}": ${what}`));
  lines.push(
    '',
    L('DOSYA', 'FILE'),
    L(
      '- Tek dosya: index.html. CSS <style> içinde, JavaScript <script> içinde olsun; harici kütüphane, yazı tipi veya görsel dosyası kullanma, internet gerektirmesin.',
      '- One file: index.html with the CSS in <style> and the JavaScript in <script>; no external libraries, fonts or image files, no internet needed.'
    ),
    L(`- Sayfa başlığı (<title>) ve uygulamanın üst başlığı: "${title}".`, `- Page <title> and app heading: "${title}".`),
    L('- Arayüzdeki tüm metinler Türkçe olsun.', '- All interface text is in English.')
  );

  lines.push('', L('ÖZELLİKLER', 'FEATURES'));
  for (const b of app.base) lines.push(`- ${tx(b, lang)}`);
  for (const d of describeValues(app.fields, merged, lang)) lines.push(`- ${d.replace(/\n/g, '\n  ')}`);

  lines.push('', L('KURALLAR', 'RULES'));
  for (const r of app.rules) lines.push(`- ${tx(r, lang)}`);
  lines.push(
    L(
      '- Telefonda ve bilgisayarda düzgün görünen, ortalanmış, ferah bir arayüz; düğmeler büyük ve kolay tıklanır olsun.',
      '- A centred, airy interface that works on phones and desktops; big, easy-to-hit buttons.'
    ),
    L(
      '- Klavyeyle kullanılabilir olsun; hataları kullanıcıya anlaşılır bir mesajla göster; konsolda hata kalmasın.',
      '- Keyboard friendly; show errors as clear messages; no errors in the console.'
    ),
    L('- Kodu okunaklı fonksiyonlara böl ve kısa açıklamalar ekle.', '- Split the code into readable functions with short comments.')
  );

  if (common.notes?.trim()) lines.push('', L('EK İSTEKLER', 'EXTRA WISHES'), `"""\n${common.notes.trim()}\n"""`);

  let design: DesignOverride;
  if (common.theme === 'none') design = { enabled: false };
  else if (common.theme !== 'auto' && getTheme(common.theme)) design = { enabled: true, themeId: common.theme, category: getTheme(common.theme)!.category };
  else design = { enabled: true, themeId: null, category: app.designCategory };
  const themeName = design.enabled ? (design.themeId ? getTheme(design.themeId)!.name : L('otomatik', 'automatic')) : L('yok', 'none');

  return {
    prompt: lines.join('\n'),
    displayGoal: L(
      `Mini Uygulama: ${title === kind ? title : `"${title}" (${kind})`} · tema: ${themeName}`,
      `Mini app: ${title === kind ? title : `"${title}" (${kind})`} · theme: ${themeName}`
    ),
    design,
    checklist: [],
    contracts: true,
  };
}
