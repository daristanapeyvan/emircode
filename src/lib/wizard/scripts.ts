/**
 * scripts.ts — catalog and request compiler of the Script wizard: small command line tools that
 * work on the user's files (renaming, sorting, CSV merging, searching...).
 *
 * Scripts touch real files, so every request carries fixed safety rules: preview by default
 * (changes only with --uygula / --apply), nothing is ever deleted, files are backed up before
 * they change, the script never leaves the given folder and every action is logged. With "test
 * with sample data" the model builds a small sample folder, runs the script on it and checks a
 * stated result. Flags and file names follow the request language, so English users get
 * --apply and actions_log.csv, Turkish users --uygula and islem_kaydi.csv.
 */
import type { DesignOverride } from '../design/DesignTheme';
import type { ToolCategory, CompiledTool } from './miniApps';
import { ParamField, ParamValues, Text, Lang, tx, describeValues, defaultValues, valueOf } from './params';
import { scriptHelper, scriptTemplate, helperFileName } from './scriptSkeleton';

export type ScriptLanguage = 'python' | 'node';

export interface ScriptDef {
  id: string;
  category: string;
  icon: string;
  title: Text;
  description: Text;
  /** Default file name without extension. */
  fileName: Text;
  /** Changes or moves the user's files (preview, backup and undo rules apply). */
  modifies: boolean;
  /** Example command arguments after the script name. */
  usage: Text;
  base: Text[];
  rules: Text[];
  fields: ParamField[];
  /** Sample data for the test run and the result to check. */
  sample: { files: Text; expect: Text };
  /** A live result the wizard shows under the fields. */
  preview?: 'rename';
  /** Languages the script can be written in without third-party packages (default: all). */
  languages?: ScriptLanguage[];
  /** Complete example code for the core of plan() per language: the part small models get wrong. */
  planHint?: { python: Text; node: Text };
}

const t = (tr: string, en: string): Text => ({ tr, en });

/** File and flag names the safety rules use, in the request language. */
export const SCRIPT_NAMES: Record<Lang, { apply: string; undo: string; backup: string; log: string; sample: string }> = {
  tr: { apply: '--uygula', undo: '--geri-al', backup: '_yedek_YYYYAAGG_SSDDss', log: 'islem_kaydi.csv', sample: 'ornek_veri' },
  en: { apply: '--apply', undo: '--undo', backup: '_backup_YYYYMMDD_HHMMSS', log: 'actions_log.csv', sample: 'sample_data' },
};

export const SCRIPT_CATEGORIES: ToolCategory[] = [
  { id: 'dosya', icon: 'folder-open', title: t('Dosya & Klasör', 'Files & Folders') },
  { id: 'veri', icon: 'sheet', title: t('Veri', 'Data') },
  { id: 'metin', icon: 'file-text', title: t('Metin', 'Text') },
];

const extensions = (def: string): ParamField => ({
  key: 'extensions',
  type: 'text',
  label: t('Dosya uzantıları', 'File extensions'),
  hint: t('Boş bırakılırsa tüm dosyalar', 'Empty = all files'),
  default: def,
  placeholder: t('ör. jpg, png', 'e.g. jpg, png'),
  maxLength: 120,
  prompt: t('Yalnızca şu uzantılardaki dosyalar işlensin (büyük/küçük harf fark etmez): {value}.', 'Only process files with these extensions (case-insensitive): {value}.'),
});

const recursive = (on: boolean): ParamField => ({
  key: 'recursive',
  type: 'toggle',
  label: t('Alt klasörler dahil', 'Include subfolders'),
  default: on,
  on: t('Alt klasörlerdeki dosyalar da işlensin (betiğin kendi yedek ve kayıt dosyaları hariç).', 'Process subfolders too (except the script’s own backup and log files).'),
  off: t('Yalnızca klasörün kendisindeki dosyalar işlensin; alt klasörlere girme.', 'Only the files directly in the folder; do not enter subfolders.'),
});

/** Off by default: small models handle the core tool better without it; the action log keeps undo possible by hand. */
const UNDO: ParamField = {
  key: 'undo',
  type: 'toggle',
  label: t('Geri alma', 'Undo'),
  default: false,
  on: t(
    '--geri-al seçeneği: islem_kaydi.csv dosyasındaki son çalıştırmanın taşıma/adlandırma işlemlerini tersine çevirsin (önce önizleme, --uygula ile gerçekleştirme).',
    '--undo option: reverts the moves/renames of the last run recorded in actions_log.csv (preview first, applied with --apply).'
  ),
};

/** CSV output for Excel: the separator Excel expects depends on the region (decimal comma or point). */
const SEPARATOR: ParamField = {
  key: 'separator',
  type: 'choice',
  label: t('CSV ayırıcısı', 'CSV separator'),
  default: t('semicolon', 'comma'),
  options: [
    { value: 'semicolon', label: t('Noktalı virgül ;', 'Semicolon ;'), prompt: t('CSV çıktısını ; ayırıcıyla ve UTF-8 BOM ile yaz (ondalık virgül kullanan bölgelerde Excel doğrudan açsın).', 'Write CSV output with ";" and a UTF-8 BOM (opens directly in Excel in decimal-comma regions).') },
    { value: 'comma', label: t('Virgül ,', 'Comma ,'), prompt: t('CSV çıktısını , ayırıcıyla ve UTF-8 BOM ile yaz (ondalık nokta kullanan bölgelerde Excel doğrudan açsın).', 'Write CSV output with "," and a UTF-8 BOM (opens directly in Excel in decimal-point regions).') },
    { value: 'tab', label: t('Sekme', 'Tab'), prompt: t('Çıktıyı sekmeyle ayrılmış (.tsv) ve UTF-8 olarak yaz.', 'Write the output tab-separated (.tsv) in UTF-8.') },
  ],
};

export const SCRIPTS: ScriptDef[] = [
  // ------------------------------------------------------------------ Dosya & Klasör
  {
    id: 'toplu-adlandir',
    category: 'dosya',
    icon: 'files',
    title: t('Toplu Yeniden Adlandırma', 'Bulk Rename'),
    description: t('Klasördeki dosyaları bir ad kalıbına göre sırayla adlandır.', 'Rename the files of a folder with a name pattern.'),
    fileName: t('toplu_adlandir', 'bulk_rename'),
    modifies: true,
    usage: t('<klasör> [--kalip "{ad}_{sayac:03}"] [--uygula]', '<folder> [--pattern "{name}_{n:03}"] [--apply]'),
    base: [
      t('Klasördeki dosyaları bir ad kalıbına göre yeniden adlandır; önizlemede her dosya için "eski ad → yeni ad" satırı göster.', 'Rename the files with a name pattern; the preview shows an "old name → new name" line per file.'),
      t(
        'Kalıp değişkenleri: {ad} (uzantısız eski ad), {uzanti} (noktasız uzantı), {sayac} veya {sayac:03} (sıra numarası, :03 = 3 haneye sıfırla doldur), {tarih} (değiştirilme tarihi, YYYY-AA-GG). İngilizce adları da aynı anlamda kabul edilsin: {name}, {ext}, {n}, {date}. Uzantı her zaman korunur; kalıp yalnızca adın yerine geçer.',
        'Pattern variables: {name} (old name without extension), {ext} (extension without the dot), {n} or {n:03} (counter, :03 = pad to 3 digits), {date} (modification date, YYYY-MM-DD). The extension is always kept; the pattern replaces the name only.'
      ),
    ],
    rules: [
      t('Hedef ad zaten varsa veya iki dosya aynı ada çıkıyorsa üzerine yazma; o dosyayı atla ve nedenini yaz.', 'Never overwrite: if the target exists or two files get the same name, skip that file and say why.'),
      t('Windows’ta geçersiz karakterleri (\\ / : * ? " < > |) adlardan çıkar.', 'Remove characters that are invalid on Windows (\\ / : * ? " < > |).'),
      t('Yalnızca harf büyüklüğü değişen adlarda (Windows büyük/küçük harf ayırmaz) önce geçici bir ada, sonra hedef ada taşı.', 'For case-only renames (Windows ignores case) rename to a temporary name first, then to the target.'),
    ],
    fields: [
      {
        key: 'pattern',
        type: 'text',
        label: t('Ad kalıbı', 'Name pattern'),
        default: t('{ad}_{sayac:03}', '{name}_{n:03}'),
        placeholder: t('ör. tatil_{sayac:03}', 'e.g. holiday_{n:03}'),
        maxLength: 80,
        prompt: t('Varsayılan kalıp "{value}" olsun; --kalip ile değiştirilebilsin.', 'Default pattern "{value}"; changeable with --pattern.'),
      },
      { key: 'start', type: 'number', label: t('Sayaç başlangıcı', 'Counter start'), default: 1, min: 0, max: 100000, prompt: t('Sayaç {value} değerinden başlasın (--baslangic ile değiştirilebilsin).', 'The counter starts at {value} (--start changes it).') },
      {
        key: 'order',
        type: 'choice',
        label: t('Sıralama', 'Order'),
        default: 'name',
        options: [
          { value: 'name', label: t('Ada göre', 'By name'), prompt: t('Dosyaları sayaç için ada göre doğal sırala (2 < 10).', 'Number files in natural name order (2 < 10).') },
          { value: 'date', label: t('Tarihe göre', 'By date'), prompt: t('Dosyaları sayaç için değiştirilme tarihine göre (eskiden yeniye) sırala.', 'Number files by modification date (oldest first).') },
          { value: 'size', label: t('Boyuta göre', 'By size'), prompt: t('Dosyaları sayaç için boyuta göre (küçükten büyüğe) sırala.', 'Number files by size (smallest first).') },
        ],
      },
      {
        key: 'case',
        type: 'choice',
        label: t('Harf', 'Case'),
        default: 'keep',
        options: [
          { value: 'keep', label: t('Aynen', 'Keep') },
          { value: 'lower', label: t('küçük', 'lower'), prompt: t('Yeni adları uzantı dahil küçük harfe çevir (Türkçe kurallarıyla: İ→i, I→ı).', 'Lower-case the new names including the extension.') },
          { value: 'upper', label: t('BÜYÜK', 'UPPER'), prompt: t('Yeni adları uzantı dahil büyük harfe çevir (Türkçe kurallarıyla: i→İ, ı→I).', 'Upper-case the new names including the extension.') },
        ],
      },
      {
        key: 'ascii',
        type: 'toggle',
        label: t('Aksanlı harfleri ve boşlukları sadeleştir', 'Simplify accents and spaces'),
        default: false,
        on: t('Yeni adlarda aksanlı harfleri sadeleştir (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u, é→e, ß→ss) ve boşlukları _ yap.', 'In new names replace accented letters (é→e, ü→u, ç→c, ß→ss) and spaces with _.'),
      },
      extensions(''),
      recursive(false),
      UNDO,
    ],
    sample: {
      files: t('ornek_veri/ içinde kısa metinli dosyalar: "Tatil 2.jpg", "Tatil 10.jpg", "deniz.JPG", "notlar.txt"', 'small text files in sample_data/: "Holiday 2.jpg", "Holiday 10.jpg", "beach.JPG", "notes.txt"'),
      expect: t('önizleme hiçbir dosyayı değiştirmez; --uygula sonrası adlar kalıba uyar, uzantılar korunur, dosya sayısı 4 kalır ve betik islem_kaydi.csv dosyasını yazar', 'the preview changes nothing; after --apply the names follow the pattern, extensions are kept, there are still 4 files and the script writes actions_log.csv'),
    },
    preview: 'rename',
    planHint: {
      python: t(
        "dosyalar = [d for d in sorted(target.iterdir(), key=natural_key) if d.is_file()]` ve `for n, dosya in enumerate(dosyalar, start=args.baslangic):` içinde `yeni_ad = args.kalip.format(ad=dosya.stem, uzanti=dosya.suffix[1:], sayac=n)` ile `actions.append(rename(dosya, dosya.with_name(yeni_ad + dosya.suffix)))",
        "files = [f for f in sorted(target.iterdir(), key=natural_key) if f.is_file()]` and `for n, file in enumerate(files, start=args.start):` with `new_name = args.pattern.format(name=file.stem, ext=file.suffix[1:], n=n)` and `actions.append(rename(file, file.with_name(new_name + file.suffix)))"
      ),
      node: t(
        "const dosyalar = fs.readdirSync(target).map((ad) => path.join(target, ad)).filter((d) => fs.statSync(d).isFile()).sort(naturalCompare)` ve her dosya için (n = başlangıç + sıra) `const yeniAd = kalip.replace(/\\{ad\\}/g, path.parse(dosya).name)...` ile `actions.push(rename(dosya, path.join(path.dirname(dosya), yeniAd + path.extname(dosya))))",
        "const files = fs.readdirSync(target).map((n) => path.join(target, n)).filter((f) => fs.statSync(f).isFile()).sort(naturalCompare)` and for every file (n = start + index) `const newName = pattern.replace(/\\{name\\}/g, path.parse(file).name)...` then `actions.push(rename(file, path.join(path.dirname(file), newName + path.extname(file))))"
      ),
    },
  },
  {
    id: 'klasor-duzenle',
    category: 'dosya',
    icon: 'folder-tree',
    title: t('Klasör Düzenleyici', 'Folder Organizer'),
    description: t('Dağınık dosyaları türüne veya tarihine göre alt klasörlere taşı.', 'Move loose files into subfolders by type or date.'),
    fileName: t('klasor_duzenle', 'organize_folder'),
    modifies: true,
    usage: t('<klasör> [--uygula]', '<folder> [--apply]'),
    base: [t('Klasördeki dosyaları seçilen ölçüte göre alt klasörlere taşı; önizlemede her dosya için "dosya → hedef klasör" satırı ve klasör başına sayılar göster.', 'Move the files into subfolders; the preview shows "file → target folder" lines and counts per folder.')],
    rules: [t('Hedefte aynı adlı dosya varsa üzerine yazma; adın sonuna " (2)" gibi bir ek koy.', 'Never overwrite; add a suffix like " (2)" when the name is taken.')],
    fields: [
      {
        key: 'by',
        type: 'choice',
        label: t('Ölçüt', 'Sort by'),
        default: 'type',
        options: [
          {
            value: 'type',
            label: t('Türe göre', 'By type'),
            prompt: t(
              'Türe göre klasörle: Resimler (jpg, jpeg, png, gif, webp, heic), Belgeler (pdf, doc, docx, txt, odt, rtf), Tablolar (xls, xlsx, csv, ods), Sunumlar (ppt, pptx, odp), Videolar (mp4, mov, avi, mkv), Sesler (mp3, wav, m4a, flac), Arşivler (zip, rar, 7z), Diğer.',
              'Group by type: Images (jpg, jpeg, png, gif, webp, heic), Documents (pdf, doc, docx, txt, odt, rtf), Spreadsheets (xls, xlsx, csv, ods), Presentations (ppt, pptx, odp), Videos (mp4, mov, avi, mkv), Audio (mp3, wav, m4a, flac), Archives (zip, rar, 7z), Other.'
            ),
          },
          { value: 'ext', label: t('Uzantıya göre', 'By extension'), prompt: t('Her uzantı için bir klasör aç (ör. PDF, JPG); uzantısızlar "Diğer" klasörüne.', 'One folder per extension (e.g. PDF, JPG); files without one go to "Other".') },
          { value: 'month', label: t('Aya göre', 'By month'), prompt: t('Değiştirilme tarihine göre YYYY-AA klasörlerine taşı.', 'Move into YYYY-MM folders by modification date.') },
          { value: 'year', label: t('Yıla göre', 'By year'), prompt: t('Değiştirilme tarihine göre YYYY klasörlerine taşı.', 'Move into YYYY folders by modification date.') },
        ],
      },
      { key: 'skipHidden', type: 'toggle', label: t('Gizli dosyaları atla', 'Skip hidden files'), default: true, on: t('Gizli dosyaları (. ile başlayanlar, desktop.ini, Thumbs.db, .DS_Store) atla.', 'Skip hidden files (starting with ".", desktop.ini, Thumbs.db, .DS_Store).') },
      UNDO,
    ],
    planHint: {
      python: t("actions.append(move(dosya, root / klasor_adi / dosya.name))", "actions.append(move(file, root / folder_name / file.name))"),
      node: t("actions.push(move(dosya, path.join(root, klasorAdi, path.basename(dosya))));", "actions.push(move(file, path.join(root, folderName, path.basename(file))));"),
    },
    sample: {
      files: t('ornek_veri/ içinde küçük dosyalar: "foto.jpg", "rapor.pdf", "liste.csv", "muzik.mp3", "benioku"', 'small files in sample_data/: "photo.jpg", "report.pdf", "list.csv", "song.mp3", "readme"'),
      expect: t('önizleme hiçbir dosyayı taşımaz; --uygula sonrası her dosya ölçüte uygun alt klasördedir, toplam dosya sayısı değişmez', 'the preview moves nothing; after --apply every file is in the right subfolder and the file count is unchanged'),
    },
  },
  {
    id: 'yinelenen-dosya',
    category: 'dosya',
    icon: 'copy',
    title: t('Yinelenen Dosya Bulucu', 'Duplicate Finder'),
    description: t('İçeriği aynı olan dosyaları bul, raporla, istersen ayrı klasöre taşı.', 'Find files with identical content, report them, optionally move them aside.'),
    fileName: t('yinelenen_bul', 'find_duplicates'),
    modifies: true,
    usage: t('<klasör> [--tasi] [--uygula]', '<folder> [--move] [--apply]'),
    base: [
      t('Dosyaları önce boyuta göre grupla, yalnızca aynı boyuttakilerin SHA-256 özetini parça parça (büyük dosyalarda belleği doldurmadan) hesapla.', 'Group files by size first and hash only same-size files with SHA-256, reading in chunks.'),
      t('Her yinelenen grup için dosya yollarını, boyutu ve kazanılacak alanı gösteren bir rapor; en sonda toplam kazanılabilecek alan.', 'A report per duplicate group with paths, size and the space to gain; the total at the end.'),
    ],
    rules: [t('Her gruptan bir dosyayı (en eski olanı) asıl kabul et ve ona hiç dokunma.', 'Keep one file of every group (the oldest) and never touch it.')],
    fields: [
      {
        key: 'action',
        type: 'choice',
        label: t('Bulunanlar', 'Duplicates'),
        default: 'report',
        options: [
          { value: 'report', label: t('Yalnızca rapor', 'Report only'), prompt: t('Yalnızca rapor üret; hiçbir dosyayı taşıma. Raporu yinelenenler.csv olarak da yaz.', 'Only report; move nothing. Also write the report to duplicates.csv.') },
          { value: 'move', label: t('Ayrı klasöre taşı', 'Move aside'), prompt: t('--tasi ile, asıl dosya dışındaki kopyaları klasör yapısını koruyarak _yinelenenler/ klasörüne taşı (silme yok).', 'With --move, move the extra copies to _duplicates/ keeping the folder structure (no deleting).') },
        ],
      },
      { key: 'minSize', type: 'number', label: t('En küçük boyut', 'Minimum size'), default: 1, min: 0, max: 100000, unit: t('KB', 'KB'), prompt: t('{value} KB’tan küçük dosyaları atla.', 'Skip files smaller than {value} KB.') },
      recursive(true),
    ],
    planHint: {
      python: t("actions.append(move(kopya, root / '_yinelenenler' / kopya.relative_to(root)))", "actions.append(move(copy, root / '_duplicates' / copy.relative_to(root)))"),
      node: t("actions.push(move(kopya, path.join(root, '_yinelenenler', path.relative(root, kopya))));", "actions.push(move(copy, path.join(root, '_duplicates', path.relative(root, copy))));"),
    },
    sample: {
      files: t('ornek_veri/ içinde: "a.txt" (merhaba), "kopya/a_yedek.txt" (merhaba), "b.txt" (dünya)', 'in sample_data/: "a.txt" (hello), "copy/a_old.txt" (hello), "b.txt" (world)'),
      expect: t('rapor tek bir yinelenen grup bulur (a.txt ve kopya/a_yedek.txt); b.txt raporda yoktur (deneme için en küçük boyutu 0 ver)', 'the report finds one duplicate group (a.txt and copy/a_old.txt); b.txt is not in it (use minimum size 0 for the test)'),
    },
  },
  {
    id: 'klasor-yedekle',
    category: 'dosya',
    icon: 'archive',
    title: t('Klasör Yedekleme', 'Folder Backup'),
    description: t('Bir klasörü tarihli ZIP dosyası olarak yedekle.', 'Back up a folder as a dated ZIP file.'),
    fileName: t('klasor_yedekle', 'backup_folder'),
    modifies: false,
    usage: t('<klasör> [--hedef <yedek klasörü>]', '<folder> [--target <backup folder>]'),
    base: [
      t('Klasörü klasöradı_YYYYAAGG_SSDDss.zip adında sıkıştırılmış bir yedeğe dönüştür; bitince dosya sayısını ve ZIP boyutunu yaz.', 'Create a compressed backup named foldername_YYYYMMDD_HHMMSS.zip; print the file count and ZIP size at the end.'),
      t('Hedef klasör verilmezse yedeği kaynak klasörün yanına (üst klasöre) koy; yedeği asla yedeklenen klasörün içine yazma.', 'Without a target put the backup next to the source (in its parent); never inside the folder being backed up.'),
    ],
    rules: [
      t('Mevcut yedekleri silme veya üzerine yazma.', 'Never delete or overwrite existing backups.'),
      t('Açılamayan dosyaları atla, sonda listele ve betik yine de kalan dosyaları yedeklesin.', 'Skip files that cannot be read, list them at the end and back up the rest.'),
    ],
    fields: [
      {
        key: 'exclude',
        type: 'list',
        label: t('Hariç tutulacaklar', 'Exclude'),
        default: 'node_modules\n.git\n__pycache__\n*.tmp',
        placeholder: t('Her satıra bir klasör adı veya kalıp', 'One folder name or pattern per line'),
        prompt: t('Şu klasör adları ve kalıplar yedeğe alınmasın:\n{items}', 'Exclude these folder names and patterns:\n{items}'),
      },
      { key: 'verify', type: 'toggle', label: t('Yedeği doğrula', 'Verify backup'), default: true, on: t('Bitince ZIP dosyasını açıp bütünlüğünü test et (testzip) ve sonucu yaz.', 'Test the ZIP integrity at the end (testzip) and print the result.') },
    ],
    sample: {
      files: t('ornek_veri/ içinde birkaç küçük dosya ve bir alt klasör, ayrıca hariç tutulması gereken ornek_veri/node_modules/x.js', 'a few small files and a subfolder in sample_data/, plus sample_data/node_modules/x.js that must be excluded'),
      expect: t('ornek_veri’nin yanında tarihli bir ZIP oluşur, içinde node_modules yoktur ve doğrulama başarılıdır', 'a dated ZIP appears next to sample_data without node_modules and the check passes'),
    },
    // Node.js has no built-in ZIP writer; Python has zipfile.
    languages: ['python'],
  },
  {
    id: 'boyut-raporu',
    category: 'dosya',
    icon: 'hard-drive',
    title: t('Klasör Boyutu Raporu', 'Folder Size Report'),
    description: t('Diskte en çok yer kaplayan klasör ve dosyaları listele.', 'List the folders and files that use the most space.'),
    fileName: t('boyut_raporu', 'size_report'),
    modifies: false,
    usage: t('<klasör> [--ilk 20]', '<folder> [--top 20]'),
    base: [
      t('Alt klasörlerin toplam boyutlarını hesapla; en büyük klasörleri ve en büyük dosyaları okunaklı birimlerle (KB, MB, GB) ve yüzde payıyla listele.', 'Sum the size of every subfolder; list the largest folders and files with readable units (KB, MB, GB) and their share.'),
      t('Erişilemeyen klasörleri atla ve sonda say.', 'Skip folders that cannot be read and count them at the end.'),
    ],
    rules: [],
    fields: [
      { key: 'top', type: 'number', label: t('Listelenecek sayı', 'How many'), default: 20, min: 5, max: 200, prompt: t('Varsayılan olarak ilk {value} kaydı göster (--ilk ile değiştirilebilsin).', 'Show the top {value} entries by default (--top changes it).') },
      { key: 'byType', type: 'toggle', label: t('Türe göre dağılım', 'By file type'), default: true, on: t('Uzantılara göre toplam boyut dağılımını da göster.', 'Also show the total size per extension.') },
      { key: 'csv', type: 'toggle', label: t('CSV rapor', 'CSV report'), default: false, on: t('Raporu boyut_raporu.csv dosyasına da yaz.', 'Also write the report to size_report.csv.') },
    ],
    sample: {
      files: t('ornek_veri/ içinde farklı boyutlarda birkaç dosya ve iki alt klasör (içerikleri betikle yazılabilir)', 'a few files of different sizes and two subfolders in sample_data/'),
      expect: t('rapor klasörleri ve dosyaları doğru toplam boyutlarla büyükten küçüğe sıralar', 'the report lists folders and files largest first with correct totals'),
    },
  },

  // ------------------------------------------------------------------ Veri
  {
    id: 'csv-birlestir',
    category: 'veri',
    icon: 'merge',
    title: t('CSV Birleştirme', 'Merge CSV Files'),
    description: t('Klasördeki tüm CSV dosyalarını tek bir tabloda birleştir.', 'Combine every CSV file of a folder into one table.'),
    fileName: t('csv_birlestir', 'merge_csv'),
    modifies: false,
    usage: t('<klasör> [--cikti birlesik.csv]', '<folder> [--output merged.csv]'),
    base: [
      t('Klasördeki .csv dosyalarını oku ve tek bir birlesik.csv dosyasında birleştir; sütun başlıkları farklıysa tüm sütunların birleşimini kullan, eksik hücreleri boş bırak.', 'Merge the .csv files into merged.csv; with different headers use the union of columns and leave missing cells empty.'),
      t('Her dosyanın ayırıcısını (, ; veya sekme) kendisi algıla; sonda dosya başına satır sayılarını yaz.', 'Detect each file’s delimiter (, ; or tab) itself; print the row count per file at the end.'),
    ],
    rules: [t('Çıktı dosyasını girdi olarak tekrar okuma; çıktı zaten varsa --uzerine-yaz verilmeden üzerine yazma.', 'Never read the output back as input; do not overwrite an existing output without --overwrite.')],
    fields: [
      { key: 'sourceColumn', type: 'toggle', label: t('Kaynak dosya sütunu', 'Source column'), default: true, on: t('Her satıra geldiği dosyanın adını yazan bir "kaynak_dosya" sütunu ekle.', 'Add a "source_file" column with the file each row came from.') },
      { key: 'dedupe', type: 'toggle', label: t('Yinelenen satırları çıkar', 'Remove duplicates'), default: false, on: t('Tamamen aynı olan satırları bir kez yaz ve kaç tanesinin çıkarıldığını söyle.', 'Write identical rows once and say how many were removed.') },
      SEPARATOR,
    ],
    sample: {
      files: t('ornek_veri/ocak.csv ("ad;tutar" başlıklı 2 satır, ; ayırıcı) ve ornek_veri/subat.csv ("ad,tutar,not" başlıklı 1 satır, , ayırıcı)', 'sample_data/jan.csv (header "name;amount", 2 rows, ";") and sample_data/feb.csv (header "name,amount,note", 1 row, ",")'),
      expect: t('birlesik.csv 3 veri satırı ve ad, tutar, not sütunlarını içerir; aksanlı harfler bozulmaz', 'merged.csv has 3 data rows and the columns name, amount, note; accented letters stay intact'),
    },
  },
  {
    id: 'csv-json',
    category: 'veri',
    icon: 'file-json',
    title: t('CSV ↔ JSON Dönüştürücü', 'CSV ↔ JSON Converter'),
    description: t('CSV tabloyu JSON’a, JSON listesini CSV’ye çevir.', 'Turn a CSV table into JSON and a JSON list into CSV.'),
    fileName: t('csv_json', 'csv_json'),
    modifies: false,
    usage: t('<dosya.csv | dosya.json> [--cikti <dosya>]', '<file.csv | file.json> [--output <file>]'),
    base: [
      t('Girdi .csv ise JSON nesne listesine, .json ise CSV tablosuna çevir; yönü uzantıdan anla. Çıktı adı verilmezse aynı adla diğer uzantıyı kullan.', 'Convert .csv to a JSON list of objects and .json to CSV, choosing the direction by extension. Without --output use the same name with the other extension.'),
      t('İç içe JSON nesnelerini CSV’de "adres.sehir" gibi noktalı sütun adlarıyla düzleştir.', 'Flatten nested JSON objects into dotted column names like "address.city".'),
    ],
    rules: [t('JSON’u ensure_ascii=False ile yaz (aksanlı harfler olduğu gibi kalsın).', 'Write JSON with ensure_ascii=False so accented letters stay readable.')],
    fields: [
      { key: 'types', type: 'toggle', label: t('Sayıları tanı', 'Detect numbers'), default: true, on: t('CSV’den JSON’a çevirirken sayı ve true/false değerlerini metin değil gerçek türleriyle yaz (virgüllü ondalıkları da tanı: 12,5).', 'When converting to JSON write numbers and true/false as real types (also accept decimal commas: 12,5).') },
      {
        key: 'indent',
        type: 'choice',
        label: t('JSON biçimi', 'JSON format'),
        default: '2',
        options: [
          { value: '2', label: t('Okunaklı', 'Pretty'), prompt: t('JSON 2 boşluk girintiyle yazılsın.', 'Indent JSON by 2 spaces.') },
          { value: '0', label: t('Sıkışık', 'Compact'), prompt: t('JSON girintisiz, tek satır yazılsın.', 'Write compact single-line JSON.') },
        ],
      },
      SEPARATOR,
    ],
    sample: {
      files: t('ornek_veri/kisiler.csv ("ad;yas;sehir" başlıklı, aksanlı harfler içeren 3 satır)', 'sample_data/people.csv (header "name;age;city", 3 rows with accented letters)'),
      expect: t('kisiler.json 3 nesnelik bir liste olur, yas sayıdır; bu JSON geri CSV’ye çevrilince aynı 3 satır elde edilir', 'people.json is a list of 3 objects with a numeric age; converting it back gives the same 3 rows'),
    },
  },
  {
    id: 'csv-ozet',
    category: 'veri',
    icon: 'chart-column',
    title: t('CSV Özet Raporu', 'CSV Summary Report'),
    description: t('Bir sütuna göre grupla; toplam, ortalama ve adetleri çıkar.', 'Group by a column; totals, averages and counts.'),
    fileName: t('csv_ozet', 'csv_summary'),
    modifies: false,
    usage: t('<dosya.csv> --grup <sütun> --deger <sütun>', '<file.csv> --group <column> --value <column>'),
    base: [
      t('--grup ile verilen sütuna göre grupla ve --deger sütunu için her grubun adedini, toplamını, ortalamasını, en küçük ve en büyük değerini hesapla; toplama göre büyükten küçüğe sırala.', 'Group by --group and compute count, sum, mean, min and max of --value per group, sorted by sum.'),
      t('Sütun adları verilmezse sütunları numaralarıyla listeleyip hangi seçeneklerin kullanılacağını anlat.', 'Without column names list the columns with numbers and explain the options.'),
      t('Sayıları 1.234,56 veya 1,234.56 biçiminde olsa da doğru oku; sayı olmayan hücreleri atla ve kaç tane atlandığını söyle.', 'Read numbers written as 1.234,56 or 1,234.56; skip non-numeric cells and count them.'),
    ],
    rules: [],
    fields: [
      {
        key: 'output',
        type: 'choice',
        label: t('Rapor biçimi', 'Report format'),
        default: 'table',
        options: [
          { value: 'table', label: t('Konsol', 'Console'), prompt: t('Raporu konsola hizalı bir tablo olarak yaz.', 'Print the report as an aligned console table.') },
          { value: 'csv', label: t('CSV dosyası', 'CSV file'), prompt: t('Raporu konsola yaz ve ozet.csv dosyasına kaydet.', 'Print the report and save it to summary.csv.') },
          { value: 'html', label: t('HTML rapor', 'HTML report'), prompt: t('Raporu konsola yaz ve tablo ile basit çubuk grafik içeren tek dosyalık ozet.html raporu olarak da kaydet (harici kütüphane yok).', 'Print the report and also save a single-file summary.html with a table and a simple bar chart (no external libraries).') },
        ],
      },
      { key: 'decimals', type: 'number', label: t('Ondalık basamak', 'Decimals'), default: 2, min: 0, max: 6, prompt: t('Sonuçları {value} ondalık basamakla göster.', 'Show results with {value} decimals.') },
    ],
    sample: {
      files: t('ornek_veri/satislar.csv ("bolge;urun;tutar" başlıklı 6 satır, iki bölge)', 'sample_data/sales.csv (header "region;product;amount", 6 rows, two regions)'),
      expect: t('--grup bolge --deger tutar ile iki satırlık özet çıkar ve toplamlar elle hesaplanan değerlere eşittir', '--group region --value amount gives a two-row summary whose totals match a manual calculation'),
    },
  },
  {
    id: 'json-duzenle',
    category: 'veri',
    icon: 'braces',
    title: t('JSON Doğrulayıcı & Biçimlendirici', 'JSON Validator & Formatter'),
    description: t('JSON dosyalarını denetle, hatanın yerini göster, düzgün biçimlendir.', 'Validate JSON files, show where errors are, format them.'),
    fileName: t('json_duzenle', 'format_json'),
    modifies: true,
    usage: t('<dosya.json | klasör> [--uygula]', '<file.json | folder> [--apply]'),
    base: [
      t('Verilen dosyayı ya da klasördeki tüm .json dosyalarını denetle; geçersiz olanlarda satır ve sütun numarasıyla hatayı göster.', 'Validate the file or every .json file in the folder; report errors with line and column.'),
      t('Geçerli dosyaları seçilen girintiyle yeniden biçimlendir; önizlemede hangi dosyaların değişeceğini göster.', 'Reformat valid files with the chosen indent; the preview lists the files that would change.'),
    ],
    rules: [t('Geçersiz dosyalara hiç dokunma; yalnızca raporla.', 'Never touch invalid files; only report them.')],
    fields: [
      {
        key: 'indent',
        type: 'choice',
        label: t('Girinti', 'Indent'),
        default: '2',
        options: [
          { value: '2', label: t('2 boşluk', '2 spaces'), prompt: t('Girinti 2 boşluk.', 'Indent by 2 spaces.') },
          { value: '4', label: t('4 boşluk', '4 spaces'), prompt: t('Girinti 4 boşluk.', 'Indent by 4 spaces.') },
          { value: 'tab', label: t('Sekme', 'Tab'), prompt: t('Girinti sekme karakteri.', 'Indent with tabs.') },
        ],
      },
      { key: 'sortKeys', type: 'toggle', label: t('Anahtarları sırala', 'Sort keys'), default: false, on: t('Nesne anahtarlarını alfabetik sırala.', 'Sort object keys alphabetically.') },
    ],
    planHint: {
      python: t("metin, kodlama = read_text(dosya); actions.append(write(dosya, json.dumps(veri, ensure_ascii=False, indent=2) + '\\n', kodlama))", "text, encoding = read_text(file); actions.append(write(file, json.dumps(data, ensure_ascii=False, indent=2) + '\\n', encoding))"),
      node: t("const bilgi = readText(dosya); actions.push(write(dosya, JSON.stringify(veri, null, 2) + '\\n', bilgi));", "const info = readText(file); actions.push(write(file, JSON.stringify(data, null, 2) + '\\n', info));"),
    },
    sample: {
      files: t('ornek_veri/iyi.json (tek satıra sıkıştırılmış geçerli JSON) ve ornek_veri/bozuk.json (sonunda fazladan virgül olan geçersiz JSON)', 'sample_data/good.json (valid, minified) and sample_data/broken.json (invalid, trailing comma)'),
      expect: t('bozuk.json satır/sütun bilgisiyle raporlanır ve değişmez; --uygula sonrası iyi.json girintili olur ve eski hali yedek klasöründedir', 'broken.json is reported with line/column and unchanged; after --apply good.json is indented and its old version is in the backup folder'),
    },
  },

  // ------------------------------------------------------------------ Metin
  {
    id: 'bul-degistir',
    category: 'metin',
    icon: 'replace',
    title: t('Toplu Bul & Değiştir', 'Bulk Find & Replace'),
    description: t('Klasördeki metin dosyalarında bir ifadeyi toplu değiştir.', 'Replace a phrase in every text file of a folder.'),
    fileName: t('bul_degistir', 'find_replace'),
    modifies: true,
    usage: t('<klasör> --bul "eski" --yeni "yeni" [--uygula]', '<folder> --find "old" --replace "new" [--apply]'),
    base: [t('Her dosya için kaç eşleşme bulunduğunu ve ilk birkaç değişikliği satır numarasıyla "önce → sonra" olarak göster; sonda toplam eşleşme ve dosya sayısı.', 'For every file show the number of matches and the first changes as "before → after" with line numbers; totals at the end.')],
    rules: [
      t('İkili (binary) dosyaları atla (ör. içinde NUL baytı olanlar).', 'Skip binary files (e.g. containing NUL bytes).'),
      t('Dosyanın kodlamasını ve satır sonlarını (CRLF/LF) değiştirmeden geri yaz.', 'Write files back with their original encoding and line endings (CRLF/LF).'),
    ],
    fields: [
      extensions('txt, md, csv, html, css, js'),
      { key: 'regex', type: 'toggle', label: t('Düzenli ifade', 'Regular expression'), default: false, on: t('--regex verilirse aranan ifade düzenli ifade olarak yorumlansın.', 'With --regex the search text is a regular expression.') },
      { key: 'ignoreCase', type: 'toggle', label: t('Büyük/küçük harf duyarsız', 'Ignore case'), default: false, on: t('--harf-duyarsiz ile büyük/küçük harf ayrımı yapılmasın.', 'With --ignore-case matching ignores case.') },
      { key: 'wholeWord', type: 'toggle', label: t('Tam kelime', 'Whole words'), default: false, on: t('--tam-kelime ile yalnızca tam kelimeler eşleşsin.', 'With --whole-word only whole words match.') },
      recursive(false),
    ],
    planHint: {
      python: t("metin, kodlama = read_text(dosya); yeni = metin.replace(args.bul, args.yeni); actions.append(write(dosya, yeni, kodlama)) if yeni != metin else None", "text, encoding = read_text(file); new = text.replace(args.find, args.replace); actions.append(write(file, new, encoding)) if new != text else None"),
      node: t("const bilgi = readText(dosya); const yeni = bilgi.text.split(options.bul).join(options.yeni); if (yeni !== bilgi.text) actions.push(write(dosya, yeni, bilgi));", "const info = readText(file); const next = info.text.split(options.find).join(options.replace); if (next !== info.text) actions.push(write(file, next, info));"),
    },
    sample: {
      files: t('ornek_veri/a.txt ("Merhaba dünya, merhaba!") ve ornek_veri/alt/b.md ("merhaba")', 'sample_data/a.txt ("Hello world, hello!") and sample_data/sub/b.md ("hello")'),
      expect: t('--bul merhaba --yeni selam önizlemesi eşleşmeleri gösterir ama dosyaları değiştirmez; --uygula sonrası değişiklikler yapılır ve eski halleri yedek klasöründe durur', '--find hello --replace hi previews without changing files; after --apply the files change and the originals are in the backup folder'),
    },
  },
  {
    id: 'dosyalarda-ara',
    category: 'metin',
    icon: 'file-search',
    title: t('Dosyalarda Ara', 'Search in Files'),
    description: t('Bir ifadenin geçtiği her yeri dosya ve satır numarasıyla listele.', 'List every place a phrase occurs, with file and line number.'),
    fileName: t('dosyalarda_ara', 'search_files'),
    modifies: false,
    usage: t('<klasör> --ara "ifade"', '<folder> --find "phrase"'),
    base: [
      t('Klasördeki metin dosyalarında ifadeyi ara; her eşleşmeyi dosya yolu, satır numarası ve satırın kendisiyle yaz (eşleşen kısım [[ ]] içinde).', 'Search the text files for the phrase; print every match with file path, line number and the line (the match inside [[ ]]).'),
      t('Sonda dosya başına eşleşme sayısını ve toplamı yaz.', 'Finish with the number of matches per file and the total.'),
    ],
    rules: [t('İkili (binary) dosyaları ve 50 MB’tan büyük dosyaları atla, sonda say.', 'Skip binary files and files over 50 MB, and count them at the end.')],
    fields: [
      extensions('txt, md, csv, json, html, css, js, py, log'),
      { key: 'regex', type: 'toggle', label: t('Düzenli ifade', 'Regular expression'), default: false, on: t('--regex verilirse aranan ifade düzenli ifade olarak yorumlansın.', 'With --regex the search text is a regular expression.') },
      { key: 'ignoreCase', type: 'toggle', label: t('Büyük/küçük harf duyarsız', 'Ignore case'), default: true, on: t('Büyük/küçük harf ayrımı yapma (--harf-duyarli ile açılabilsin).', 'Ignore case (--match-case turns it on).') },
      {
        key: 'context',
        type: 'choice',
        label: t('Çevre satırlar', 'Context lines'),
        default: '0',
        options: [
          { value: '0', label: t('Yok', 'None') },
          { value: '1', label: t('1 satır', '1 line'), prompt: t('Her eşleşmenin önünde ve arkasında 1 satır daha göster.', 'Show 1 line before and after every match.') },
          { value: '2', label: t('2 satır', '2 lines'), prompt: t('Her eşleşmenin önünde ve arkasında 2 satır daha göster.', 'Show 2 lines before and after every match.') },
        ],
      },
      { key: 'csv', type: 'toggle', label: t('CSV rapor', 'CSV report'), default: false, on: t('Sonuçları arama_sonuclari.csv dosyasına da yaz (dosya, satır, metin).', 'Also write the results to search_results.csv (file, line, text).') },
      recursive(true),
    ],
    sample: {
      files: t('ornek_veri/a.txt (iki satırında "fatura" geçen kısa bir metin) ve ornek_veri/alt/b.md (bir satırında "Fatura" geçen)', 'sample_data/a.txt (a short text with "invoice" on two lines) and sample_data/sub/b.md (with "Invoice" on one line)'),
      expect: t('--ara fatura 3 eşleşme bulur, satır numaraları doğrudur ve hiçbir dosya değişmez', '--find invoice finds 3 matches with the right line numbers and no file changes'),
    },
  },
  {
    id: 'bilgi-ayikla',
    category: 'metin',
    icon: 'at-sign',
    title: t('E-posta & Bağlantı Ayıklayıcı', 'Email & Link Extractor'),
    description: t('Metin dosyalarından e-posta, bağlantı ve telefonları topla.', 'Collect emails, links and phone numbers from text files.'),
    fileName: t('bilgi_ayikla', 'extract_contacts'),
    modifies: false,
    usage: t('<klasör | dosya> [--cikti bulunanlar.csv]', '<folder | file> [--output found.csv]'),
    base: [t('Bulunan her değeri türü, değeri ve bulunduğu dosya ile satır numarasıyla bulunanlar.csv dosyasına yaz; konsola tür başına sayıları yazdır.', 'Write every match with its type, value, file and line to found.csv; print counts per type.')],
    rules: [t('Aynı değeri bir kez yaz (ilk bulunduğu yerle birlikte), büyük/küçük harf farkını e-postalarda yok say.', 'Write every value once (with where it was first found); ignore case for emails.')],
    fields: [
      {
        key: 'kinds',
        type: 'multi',
        label: t('Aranacaklar', 'Find'),
        default: ['email', 'url'],
        min: 1,
        prompt: t('Aranacaklar: {items}.', 'Find: {items}.'),
        options: [
          { value: 'email', label: t('E-posta', 'Email'), prompt: t('e-posta adresleri', 'email addresses') },
          { value: 'url', label: t('Bağlantı', 'Link'), prompt: t('http/https bağlantıları (sondaki nokta ve parantezleri çıkararak)', 'http/https links (without trailing dots or brackets)') },
          {
            value: 'phone',
            label: t('Telefon', 'Phone'),
            prompt: t(
              'telefon numaraları (+ülke koduyla veya yerel yazımla; boşluklu, tireli, parantezli biçimler; en az 7 rakam; yalnızca baştaki + ve rakamlar kalacak şekilde sadeleştir)',
              'phone numbers (with a +country code or in local form; spaces, dashes and brackets allowed; at least 7 digits; normalised to the leading + and digits)'
            ),
          },
        ],
      },
      extensions('txt, md, csv, html'),
      SEPARATOR,
    ],
    sample: {
      files: t('ornek_veri/notlar.txt (iki e-posta, biri iki kez geçen; bir bağlantı; "+44 20 7946 0958" gibi bir telefon)', 'sample_data/notes.txt (two emails, one repeated; a link; a phone like "+44 20 7946 0958")'),
      expect: t('bulunanlar.csv her e-postayı bir kez içerir ve bağlantı doğru ayıklanır', 'found.csv lists each email once and the link is extracted correctly'),
    },
  },
  {
    id: 'kelime-sikligi',
    category: 'metin',
    icon: 'list-ordered',
    title: t('Kelime Sıklığı Analizi', 'Word Frequency'),
    description: t('Metinlerde en sık geçen kelimeleri ve metin istatistiklerini çıkar.', 'Most frequent words and text statistics.'),
    fileName: t('kelime_sikligi', 'word_frequency'),
    modifies: false,
    usage: t('<klasör | dosya> [--ilk 30]', '<folder | file> [--top 30]'),
    base: [
      t('Toplam kelime, farklı kelime, cümle sayısı ve ortalama kelime uzunluğunu; ardından en sık geçen kelimeleri adet ve yüzdeleriyle göster.', 'Show total words, distinct words, sentences and average word length; then the most frequent words with counts and percentages.'),
      t('Kelimeleri noktalamadan ayır ve küçük harfe çevir (Türkçe metinde I→ı, İ→i doğru olsun); her dildeki harfleri kelimenin parçası say.', 'Strip punctuation and lower-case the words (casefold); treat letters of every alphabet as word characters.'),
    ],
    rules: [],
    fields: [
      { key: 'top', type: 'number', label: t('Listelenecek kelime', 'Top words'), default: 30, min: 5, max: 500, prompt: t('Varsayılan olarak en sık {value} kelimeyi göster (--ilk ile değiştirilebilsin).', 'Show the top {value} words by default (--top changes it).') },
      {
        key: 'stopwords',
        type: 'toggle',
        label: t('Bağlaçları çıkar', 'Remove stop words'),
        default: true,
        on: t('Sık bağlaç ve edatları (ör. ve, ile, bir, bu / the, and, of, to) saymadan çıkar; betiğe Türkçe ve İngilizce listeler gömülü olsun, --hepsi ile kapatılabilsin.', 'Leave out common stop words (e.g. the, and, of, to); built-in English and Turkish lists; --all keeps them.'),
      },
      { key: 'minLength', type: 'number', label: t('En kısa kelime', 'Minimum length'), default: 2, min: 1, max: 10, unit: t('harf', 'letters'), prompt: t('{value} harften kısa kelimeleri sayma.', 'Ignore words shorter than {value} letters.') },
      { key: 'csv', type: 'toggle', label: t('CSV rapor', 'CSV report'), default: false, on: t('Sonucu kelime_sikligi.csv dosyasına da yaz.', 'Also write the result to word_frequency.csv.') },
    ],
    sample: {
      files: t('ornek_veri/metin.txt (içinde "kitap" kelimesinin 3 kez, "İstanbul" ile "istanbul" yazımlarının birer kez geçtiği kısa bir paragraf)', 'sample_data/text.txt (a short paragraph with "book" three times and "Paris"/"paris" once each)'),
      expect: t('"kitap" 3 adetle listenin başındadır ve "istanbul" tek kelime olarak 2 kez sayılır', '"book" tops the list with 3 and "paris" counts as one word, twice'),
    },
  },
];

export function getScript(id: string | null | undefined): ScriptDef | undefined {
  return SCRIPTS.find((s) => s.id === id);
}

export interface ScriptCommon {
  language: ScriptLanguage;
  /** File name without extension ('' = the tool's default). */
  fileName: string;
  /** Build a sample folder, run the script on it and check the stated result. */
  test: boolean;
  /** Extra wishes (optional; the wizard leaves them to the composer). */
  notes?: string;
  /** Language of the request, the script's messages, flags and file names. */
  requestLanguage: Lang;
}

/** "Toplu Adlandır.py" → "toplu_adlandir": a safe file name for any language. */
export function scriptBaseName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/\.(?:py|js|mjs|cjs)$/i, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

/** The language the script is written in: the chosen one when the tool supports it. */
export function scriptLanguage(def: ScriptDef, chosen: ScriptLanguage): ScriptLanguage {
  return def.languages && !def.languages.includes(chosen) ? def.languages[0] : chosen;
}

export function scriptFileName(def: ScriptDef, common: Pick<ScriptCommon, 'language' | 'fileName'>, lang: Lang = 'tr'): string {
  return `${scriptBaseName(common.fileName, tx(def.fileName, lang))}.${scriptLanguage(def, common.language) === 'node' ? 'js' : 'py'}`;
}

// ---------------------------------------------------------------------------
// Bulk rename result on sample files (the wizard shows it live; the script follows the same rules)
// ---------------------------------------------------------------------------

export interface RenameSample {
  name: string;
  /** Modification date, YYYY-MM-DD. */
  date: string;
  size: number;
}

/** The files of the rename tool's sample-data test (same names as in its `sample.files`). */
export const RENAME_TEST_FILES: Record<Lang, string[]> = {
  tr: ['Tatil 2.jpg', 'Tatil 10.jpg', 'deniz.JPG', 'notlar.txt'],
  en: ['Holiday 2.jpg', 'Holiday 10.jpg', 'beach.JPG', 'notes.txt'],
};

export const RENAME_SAMPLES: Record<Lang, RenameSample[]> = {
  tr: [
    { name: 'Tatil 2.jpg', date: '2026-07-14', size: 2_400_000 },
    { name: 'Tatil 10.jpg', date: '2026-07-15', size: 1_900_000 },
    { name: 'deniz kenarı.JPG', date: '2026-07-12', size: 3_100_000 },
    { name: 'Rapor (son).pdf', date: '2026-06-30', size: 240_000 },
    { name: 'notlar.txt', date: '2026-08-02', size: 1_200 },
  ],
  en: [
    { name: 'Holiday 2.jpg', date: '2026-07-14', size: 2_400_000 },
    { name: 'Holiday 10.jpg', date: '2026-07-15', size: 1_900_000 },
    { name: 'beach café.JPG', date: '2026-07-12', size: 3_100_000 },
    { name: 'Report (final).pdf', date: '2026-06-30', size: 240_000 },
    { name: 'notes.txt', date: '2026-08-02', size: 1_200 },
  ],
};

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/g;

/** "Çağrı Öztürk" → "Cagri Ozturk", "café" → "cafe", "Straße" → "Strasse". */
const simplifyLetters = (s: string) =>
  s
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

const splitName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot + 1) } : { stem: name, ext: '' };
};

export interface RenameRow {
  before: string;
  after: string | null;
  /** Why the file keeps its name (filtered out, conflict, unchanged). */
  note?: 'filtered' | 'conflict' | 'same';
}

/** The before/after names of the bulk rename tool for the given settings. */
export function renamePreview(values: ParamValues, lang: Lang = 'tr', samples: RenameSample[] = RENAME_SAMPLES[lang]): RenameRow[] {
  const def = getScript('toplu-adlandir')!;
  const field = (key: string) => def.fields.find((f) => f.key === key)!;
  const locale = lang === 'tr' ? 'tr' : 'en';
  const pattern = String(valueOf(field('pattern'), values, lang)).trim() || '{name}';
  const start = Number(valueOf(field('start'), values, lang));
  const order = String(valueOf(field('order'), values, lang));
  const letterCase = String(valueOf(field('case'), values, lang));
  const ascii = !!valueOf(field('ascii'), values, lang);
  const extensions = String(valueOf(field('extensions'), values, lang))
    .split(/[,\s;]+/)
    .map((e) => e.replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  const naturalCompare = (a: string, b: string) => a.localeCompare(b, locale, { numeric: true, sensitivity: 'base' });

  const included = samples.filter((s) => extensions.length === 0 || extensions.includes(splitName(s.name).ext.toLowerCase()));
  const sorted = [...included].sort((a, b) =>
    order === 'date' ? a.date.localeCompare(b.date) || naturalCompare(a.name, b.name)
    : order === 'size' ? a.size - b.size || naturalCompare(a.name, b.name)
    : naturalCompare(a.name, b.name)
  );

  const targets = new Map<RenameSample, string>();
  sorted.forEach((s, i) => {
    const { stem, ext } = splitName(s.name);
    let name = pattern.replace(/\{(ad|name|uzanti|ext|tarih|date|sayac|n)(?::(\d+))?\}/g, (_m, key: string, width?: string) => {
      if (key === 'ad' || key === 'name') return stem;
      if (key === 'uzanti' || key === 'ext') return ext;
      if (key === 'tarih' || key === 'date') return s.date;
      const n = String(start + i);
      return width ? n.padStart(Number(width), '0') : n;
    });
    let extOut = ext;
    if (letterCase === 'lower') {
      name = name.toLocaleLowerCase(locale);
      extOut = ext.toLocaleLowerCase(locale);
    } else if (letterCase === 'upper') {
      name = name.toLocaleUpperCase(locale);
      extOut = ext.toLocaleUpperCase(locale);
    }
    if (ascii) name = simplifyLetters(name).replace(/\s+/g, '_');
    name = name.replace(INVALID_NAME_CHARS, '').trim();
    targets.set(s, (name || stem) + (extOut ? `.${extOut}` : ''));
  });

  // Conflicts: two files with the same target, or a target that is another file's current name.
  const counts = new Map<string, number>();
  for (const target of targets.values()) counts.set(target.toLowerCase(), (counts.get(target.toLowerCase()) || 0) + 1);
  const currentNames = new Set(samples.map((s) => s.name.toLowerCase()));

  return samples.map((s) => {
    const target = targets.get(s);
    if (target === undefined) return { before: s.name, after: null, note: 'filtered' };
    if (target === s.name) return { before: s.name, after: target, note: 'same' };
    const key = target.toLowerCase();
    if ((counts.get(key) || 0) > 1 || (currentNames.has(key) && key !== s.name.toLowerCase())) return { before: s.name, after: null, note: 'conflict' };
    return { before: s.name, after: target };
  });
}

/**
 * "deniz.JPG → deniz_001.JPG, ..." for the rename test files, when the result does not depend on
 * file dates or sizes (natural order by name, no date variable); null otherwise.
 */
export function renameTestExpectation(values: ParamValues, lang: Lang): string | null {
  const def = getScript('toplu-adlandir')!;
  const field = (key: string) => def.fields.find((f) => f.key === key)!;
  const pattern = String(valueOf(field('pattern'), values, lang));
  if (String(valueOf(field('order'), values, lang)) !== 'name' || /\{(?:tarih|date)\b/.test(pattern)) return null;
  const samples = RENAME_TEST_FILES[lang].map((name) => ({ name, date: '2026-01-01', size: 1 }));
  const rows = renamePreview(values, lang, samples);
  const listed = rows
    .map((r) => (r.note === 'filtered' ? null : `${r.before} → ${r.note === 'conflict' ? (lang === 'en' ? 'skipped (name clash)' : 'atlanır (ad çakışması)') : r.after}`))
    .filter(Boolean);
  return listed.length ? listed.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Request compiler
// ---------------------------------------------------------------------------

/** The request for a command line script. */
export function compileScriptPrompt(def: ScriptDef, values: ParamValues, common: ScriptCommon): CompiledTool {
  const lang = common.requestLanguage;
  const L = (tr: string, en: string) => (lang === 'en' ? en : tr);
  const names = SCRIPT_NAMES[lang];
  const python = scriptLanguage(def, common.language) === 'python';
  const file = scriptFileName(def, common, lang);
  const run = python ? `python ${file}` : `node ${file}`;
  const merged = { ...defaultValues(def.fields, lang), ...values };
  const lines: string[] = [];

  lines.push(
    L(
      `"${file}" adında bir ${python ? 'Python' : 'Node.js'} komut satırı betiği yaz: ${tx(def.title, 'tr')} — ${tx(def.description, 'tr')}`,
      `Write a ${python ? 'Python' : 'Node.js'} command line script named "${file}": ${tx(def.title, 'en')} — ${tx(def.description, 'en')}`
    )
  );

  const helper = helperFileName(lang, python ? 'python' : 'node');
  lines.push('', L('DOSYA', 'FILE'));
  lines.push(
    python
      ? L(`- Betik: ${file} (Python 3.8+, yalnızca standart kütüphane; pip ile paket kurma veya isteme).`, `- Script: ${file} (Python 3.8+, standard library only; do not install or require pip packages).`)
      : L(`- Betik: ${file} (Node.js 18+, yalnızca yerleşik modüller: fs, path, crypto, zlib...; npm paketi kullanma, package.json oluşturma).`, `- Script: ${file} (Node.js 18+, built-in modules only: fs, path, crypto, zlib...; no npm packages, no package.json).`),
    L(`- Yanında hazır gelen ${helper} güvenlik modülünü içe aktarır; o dosyayı okuman veya değiştirmen gerekmez (kullanacağın fonksiyonlar aşağıda).`, `- It imports the ${helper} safety module that comes ready next to it; you do not need to read or change that file (the functions to use are below).`),
    L('- Bu bir komut satırı aracıdır: web sayfası, grafik arayüz veya sunucu yazma.', '- This is a command line tool: no web page, GUI or server.'),
    L(`- Kullanım: ${run} ${tx(def.usage, 'tr')}`, `- Usage: ${run} ${tx(def.usage, 'en')}`)
  );

  lines.push('', L('İŞLEV', 'FUNCTION'));
  for (const b of def.base) lines.push(`- ${tx(b, lang)}`);
  for (const d of describeValues(def.fields, merged, lang)) lines.push(`- ${d.replace(/\n/g, '\n  ')}`);
  for (const r of def.rules) lines.push(`- ${tx(r, lang)}`);

  lines.push('', L('GÜVENLİK', 'SAFETY'));
  if (def.modifies) {
    lines.push(
      L(
        `- Varsayılan çalışma yalnızca önizlemedir: ne yapılacağını listele, hiçbir dosyayı değiştirme. Değişiklikler yalnızca ${names.apply} verildiğinde yapılsın; önizlemenin sonunda bunu hatırlat.`,
        `- The default run is a preview only: list what would happen and change nothing. Changes happen only with ${names.apply}; say so at the end of the preview.`
      ),
      L(
        `- Hiçbir dosyayı silme. İçeriği değişecek bir dosyayı önce klasördeki ${names.backup} klasörüne kopyala.`,
        `- Never delete any file. Copy every file whose content will change into a ${names.backup} folder first.`
      ),
      L(`- Her işlemi (zaman, işlem, kaynak, hedef, sonuç) klasördeki ${names.log} dosyasına ekle.`, `- Append every action (time, action, source, target, result) to ${names.log} in the folder.`)
    );
  } else {
    lines.push(L('- Girdi dosyalarını asla değiştirme, taşıma veya silme; yalnızca oku. Sonuçları yeni bir dosyaya yaz.', '- Never change, move or delete the input files; only read them. Write results to a new file.'));
  }
  lines.push(
    L('- Yalnızca verilen klasörün içinde çalış: yolları tam yola çevir ve klasör dışına çıkan her yolu (.., kısayol/sembolik bağlantı) reddet.', '- Stay inside the given folder: resolve paths and refuse anything that leads outside (.., shortcuts/symlinks).'),
    L('- Betiğin kendi dosyalarını (betik, yedek klasörleri, kayıt ve çıktı dosyaları) işleme alma.', '- Never process the script’s own files (the script, backups, log and output files).')
  );

  // The tool's own flags, from its usage, the chosen settings and its rules (the path and the apply flag come ready).
  const optionFlags = Array.from(
    new Set(
      [tx(def.usage, lang), ...describeValues(def.fields, merged, lang), ...def.rules.map((r) => tx(r, lang))].join(' ').match(/--[a-z][a-z-]*/g) || []
    )
  ).filter((f) => f !== names.apply && f !== '--help');
  const skeletonOptions = {
    lang,
    options: optionFlags,
    language: (python ? 'python' : 'node') as ScriptLanguage,
    file,
    title: `${tx(def.title, lang)} — ${tx(def.description, lang)}`,
    usage: tx(def.usage, lang),
    modifies: def.modifies,
    names,
  };
  const entry = def.modifies ? 'plan()' : 'work()';
  const optionsFn = python ? 'add_options()' : 'readOptions()';

  lines.push('', L('KOD', 'CODE'));
  lines.push(
    L(
      `- ${file} henüz yok: ilk adımda write_file ile aşağıdaki yapıda oluştur; ${optionsFn} ve ${entry} kısmını aracın işiyle doldur, gerisini aynen bırak.`,
      `- ${file} does not exist yet: create it first, with write_file, in the structure below; fill in ${optionsFn} and ${entry} with the tool and keep the rest as it is.`
    ),
    def.modifies
      ? L(
          `- ${entry} dosyalara dokunmaz: yapılacak değişiklikleri rename(), move() veya write() ile listeye ekleyip döndürür. Önizlemeyi, ${names.apply} ile uygulamayı, yedeklemeyi, kaydı, çakışma ve klasör dışı kontrollerini ${helper} yapar; dosyaları kendin yeniden adlandırma, taşıma veya yazma.`,
          `- ${entry} does not touch files: it appends the changes with rename(), move() or write() and returns the list. ${helper} does the preview, applying with ${names.apply}, backups, the log and the clash / outside-folder checks; never rename, move or write files yourself.`
        )
      : L(
          `- ${entry} girdi dosyalarını yalnızca okur, sonucu yazdırır; istenen çıktı dosyasını yeni bir dosya olarak yazar ve sonda kısa bir özet verir (işlenen, atlanan dosya sayıları).`,
          `- ${entry} only reads the input files, prints the result, writes any requested output as a new file and ends with a short summary (processed, skipped counts).`
        ),
    python
      ? L(`- Aracın seçeneklerini ${optionsFn} içinde argparse ile tanımla (${optionFlags.join(', ') || 'yok'}); klasör/dosya yolu ve ${names.apply} hazır, tekrar ekleme. --help açıklamaları Türkçe olsun.`, `- Define the tool’s options in ${optionsFn} with argparse (${optionFlags.join(', ') || 'none'}); the path and ${names.apply} are ready, do not add them again. Give them --help texts.`)
      : L(`- Aracın seçeneklerini ${optionsFn} içinde optionValue ile oku (${optionFlags.join(', ') || 'yok'}) ve HELP metnine ekle; klasör/dosya yolu ve ${names.apply} hazır.`, `- Read the tool’s options in ${optionsFn} with optionValue (${optionFlags.join(', ') || 'none'}) and add them to HELP; the path and ${names.apply} are ready.`),
    python
      ? L('- Metin dosyalarını read_text ile oku; (metin, kodlama) döndürür, değişen metni write(dosya, metin, kodlama) ile aynı kodlamayla geri yaz. Dosyaları sıralarken natural_key kullan.', '- Read text files with read_text; it returns (text, encoding): write changed text back with write(file, text, encoding). Sort files with natural_key.')
      : L('- Metin dosyalarını readText ile oku; { text, encoding, bom } döndürür, değişen metni write(dosya, metin, bilgi) ile aynı kodlamayla geri yaz. Dosyaları naturalCompare ile sırala.', '- Read text files with readText; it returns { text, encoding, bom }: write changed text back with write(file, text, info). Sort files with naturalCompare.'),
    ...(def.planHint ? [L(`- İpucu: \`${tx(python ? def.planHint.python : def.planHint.node, 'tr')}\`.`, `- Hint: \`${tx(python ? def.planHint.python : def.planHint.node, 'en')}\`.`)] : []),
    L('- Hatalarda fail(...) çağır: Türkçe, anlaşılır bir mesaj ve çıkış kodu 1; yakalanmamış hata izi gösterme.', '- On errors call fail(...): a clear message and exit with code 1; no raw tracebacks.'),
    L(
      `- ${helper} yoksa betiği tek dosya olarak aynı kurallarla kendin yaz (önizleme, ${names.apply}, yedek, kayıt, klasör dışı kontrolü).`,
      `- If ${helper} is missing, write the script as one file with the same rules yourself (preview, ${names.apply}, backups, log, folder check).`
    )
  );
  lines.push('', L('BETİĞİN YAPISI', 'SCRIPT STRUCTURE'), '```' + (python ? 'python' : 'javascript'), scriptTemplate(skeletonOptions), '```');

  const checklist: string[] = [];
  if (common.test) {
    const expected = def.preview === 'rename' ? renameTestExpectation(merged, lang) : null;
    lines.push('', L('DENEME', 'TEST'));
    lines.push(
      L(`- Betiği yazdıktan sonra deneme için ${tx(def.sample.files, 'tr')} oluştur.`, `- After writing the script create test data: ${tx(def.sample.files, 'en')}.`),
      def.modifies
        ? L(
            `- Betiği ${names.sample} üzerinde önce önizleme olarak çalıştır (hiçbir dosya değişmemeli), sonra ${names.apply} ile bir kez çalıştır ve klasörü listeleyerek sonucu kontrol et (${run} ${names.sample} ...).`,
            `- Run it on ${names.sample} as a preview first (no file may change), then once with ${names.apply}, and list the folder to check the result (${run} ${names.sample} ...).`
          )
        : L(`- Betiği ${names.sample} üzerinde çalıştır ve çıktısını kontrol et (${run} ${names.sample} ...).`, `- Run it on ${names.sample} and check its output (${run} ${names.sample} ...).`),
      L(`- Beklenen: ${tx(def.sample.expect, 'tr')}.`, `- Expected: ${tx(def.sample.expect, 'en')}.`),
      ...(expected ? [L(`- Bu ayarlarla beklenen adlar: ${expected}.`, `- With these settings the expected names are: ${expected}.`)] : []),
      L(
        '- Beklenen dosyaları, kayıt dosyasını veya yedekleri asla elle oluşturma ya da düzeltme; onları yalnızca betik üretir.',
        '- Never create or fix the expected files, the log or the backups by hand; only the script produces them.'
      ),
      L(
        `- Sonuç farklıysa betiği düzelt ve yeni bir deneme klasöründe (${names.sample}2) tekrar dene. Deneme yalnızca deneme klasörlerinde yapılsın.`,
        `- If the result differs, fix the script and test again in a fresh folder (${names.sample}2). Test only inside the test folders.`
      ),
      L(`- ${python ? 'Python' : 'Node.js'} bulunamazsa kurmaya çalışma; özetinde bunu belirt.`, `- If ${python ? 'Python' : 'Node.js'} is not found, do not try to install it; say so in the summary.`)
    );
    checklist.push(
      L(`${file} — write_file ile oluştur (${optionsFn} ve ${entry} dolu)`, `${file} — create it with write_file (${optionsFn} and ${entry} filled in)`),
      L(`${file} — ${names.sample} ile çalıştırıp sonucu kontrol et`, `${file} — run it on ${names.sample} and check the result`)
    );
  }

  if (common.notes?.trim()) lines.push('', L('EK İSTEKLER', 'EXTRA WISHES'), `"""\n${common.notes.trim()}\n"""`);

  const design: DesignOverride = { enabled: false };
  return {
    prompt: lines.join('\n'),
    displayGoal: L(`Betik: ${file} — ${tx(def.title, 'tr')} (${python ? 'Python' : 'Node.js'})`, `Script: ${file} — ${tx(def.title, 'en')} (${python ? 'Python' : 'Node.js'})`),
    design,
    checklist,
    contracts: false,
    seedFiles: [{ path: helper, content: scriptHelper(skeletonOptions) }],
    scriptOutputs: def.modifies ? [names.log, `${names.backup.replace(/YYYY.*$/, '')}*`] : [],
    applyFlag: def.modifies ? names.apply : undefined,
  };
}
