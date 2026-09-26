# 📘 Emir Code Kullanım Kılavuzu

Emir Code, bilgisayarınızda çalışan yapay zekâ modelleriyle (Ollama) sohbet etmenizi ve bir proje klasöründe sizin yerinize kod yazan, hata düzelten, test çalıştıran bir **yazılım ajanı** kullanmanızı sağlar. Kodunuz buluta gönderilmez.

---

## 🚀 İlk Kurulum (5 dakika)

1. **Ollama'yı kurun**: [ollama.com](https://ollama.com) → indirip kurun.
2. **Bir model indirin** (terminalden ya da Emir Code içindeki model yöneticisinden, `Ctrl+Shift+M`):
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
3. **Emir Code'u kurun**: [Sürümler sayfasından](https://github.com/daristanapeyvan/emircode/releases) Windows için `Emir.Code.Setup.X.Y.Z.exe`, Linux için `.deb`, `.rpm`, `.AppImage` veya `emir-code-setup-linux.sh` dosyasını indirin.
4. Uygulamayı açın, üstteki model seçiciden modelinizi seçin. Hepsi bu!

> Ollama kurulu ama kapalıysa Emir Code onu otomatik başlatır.

---

## 💬 Sohbet ile neler yapabilirsiniz?

| Ne yapmak istiyorsunuz? | Örnek |
| :--- | :--- |
| Kod açıklatmak | `Bu fonksiyon ne işe yarıyor? (kodu yapıştırın)` |
| Hata mesajı çözdürmek | `"TypeError: Cannot read properties of undefined" hatası neden olur, nasıl düzeltirim?` |
| Kod yazdırmak | `Python'da bir CSV dosyasını okuyup sütun ortalamalarını hesaplayan fonksiyon yaz` |
| Güncel bilgi sormak (Web açık) | `şebnem ferah kimdir?` · `bugün İstanbul'da hava nasıl?` · `dolar kuru kaç?` |
| Dosya/görsel hakkında soru sormak | 📎 ile bir kod dosyası veya görsel ekleyip `bu dosyadaki hataları bul` |

**İpuçları**
- **Web** düğmesi açıkken güncel sorularda Emir Code internette arar ve cevabı numaralı kaynaklarla verir. Model "erişimim yok" derse uygulama aramayı kendisi yapıp cevabı yeniden üretir.
- **Ayarlar → Üretim** bölümündeki ön ayarlarla cevap tarzını seçebilirsiniz: **Balanced, Precise, Creative, Coding**. Sohbetteki sistem istemi düğmesinde **General Assistant, Senior Developer, Ultra Concise** hazır gelir; kendi isteminizi de yazabilirsiniz.
- Görsel sorularında görseli anlayabilen bir model gerekir (ör. `llama3.2-vision`, `gemma3`).

---

## 🤖 Ajan (Emir Code sekmesi) ile neler yapabilirsiniz?

Emir Code sekmesinde bir **proje klasörü** seçin (yeni proje için boş bir klasör yeterli), ne istediğinizi yazın. Ajan dosyaları okur, kod yazar, gerekirse test çalıştırır ve sonucu size özetler.

| Ne yapmak istiyorsunuz? | Örnek istek |
| :--- | :--- |
| Web sitesi yapmak | `Bir kahve dükkanı için tek sayfalık modern bir web sitesi oluştur: menü (en az 6 ürün, fiyatlarıyla), hakkımızda ve iletişim bölümleri olsun. Responsive olsun ve iletişim formu JavaScript ile doğrulansın.` |
| Sonradan değişiklik istemek | `başlıkların rengini koyu mavi yap ve sayfanın en altına telif yazısı olan bir footer ekle` |
| Script / komut satırı aracı yazmak | `Python ile komut satırından çalışan bir yapılacaklar listesi yaz: ekle, listele, tamamla ve sil komutları olsun; veriler todos.json dosyasında saklansın.` |
| Hata düzeltip testle kanıtlamak | `indirim uygulanınca sepet toplamı yanlış hesaplanıyor, düzelt ve npm test ile doğrula` |
| Ayar dosyası düzenlemek | `package.json dosyasına 'start' script'i olarak 'node src/index.js' ekle` |
| Bozuk bir sayfayı onarmak | `Sitede script ve CSS etiketleri eksik kalmış, düzelt` |
| Projeyi anlamak | `src klasöründeki ödeme akışını adım adım açıkla` |

### Ajan arka planda neler yapar?
1. **Planlar**: Birden fazla iş içeren istekler kontrol listesine bölünür; hepsi bitmeden görev kapanmaz.
2. **Her dosyayı denetler**: Yazılan her dosya otomatik kontrol edilir (HTML, CSS, JavaScript/TypeScript, Python, JSON, YAML, Java, C#, Go, Rust…). Kapanmamış parantez, bozuk girinti, yarım kalan dosya, "içerik buraya gelecek" gibi yer tutucular bulunursa **satır numarasıyla** modele geri bildirilir ve düzeltilmeden görev bitmez.
3. **Web sayfalarını doğrular**: Gerçek CSS kuralları, çalışan JavaScript, mobil uyum (viewport) etiketi ve bağlanan dosyaların varlığı kontrol edilmeden "tamamlandı" denmez. Menü bağlantılarını sorduğunuzda (ör. "Home About Services Contact — bunlar çalışsın" veya "navbar linkleri yönlendirsin") her bağlantının gerçekten bir bölüme, sayfaya ya da JavaScript işlevine gittiği de kontrol edilir.
4. **Ayarları ve testleri korur**: `package.json` gibi dosyalarda mevcut anahtarlar silinmez; bozuk JSON asla yazılmaz. Siz istemedikçe mevcut testler değiştirilemez; test başarısızsa ajan testi değil kodu düzeltmek zorundadır.
5. **Döngüye girmez**: Model aynı şeyi tekrarlarsa uyarılır; ilerleme olmazsa görev net bir mesajla durdurulur.
6. **Önceki isteği hatırlar**: Aynı oturumdaki bir sonraki istek, öncekinde neyin istendiğini ve hangi dosyaların değiştiğini bilir. "şimdi stil ekle" demeniz yeterli.
7. **Çalışan dosyayı bozmaz**: Bir değişiklik çalışan bir dosyayı bozacaksa uygulanmaz; model bozuk parçayı satır satır yamamak yerine doğru bir sürüm göndermek zorundadır.

> **İpucu:** Birden fazla ayrı iş istiyorsanız bunları numaralı liste (`1. … 2. …`) olarak yazın ya da "sonra" ile bağlayın; ajan bunları eksiksiz tamamlanması gereken bir kontrol listesine alır. Bunun dışındaki her istek, kaç cümle veya satır olursa olsun **tek bir görev** olarak ele alınır.

### Değişiklikleri siz kontrol edersiniz
- Her değişiklik satır satır **fark (diff)** olarak gösterilir.
- **↺** düğmesi ajanın o oturumda yaptığı tüm değişiklikleri geri alır.
- **💡** paneli modelin düşüncelerini ve ham çıktısını gösterir.

### Güvenlik profilleri
| Profil | Dosya değişiklikleri | Komutlar (`npm test`, `pytest`…) | Dosya silme | Ajan soru sorar mı? |
| :--- | :--- | :--- | :--- | :--- |
| **Sıkı** (varsayılan) | Sizin onayınızla | Sizin onayınızla | Sizin onayınızla | Evet |
| **Dengeli** | Otomatik | Sizin onayınızla | Sizin onayınızla | Evet |
| **Otonom** | Otomatik | Test komutları otomatik | Sizin onayınızla | Hayır, en uygun seçeneği kendisi seçer |

Ajan hiçbir modda seçtiğiniz klasörün dışına dosya yazamaz; `npx` veya rastgele terminal komutları çalıştıramaz.

---

## 🧭 Oluşturma sihirbazları: Website, Mini Uygulama, Betik

Boş bir klasörde (ya da henüz klasör seçmeden) yeni bir görev açtığınızda metin kutusunun üstünde üç öneri görünür: **Website Oluştur**, **Mini Uygulama** ve **Betik**. İçinde dosya bulunan bir proje açıkken bu öneriler çıkmaz.

**Hiçbir sihirbaz görevi kendiliğinden başlatmaz.** **Onayla**'ya bastığınızda hazırlanan istek metin kutusuna gelir; üstünde küçük bir etiket görünür. İsteği okuyabilir, istediğiniz gibi değiştirebilir ya da ek isteklerinizi yazabilirsiniz; ardından gönder tuşuna siz basarsınız. Etiketteki **Sihirbazı aç** sizi seçtiğiniz ayarlara geri götürür, **×** isteği kaldırır. İsteği düzenleseniz de seçtiğiniz tema, sayfa planı ve denetimler istekle birlikte gider. Metin kutusuna doğrudan istek yazmak eskisi gibi çalışır.

### Website Oluştur

Birkaç soruyla sitenizi tarif edersiniz. Cevaplarınızdan küçük modellerin en iyi anladığı biçimde ayrıntılı bir istek hazırlanır.

**İki mod vardır** (sihirbazın üst kısmından istediğiniz an geçebilirsiniz):
| Mod | Adımlar |
| :--- | :--- |
| **Basit** | Site (ad, tür, kısa tanım) → Tasarım (tema) → Yapı (tek sayfa veya çok sayfa, bölümler) → Özet |
| **Kapsamlı** | Site (slogan, hedef kitle, sayfa dili, yazım tonu dahil) → Tasarım → Sayfalar & İçerik → İletişim → İşlevler → Özet |

- **Sayfalar & İçerik:** Sayfa ekleyip çıkarabilir, adlarını değiştirebilir ve sıralayabilirsiniz. Her sayfaya bölüm ekleyebilirsiniz: Karşılama, Hakkımızda, Hizmetler, Menü, Galeri, Fiyatlar, Yorumlar, SSS, İletişim… Her bölüme **kendi metninizi** yazabilirsiniz. Yazdığınız metin sayfaya aynen konur; boş bıraktığınız bölümlerin metnini ajan yazar.
- **Akıllı metin kutusu:**
  - Araç çubuğunda kalın, italik, ara başlık, madde listesi, numaralı liste, alıntı ve bağlantı vardır.
  - Kısayollar: Ctrl+B, Ctrl+I, Ctrl+K.
  - Listede Enter'a basınca yeni madde açılır; boş maddede Enter listeyi bitirir.
  - **Önizleme** ile sonucu görebilirsiniz.
- **Tasarım:** Konunuza uygun temalar önerilir; 24 temanın tamamı küçük önizlemeleriyle listelenir. "Tema kullanma" seçeneğiyle modelin kendi tasarımı kalır.
- **İşlevler:**
  - Seçilebilenler: iletişim formu doğrulaması, mobil menü, açılır SSS, yukarı çık düğmesi, belirme animasyonları, açık/koyu düğmesi, WhatsApp düğmesi, harita, galeri büyütme ve bülten kutusu.
  - Ayrıca görsel türünü, SEO başlığını ve SEO açıklamasını ayarlayabilirsiniz.
- **Özet:** Seçimlerinizi ve proje klasörünü gösterir. Klasör boş değilse uyarı çıkar.

Çok sayfalı sitelerde her sayfa kontrol listesinde ayrı bir madde olur. Metin kutusunda bir sayfayı istekten silerseniz o sayfa listeden de çıkar. Taslağınız otomatik kaydedilir: sihirbazı kapatsanız ya da uygulamadan çıksanız da yazdıklarınız kaybolmaz. "Sıfırla" ile baştan başlarsınız.

### Mini Uygulama

Tek dosyalık (`index.html`) küçük web araçları hazırlar. İnternet ya da harici kütüphane gerektirmezler; çift tıklayınca tarayıcıda açılırlar.

1. Soldaki kategorilerden birini seçin.
2. İstediğiniz aracın kartına tıklayın; aracın **kendi ayar sayfası** açılır.
3. Açma/kapama anahtarlarını, seçimleri, sayıları ve listeleri ayarlayın.
4. **Çıktı** bölümünde uygulamanın adını, arayüz dilini ve tasarım temasını seçin. Tema, varsayılan olarak aracın türüne uygun biri olur.
5. **Geri** ile kataloğa dönersiniz; ayarlarınız kaybolmaz.

| Kategori | Araçlar |
| :--- | :--- |
| Hesaplama | Hesap Makinesi, Birim Çevirici, Kredi Hesaplayıcı, Hesap Bölüşme, Tarih Hesaplayıcı |
| Verimlilik | Pomodoro Zamanlayıcı, Yapılacaklar Listesi, Not Defteri, Geri Sayım & Kronometre |
| Takip | Harcama Takibi, Alışkanlık Takibi, VKİ Hesaplayıcı |
| Yardımcı Araçlar | Şifre Üretici, Renk Paleti Üretici, Metin Araçları, Rastgele Seçici |
| Eğlence & Öğrenme | Bilgi Yarışması, Bilgi Kartları, Yazma Hızı Testi, Hafıza Oyunu, Yılan Oyunu |

Her araç, küçük modellerin sık yaptığı hatalara karşı kurallarla gelir:
- Hesap makinesinde `eval` kullanılmaz.
- Şifreler ve çekilişler için güvenli rastgelelik kullanılır.
- Zamanlayıcılar arka planda da doğru sayar.
- Para ve tarih biçimi tarayıcının bölge ayarından gelir.

### Betik

Dosyalarınız üzerinde çalışan komut satırı araçları hazırlar. Betikler Python (yalnızca standart kütüphane) ya da Node.js (yalnızca yerleşik modüller) ile yazılır.

| Kategori | Betikler |
| :--- | :--- |
| Dosya & Klasör | Toplu Yeniden Adlandırma, Klasör Düzenleyici, Yinelenen Dosya Bulucu, Klasör Yedekleme (ZIP), Klasör Boyutu Raporu |
| Veri | CSV Birleştirme, CSV ↔ JSON Dönüştürücü, CSV Özet Raporu, JSON Doğrulayıcı & Biçimlendirici |
| Metin | Toplu Bul & Değiştir, Dosyalarda Ara, E-posta & Bağlantı Ayıklayıcı, Kelime Sıklığı Analizi |

**Güvenlik kuralları her betikte vardır:**
- Betik varsayılan olarak yalnızca **önizleme** yapar: ne yapacağını listeler, hiçbir şeyi değiştirmez. Değişiklik için `--uygula` eklenir. İngilizce arayüzde bu seçenek `--apply` olur.
- Hiçbir dosya silinmez. İçeriği değişecek dosyalar önce `_yedek_…` klasörüne kopyalanır.
- Betik, verilen klasörün dışına çıkamaz.
- Her işlem `islem_kaydi.csv` dosyasına yazılır. Taşıma ve adlandırma betiklerinde **Geri alma** ayarını açarsanız `--geri-al` ile son çalıştırma geri alınabilir.
- Hatalar anlaşılır bir mesajla gösterilir.

İsteği gönderdiğinizde uygulama, bu kuralları uygulayan denenmiş bir **güvenlik modülünü** (`guvenli_islem.py` ya da `.js`) betiğin yanına yazar. Sıkı profilde bunun için onayınız istenir; aynı adda bir dosya varsa dokunulmaz. Ajan yalnızca kısa betiği yazar: aracın seçeneklerini ve hangi dosyaya ne yapılacağının listesini. Dosyaları değiştiren kısım modüldeki hazır, denenmiş koddur; bu sayede küçük modeller de güvenlik kurallarını atlayamaz. Betiği başka bir yere taşırken modülü de yanında taşıyın.

**Örnek veriyle dene** açıksa ajan betiği yazdıktan sonra küçük bir `ornek_veri` klasörü oluşturur. Betiği bu klasörde çalıştırır ve sonucu kontrol eder; komut çalıştırmak için izniniz istenir. Dosya değiştiren bir betik aynı klasöre yalnızca bir kez uygulanır: arada bir dosya değişmediyse uygulama komutu ve o klasörün yeni önizlemesi tekrar çalıştırılmaz, ajan ilk sonuca bakar. Toplu Yeniden Adlandırma'da kalıbın örnek dosya adlarına etkisini ayar sayfasında hemen görürsünüz. Kalıpta `{ad}`, `{uzanti}`, `{sayac:03}` ve `{tarih}` değişkenlerini kullanabilirsiniz.

---

## 🎨 Web tasarım temaları

Yerel modeller, hangisi olursa olsun, siteleri hep aynı "w3schools" görünümüyle yazar: Arial yazı tipi, koyu gri menü, yeşil butonlar, emoji simgeler ve footer'da "© 2023". Emir Code, **yeni bir web sayfası** oluştuğunda, ajan işini bitirdikten sonra sayfaya özenle hazırlanmış bir tasarım teması uygular. Model bunun için hiçbir şey öğrenmek zorunda değildir.

**Ne olur?**
- Proje klasörüne `theme/theme.css` yazılır ve sayfaya bağlanır. Dosyanın içinde renkler, yazı tipleri ve temel bileşen stilleri (buton, form, tablo, kart, bölüm boşlukları) bulunur.
- Sayfanın renkleri temadaki rollerine bağlanır. Koyu menü çubuğu temanın koyu şeridi, yeşil buton temanın vurgu rengi, beyaz kart temanın kart yüzeyi olur. Koyu ya da renkli bir alanın içindeki yazılar okunur kalır.
- Özellik kartlarındaki ve iletişim satırlarındaki emojiler (☕ 📍 📞 🚀 …) temanın çizgi kalınlığında SVG simgelere dönüşür.
- Footer'daki eski yıl ("© 2023", "2022-2023") güncel yılla değiştirilir. Bu düzeltme tema kapalıyken de yapılır.

**24 tema, 8 kategori:** Kurumsal, Lüks, Eğlenceli, Teknoloji, Doğa & Sağlık, Yemek & Kafe, Yaratıcı ve Genel. Temalar yalnızca renk değişikliği değildir; her biri kendi yazı tipi eşleşmesi, köşe biçimi, gölge ve kenarlık tarzı, buton stili, arka plan dokusu ve simge çizgisiyle ayrı bir tasarım yönüdür. Tüm temalarda metin kontrastı WCAG AAA (7:1) seviyesindedir.

**Tema nasıl seçilir?** Sitenin konusu isteğinizden anlaşılır (ör. "kafe" → Yemek & Kafe). Konu belirsizse ya da birden fazla konu varsa model, ilk adımından önce tek bir kısa soruyu cevaplar ("bu hangi tür site?"). Bu soru küçük modellerde birkaç saniye sürer. "Koyu tema" veya "dark mode" derseniz koyu temalardan biri seçilir.

**Ne zaman devreye girmez?**
- Klasörde zaten bir site varsa, çünkü mevcut tasarım korunur.
- React, Tailwind, Bootstrap gibi bir framework istediyseniz.
- "Tek dosya", "sadece HTML" gibi bir kısıt verdiyseniz.
- Kendi renklerinizi belirttiyseniz ("mavi tonlarında", "#1e3a8a"). Bu durumda renk teması uygulanmaz, yalnızca temel stil kullanılır. Kendi yazı tipinizi belirttiyseniz yazı tiplerine dokunulmaz.

**Ayarlar › Üretim › Web Tasarımı**
| Ayar | Seçenekler |
| :--- | :--- |
| Tasarım Teması | Konuya göre (önerilen), Rastgele, Sabit tema (önizlemeli seçim), Kapalı |
| Temel CSS | Otomatik (8B altındaki modellerde açık), Açık, Kapalı |
| Web Yazı Tipleri | Açık: yazı tipleri Google Fonts'tan yüklenir. Kapalı: yalnızca cihazdaki yazı tipleri kullanılır, sayfa dışarıya bağlanmaz. |

Tema ve Temel CSS ikisi birden kapalıyken sayfalara hiçbir şey eklenmez.

> **İpucu:** Temanın renklerini değiştirmek için `theme/theme.css` dosyasının başındaki `:root` değişkenlerini düzenlemeniz yeterli (ör. `--theme-accent`). Sayfanın kendi CSS'i her zaman önceliklidir. `theme/theme.css` silinirse sayfa, modelin yazdığı orijinal renklere geri döner.

---

## 🧠 Hangi modeli seçmeliyim?

GPU'suz bir dizüstü bilgisayarda (Ryzen 5 7530U, 16 GB RAM) yerleşik ajan testleriyle ölçülen sonuçlar:

| Model | Boyut | Sonuç | Öneri |
| :--- | :---: | :--- | :--- |
| `qwen2.5-coder:7b` | 4,7 GB | Web sitesi 3,5–10 dk ✅ · hata düzeltme + test 3,3 dk ✅ · ayar dosyası 4,7 dk ✅ · Python komut satırı aracı (gerçek komutlarla test ederek) 9,6 dk ✅ | **En iyi denge**, önerilen |
| `qwen3:8b` | 5,2 GB | Web sitesi 14,5 dk ✅ · hata düzeltme 5,5 dk ✅ · Python aracı 28 dk ✅ | **En titiz**, 2–3 kat yavaş |
| `gemma2:2b` | 1,6 GB | Sayfa onarımı 2,3 dk ✅ · yeni web sitesi son testte 3,7 dk ✅ ama denemeden denemeye tutarsız | **Sohbet ve küçük düzenlemeler** |

- GPU varsa her adım kat kat hızlanır.
- **Ayarlar → Üretim** bölümünden bağlam uzunluğunu, en fazla çıktı uzunluğunu ve (qwen3 gibi modellerde) düşünme modunu ayarlayabilirsiniz. "Otomatik" seçeneği donanımınıza uygun değerleri seçer.

---

## ⌨️ Kısayollar

| Kısayol | İşlev |
| :--- | :--- |
| `Ctrl+N` | Yeni sohbet (Emir Code sekmesinde yeni ajan görevi) |
| `Ctrl+K` | Komut paleti |
| `Ctrl+Shift+M` | Model yöneticisi (indir, sil, bellekten çıkar) |
| `Ctrl+,` | Ayarlar |

---

## ❓ Sık Sorulan Sorular

**İlk adım neden uzun sürüyor?**
Model belleğe yüklenir ve görevin tamamını bir kez okur (GPU'suz bilgisayarda 1–3 dakika sürebilir). Sonraki adımlar Ollama'nın önbelleğini kullandığı için çok daha hızlıdır.

**"DÖNGÜ TESPİT EDİLDİ" veya "İLERLEME YOK" mesajı aldım.**
Model kendini tekrar etmeye başladı. İsteği daha somut yazın (dosya adı, beklenen sonuç) veya daha büyük bir model deneyin.

**Görev "Eksik Tamamlandı" diye bitti.**
Ajan işi yaptı ama otomatik kontrollerin bir kısmı geçmedi; kartta hangi maddelerin doğrulanamadığı yazar. Aynı oturumda `şunu da düzelt: …` diyerek devam edebilirsiniz.

**Güncelledikten sonra görev çubuğunda hâlâ eski simge görünüyor.**
Windows simgeleri önbellekte tutar. Uygulamayı görev çubuğundan kaldırıp yeniden sabitleyin veya oturumu kapatıp açın.

**Linux'ta AppImage açılmıyor.**
AppImage için FUSE 2 gerekir: Ubuntu 24.04'te `sudo apt install libfuse2t64`, 22.04'te `sudo apt install libfuse2`. Ubuntu 23.10+ sürümlerindeki sandbox kısıtlamasını Emir Code kendisi algılar ve uygulamayı yine de başlatır.

**Kodum internete gider mi?**
Hayır. Modeller bilgisayarınızda çalışır. İnternete yalnızca **Web erişimi** özelliği çıkar (arama için DuckDuckGo). Bu özellik varsayılan olarak açıktır; **Ayarlar → Web Erişimi**'nden tamamen veya sohbet/ajan için ayrı ayrı kapatabilirsiniz.
