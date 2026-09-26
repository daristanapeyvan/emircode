# Emir Code Kullanım Kılavuzu

Emir Code, yapay zekâ modellerini Ollama ile kendi bilgisayarınızda çalıştıran bir masaüstü uygulamasıdır. Modelle sohbet edebilir ya da bir proje klasöründe kod yazan, hata düzelten ve test çalıştıran bir ajan kullanabilirsiniz. İstekleriniz ve kodunuz yalnızca bilgisayarınızdaki Ollama'ya gider.

---

## Kurulum

1. [ollama.com](https://ollama.com) adresinden Ollama'yı indirip kurun.
2. Bir model indirin. Bunu terminalden ya da Emir Code'un Model Yöneticisi'nden (`Ctrl+Shift+M`) yapabilirsiniz:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   Bu model yaklaşık 4,7 GB'tır; indirme süresi bağlantınıza bağlıdır.
3. [Sürümler sayfasından](https://github.com/daristanapeyvan/emircode/releases) Emir Code'u indirin: Windows için `Emir.Code.Setup.X.Y.Z.exe`, Linux için `.deb`, `.rpm`, `.AppImage` ya da `emir-code-setup-linux.sh`.
4. Uygulamayı açın ve başlık çubuğundaki model seçiciden modelinizi seçin.

İlk açılışta kurulum sihirbazı Ollama ile Node.js'i kontrol eder; eksik olanları sizin onayınızla resmî kaynaklardan indirip kurabilir. Ollama kurulu ama kapalıysa Emir Code onu kendisi başlatır. Node.js zorunlu değildir; ajanın projelerinizde `npm` komutları çalıştırabilmesi için gerekir.

---

## Sohbet

Kenar çubuğunun üstünden **Sohbet** ile **Kod** arasında geçersiniz.

| Ne yapmak istiyorsunuz? | Örnek |
| :--- | :--- |
| Kod açıklatmak | `Bu fonksiyon ne işe yarıyor?` (ardından kodu yapıştırın) |
| Hata mesajı çözdürmek | `"TypeError: Cannot read properties of undefined" hatası neden olur, nasıl düzeltirim?` |
| Kod yazdırmak | `Python'da bir CSV dosyasını okuyup sütun ortalamalarını hesaplayan fonksiyon yaz` |
| Güncel bilgi sormak (Web açıkken) | `Linus Torvalds kimdir?` · `Node.js'in güncel LTS sürümü hangisi?` |
| Dosya veya görsel hakkında sormak | Ataş düğmesiyle bir dosya ya da görsel ekleyip `bu dosyadaki hataları bul` |

- Mesaj kutusundaki **Web** (dünya simgesi) açıkken güncel bilgi gerektiren sorular önce DuckDuckGo'da aranır, cevap arama sonuçlarından yazılır; mesajda neyin arandığı görünür. Model yine de "internete erişimim yok" derse uygulama aramayı kendisi yapar ve cevabı yeniden üretir.
- Açık sohbetin üretim ayarları Ayarlar › Üretim'dedir. Hazır önayarlar: Dengeli, Kesin, Yaratıcı, Kodlama.
- Mesaj kutusundaki **Sistem yönergeleri** düğmesinde Genel asistan, Kıdemli geliştirici ve Çok kısa hazır gelir; kendi yönergenizi de yazabilirsiniz.
- Görsel sorabilmek için görsel girdisini destekleyen bir model gerekir (ör. `llama3.2-vision`, `gemma3`).

---

## Kod sekmesi (ajan)

Kod sekmesinde **Yeni Proje** ile yeni bir proje başlatın ya da **Var olan bir klasörü aç…** ile elinizdeki bir projeyi açın, sonra ne istediğinizi yazın. Ajan dosyaları okur, kod yazar, gerekirse test çalıştırır ve sonucu özetler.

### Projeler ve görevler
- **Yeni Proje** (`Ctrl+Shift+N`) penceresinde ne yapmak istediğinizi (Boş proje, Website, Mini Uygulama, Betik), proje adını ve konumu seçersiniz. Konum varsayılan olarak Belgeler klasöründeki "Emir Code Projeleri"dir; **Değiştir** ile başka bir yer seçebilirsiniz, son seçtiğiniz konum hatırlanır.
- Boş proje **Oluştur**'a bastığınızda açılır. Sihirbaz seçtiyseniz klasör, sihirbazda **Onayla**'ya bastığınızda oluşturulur; sihirbazı yarıda kapatırsanız diskte bir şey kalmaz. Aynı adda dolu bir klasör varsa kullanılmaz, uyarı çıkar.
- Görevler proje klasörlerine göre gruplanır; en son kullandığınız proje en üsttedir, açık proje kalın yazılır.
- Proje adının yanındaki **+** o projede yeni görev açar (açık projede her zaman, diğerlerinde fareyle üzerine gelince görünür). `Ctrl+N` açık projede yeni görev açar.
- Proje adına tıklamak listeyi daraltır ya da açar. Her projede son 5 görev görünür, gerisi "… tane daha göster" ile açılır. Görevin yanında ne zaman üzerinde çalışıldığı yazar (ör. `5 dk`, `2 g`); çalışan görevde dönen bir simge görünür.
- Taşınmış ya da silinmiş klasörler soluk ve uyarı işaretiyle gösterilir. Klasörü kaydedilmemiş eski görevler "Klasörsüz" altında toplanır.
- Çalışan bir görevden başka bir göreve ya da projeye geçerken görevin durdurulup durdurulmayacağı sorulur.
- **Dosyalar** paneli başta kapalıdır; proje çubuğundaki ağaç simgesiyle açılır ve seçiminiz hatırlanır.
- Sohbet sekmesinde yalnızca sohbetler, tarihe göre listelenir.

### Örnek istekler

| Ne yapmak istiyorsunuz? | Örnek istek |
| :--- | :--- |
| Web sitesi yapmak | `Bir kahve dükkânı için tek sayfalık modern bir web sitesi oluştur: menü (en az 6 ürün, fiyatlarıyla), hakkımızda ve iletişim bölümleri olsun. Duyarlı (responsive) olsun ve iletişim formu JavaScript ile doğrulansın.` |
| Sonradan değişiklik istemek | `Başlıkların rengini koyu mavi yap ve sayfanın en altına telif yazısı olan bir footer ekle.` |
| Komut satırı aracı yazmak | `Python ile komut satırından çalışan bir yapılacaklar listesi yaz: ekle, listele, tamamla ve sil komutları olsun; veriler todos.json dosyasında saklansın.` |
| Hata düzeltip testle doğrulamak | `İndirim uygulanınca sepet toplamı yanlış hesaplanıyor; düzelt ve npm test ile doğrula.` |
| Ayar dosyası düzenlemek | `package.json dosyasına node src/index.js çalıştıran bir start betiği ekle.` |
| Bozuk bir sayfayı onarmak | `Sayfada script ve CSS etiketleri eksik kalmış, düzelt.` |
| Projeyi anlamak | `src klasöründeki ödeme akışını adım adım açıkla.` |

### Görev nasıl yürür?
1. Birden fazla ayrı iş istiyorsanız bunları numaralı ya da madde işaretli liste olarak yazın veya "sonra" ile bağlayın; ajan bunları eksiksiz tamamlaması gereken bir kontrol listesine alır. Bunun dışındaki her istek, kaç cümle olursa olsun tek görev sayılır.
2. Ajanın yazdığı her dosya otomatik kontrol edilir (HTML, CSS, JavaScript/TypeScript, Python, JSON, YAML, Java, C#, Go, Rust ve diğerleri). Kapanmamış parantez, bozuk girinti, yarım kalmış dosya ya da "içerik buraya gelecek" gibi yer tutucular satır numarasıyla modele bildirilir.
3. Web sayfası isteklerinde görev ancak sayfada gerçek CSS kuralları, istek etkileşim gerektiriyorsa çalışan JavaScript, mobil görünüm (viewport) etiketi ve var olan dosyalara giden bağlantılar varsa "tamamlandı" sayılır. Menü bağlantılarının çalışmasını istediğinizde her bağlantının bir bölüme, sayfaya ya da JavaScript işlevine gittiği de kontrol edilir. Eksik kalırsa model düzeltmeye geri gönderilir; yine olmazsa görev, geçmeyen kontroller listelenerek "eksik" biter.
4. Çalışan bir dosyayı bozacak değişiklik uygulanmaz. `package.json` gibi dosyalarda mevcut anahtarlar silinmez, bozuk JSON yazılmaz. Siz istemedikçe mevcut testler değiştirilemez; test başarısızsa ajan kodu düzeltmek zorundadır.
5. Model aynı adımı tekrarlarsa uyarılır. Art arda 3 tekrar ya da 10 adım boyunca ilerleme olmazsa görev bir mesajla durdurulur; otomatik kontrollerin hepsi o ana kadar geçmişse görev bir notla tamamlanmış sayılır.
6. Aynı oturumdaki bir sonraki istek, öncekinde ne istendiğini ve hangi dosyaların değiştiğini bilir. "Şimdi stil ekle" demeniz yeterlidir.

Ajan çalışırken mesaj kutusuna yeni bir talimat yazıp **Talimatı gönder** ile araya girebilirsiniz; talimat çalışan göreve eklenir.

### Değişiklikleri siz kontrol edersiniz
- Her değişiklik satır satır fark (diff) olarak gösterilir. Sıkı profilde hangi dosyaların uygulanacağını seçebilirsiniz.
- Proje çubuğundaki **Değişiklikleri geri al (n)** düğmesi, ajanın o oturumda değiştirdiği tüm dosyaları önceki hâline döndürür; bu dosyalarda sonradan sizin yaptığınız değişiklikler de geri alınır. **Silmeden önce sor** açıksa önce onay istenir. Önceki içerikler bellekte tutulduğu için geri alma yalnızca Emir Code kapanana kadar mümkündür.
- **Kayıtlar** paneli (proje çubuğundaki panel düğmesi) ajanın olaylarını ve modelin ham çıktısını gösterir.

### Onay seviyeleri
Proje çubuğundaki **Onay** seçicisinden ya da Ayarlar › Genel › Ajan onayları'ndan seçilir.

| Seviye | Dosya değişiklikleri | Komutlar | Dosya silme | Ajan soru sorar mı? |
| :--- | :--- | :--- | :--- | :--- |
| Sıkı (varsayılan) | Sizin onayınızla | Sizin onayınızla | Sizin onayınızla | Evet |
| Dengeli | Onay istenmeden | Sizin onayınızla | Sizin onayınızla | Evet |
| Otonom | Onay istenmeden | Test komutları (`npm test`, `pytest`, `cargo test`) onay istenmeden, diğerleri sizin onayınızla | Sizin onayınızla | Hayır, kendisi karar verir |

Hiçbir seviyede ajan proje klasörünün dışına yazamaz. `.env` dosyaları, `.git`, `node_modules`, derleme çıktı klasörleri ile anahtar ve sertifika dosyaları ajana kapalıdır. Çalıştırabileceği komutlar yalnızca `npm test`, `npm run test|build|lint|typecheck|check`, `node`, `python`, `pytest` ve `cargo`'dur; `npx` ve kabuk komutları engellenir.

---

## Oluşturma sihirbazları

Sihirbazlar **Yeni Proje** penceresinde türü seçince açılır: Website, Mini Uygulama ya da Betik. Proje klasörü sihirbazı onayladığınızda oluşturulur.

Hiçbir sihirbaz görevi kendiliğinden başlatmaz. **Onayla**'ya bastığınızda hazırlanan istek mesaj kutusuna gelir ve üstünde küçük bir etiket görünür. İsteği okuyabilir, değiştirebilir ya da ek isteklerinizi yazabilirsiniz; gönder düğmesine siz basarsınız. Etiketteki **Sihirbazı aç** seçtiğiniz ayarlara geri götürür, **×** isteği kaldırır. İsteği düzenleseniz de seçtiğiniz tema, sayfa planı ve kontroller istekle birlikte gider.

### Website Oluştur
Birkaç soruyla sitenizi tarif edersiniz; uygulama cevaplarınızdan ayrıntılı bir istek hazırlar. Sihirbazın üstünden iki mod arasında istediğiniz an geçebilirsiniz:

| Mod | Adımlar |
| :--- | :--- |
| Basit | Site (ad, tür, kısa tanım) › Tasarım › Yapı (tek sayfa ya da çok sayfalı, bölümler) › Özet |
| Kapsamlı | Site (slogan, hedef kitle, sayfa dili ve yazım tonu dahil) › Tasarım › Sayfalar & İçerik › İletişim › İşlevler › Özet |

- **Sayfalar & İçerik:** Sayfa ekleyip çıkarabilir, adlarını ve sıralarını değiştirebilirsiniz. Her sayfaya bölüm eklenir (Karşılama, Hakkımızda, Hizmetler, Menü, Galeri, Fiyatlar, Yorumlar, SSS, İletişim ve diğerleri). Bir bölüme kendi metninizi yazarsanız sayfaya aynen konur; boş bıraktığınız bölümlerin metnini ajan yazar.
- **Metin kutusu:** Araç çubuğunda kalın, italik, ara başlık, madde listesi, numaralı liste, alıntı ve bağlantı vardır (kısayollar: Ctrl+B, Ctrl+I, Ctrl+K). Listede Enter yeni madde açar, boş maddede Enter listeyi bitirir. **Önizleme** ile sonucu görebilirsiniz.
- **Tasarım:** Konunuza uyan temalar önerilir; 24 temanın hepsi küçük önizlemeleriyle listelenir. "Tema kullanma" seçilirse modelin kendi tasarımı kalır.
- **İşlevler:** İletişim formu, mobil menü, yumuşak kaydırma, açılır SSS, yukarı çık düğmesi, belirme animasyonları, açık/koyu düğmesi, WhatsApp düğmesi, harita, galeri büyütme ve bülten kutusu. Ayrıca görsel türünü (renkli yer tutucular ya da örnek fotoğraflar) ve SEO başlığı ile açıklamasını seçersiniz.
- **Özet:** Seçimlerinizi ve proje klasörünü gösterir; klasör boş değilse uyarır.

Çok sayfalı sitelerde her sayfa kontrol listesinde ayrı bir madde olur; mesaj kutusunda bir sayfayı istekten silerseniz o sayfa listeden de çıkar. Taslağınız otomatik kaydedilir, sihirbazı kapatsanız ya da uygulamadan çıksanız da kaybolmaz. **Sıfırla** ile baştan başlarsınız.

### Mini Uygulama
Tek dosyalık (`index.html`) küçük web araçları hazırlar. Harici kütüphane kullanmazlar ve çift tıklayınca tarayıcıda açılırlar.

1. Soldan bir kategori seçin.
2. Aracın kartına tıklayın; aracın kendi ayar sayfası açılır.
3. Anahtarları, seçimleri, sayıları ve listeleri ayarlayın.
4. **Çıktı** bölümünde uygulamanın adını, arayüz dilini ve tasarım temasını seçin. Tema varsayılan olarak aracın türüne uygun olandır.
5. **Geri** ile kataloğa dönersiniz; ayarlarınız kaybolmaz.

| Kategori | Araçlar |
| :--- | :--- |
| Hesaplama | Hesap Makinesi, Birim Çevirici, Kredi Hesaplayıcı, Hesap Bölüşme, Tarih Hesaplayıcı |
| Verimlilik | Pomodoro Zamanlayıcı, Yapılacaklar Listesi, Not Defteri, Geri Sayım & Kronometre |
| Takip | Harcama Takibi, Alışkanlık Takibi, VKİ Hesaplayıcı |
| Yardımcı Araçlar | Şifre Üretici, Renk Paleti Üretici, Metin Araçları, Rastgele Seçici |
| Eğlence & Öğrenme | Bilgi Yarışması, Bilgi Kartları, Yazma Hızı Testi, Hafıza Oyunu, Yılan Oyunu |

Her aracın isteğinde küçük modellerin sık yaptığı hatalara karşı kurallar vardır: hesap makinesinde `eval` kullanılmaz, şifreler ve çekilişler güvenli rastgelelikle üretilir, zamanlayıcılar sekme arka plandayken de doğru sayar, para ve tarih biçimi tarayıcının dil ve bölge ayarından gelir.

### Betik
Dosyalarınız üzerinde çalışan komut satırı araçları hazırlar. Betikler Python (yalnızca standart kütüphane) ya da Node.js (yalnızca yerleşik modüller) ile yazılır.

| Kategori | Betikler |
| :--- | :--- |
| Dosya & Klasör | Toplu Yeniden Adlandırma, Klasör Düzenleyici, Yinelenen Dosya Bulucu, Klasör Yedekleme (ZIP), Klasör Boyutu Raporu |
| Veri | CSV Birleştirme, CSV ↔ JSON Dönüştürücü, CSV Özet Raporu, JSON Doğrulayıcı & Biçimlendirici |
| Metin | Toplu Bul & Değiştir, Dosyalarda Ara, E-posta & Bağlantı Ayıklayıcı, Kelime Sıklığı Analizi |

Dosya değiştiren her betikte şu kurallar geçerlidir:
- Betik varsayılan olarak yalnızca önizleme yapar: ne yapacağını listeler, hiçbir şeyi değiştirmez. Değişiklik için `--uygula` eklenir (İngilizce arayüzde `--apply`).
- Hiçbir dosya silinmez ya da üzerine yazılmaz. İçeriği değişecek dosyalar önce `_yedek_…` klasörüne kopyalanır.
- Betik verilen klasörün dışına çıkmaz.
- Her işlem `islem_kaydi.csv` dosyasına yazılır. Taşıma ve adlandırma betiklerinde **Geri alma** ayarını açarsanız `--geri-al` son çalıştırmayı geri alır.

Bu kuralları uygulayan hazır bir modül (`guvenli_islem.py` ya da `.js`, İngilizce arayüzde `safe_actions`) isteği gönderdiğinizde betiğin yanına yazılır; Sıkı profilde bunun için onayınız istenir, aynı adda bir dosya varsa ona dokunulmaz. Ajan yalnızca betiğin kendisini yazar (seçenekler ve hangi dosyaya ne yapılacağının listesi); dosyalara modül dokunur. Betiği başka bir yere taşırsanız modülü de yanında taşıyın.

**Örnek veriyle dene** açıksa ajan betiği yazdıktan sonra küçük bir `ornek_veri` klasörü oluşturur, betiği bu klasörde çalıştırır ve sonucu kontrol eder; komutları çalıştırmak için izniniz istenir. Toplu Yeniden Adlandırma'da kalıbın örnek dosya adlarına etkisini ayar sayfasında hemen görürsünüz; kalıpta `{ad}`, `{uzanti}`, `{sayac:03}` ve `{tarih}` kullanılabilir.

---

## Web tasarım temaları

Ajan yeni bir web sayfası oluşturduğunda, işini bitirdikten sonra sayfaya bir tasarım teması uygulanır. Model tema dosyalarını görmez ve onlarla uğraşmaz.

Tema uygulandığında:
- Proje klasörüne `theme/theme.css` yazılır ve sayfaya bağlanır. Dosyada renkler, yazı tipleri ve buton, form, tablo, kart ve bölüm boşlukları için temel stiller bulunur.
- Sayfanın renkleri ve yazı tipleri temadaki karşılıklarına bağlanır; koyu ya da renkli alanlardaki yazılar okunur kalır.
- Özellik kartlarındaki ve iletişim satırlarındaki simge olarak kullanılmış emojiler SVG simgelere dönüşür.

Tema kullanılsın ya da kullanılmasın, ajanın yazdığı sayfalarda şunlar da düzeltilir:
- Footer'daki eski telif yılı güncel yılla değiştirilir; eksik viewport etiketi eklenir.
- Telefonda açılmayan ya da bağlantı seçilince kapanmayan hamburger menü onarılır. Zaten çalışan menülere dokunulmaz.
- Tema ve temel CSS kullanılmıyorsa, hiçbir CSS kuralının biçimlendirmediği butonlara sayfanın vurgu renginde sade bir görünüm verilir.

24 tema, 8 kategoride toplanır: Kurumsal, Lüks, Eğlenceli, Teknoloji, Doğa & Sağlık, Yemek & Kafe, Yaratıcı ve Genel. Her temanın kendi renkleri, yazı tipi eşleşmesi, köşe ve gölge biçimi, buton stili, arka plan dokusu ve simge çizgisi vardır. Tüm temalarda metin kontrastı en az 7:1'dir (WCAG AAA).

**Tema nasıl seçilir?** Sitenin konusu isteğinizdeki kelimelerden anlaşılır (ör. "kafe" › Yemek & Kafe). Konu belirsizse ya da birden fazla konu eşleşirse model, ilk adımından önce kısa bir soruyu cevaplar ("bu hangi tür site?"). "Koyu tema" ya da "dark mode" derseniz koyu temalardan biri seçilir.

**Tema ne zaman uygulanmaz?**
- Klasörde zaten bir site varsa (mevcut tasarım korunur).
- React, Tailwind, Bootstrap gibi bir framework istediyseniz.
- "Tek dosya", "sadece HTML" gibi bir kısıt verdiyseniz.
- Kendi renklerinizi belirttiyseniz ("mavi tonlarında", "#1e3a8a"). Bu durumda yalnızca temel stil kullanılır. Kendi yazı tipinizi belirttiyseniz yazı tiplerine dokunulmaz.

**Ayarlar › Web tasarımı**

| Ayar | Seçenekler |
| :--- | :--- |
| Tasarım teması | Konuya göre (önerilen), Rastgele, Sabit tema (önizlemeli seçim), Kapalı |
| Temel CSS | Otomatik (8B altındaki modellerde açık), Açık, Kapalı |
| Web yazı tipleri (Google Fonts) | Açık: yazı tipleri Google Fonts'tan yüklenir. Kapalı: yalnızca cihazdaki yazı tipleri kullanılır, sayfa dışarıya bağlanmaz. |

Tasarım teması ve Temel CSS ikisi de kapalıyken sayfaya tema dosyası eklenmez.

Temanın renklerini değiştirmek için `theme/theme.css` dosyasının başındaki `:root` değişkenlerini düzenleyebilirsiniz (ör. `--theme-accent`). Sayfanın kendi CSS'i her zaman önceliklidir. `theme/theme.css` silinirse sayfa, modelin yazdığı orijinal renklere döner.

---

## Model indirme

`Ctrl+Shift+M` ile açılan Model Yöneticisi'nin **Keşfet** sekmesi, Ollama kütüphanesini ollama.com'dan kendiliğinden getirir.

- **Kategoriler:** Önerilen (ajan testlerimizde kullanılan modeller), Kodlama, Ajan ve araç kullanımı, Akıl yürütme, Görüntü ve ses, Hafif (4B ve altı), Sohbet ve genel, Gömme (arama) ve Tümü. Üstteki kutudan ada ya da açıklamaya göre arayabilirsiniz. Yalnızca ollama.com bulutunda çalışan modeller listelenmez.
- **Boyut:** Bir modele tıklayınca tüm boyutları görünür (ör. qwen3 için 0.6B'den 235B'ye). Bu bilgisayarda rahat çalışan en büyük boyut önceden seçilidir.
- **Nicemleme:** Varsayılan (Q4_K_M) ile daha doğru ama daha büyük seçenekler (Q5_K_M, Q6_K, Q8_0, FP16) dosya boyutları ve kısa açıklamalarıyla listelenir. Her satırda "Rahat çalışır", "Sınırda: yavaş çalışabilir" ya da "Belleğe sığmaz" yazar. Seyrek nicemlemeler ve diğer sürümler **Diğer sürümler** altındadır.
- **Doğrulama:** Seçtiğiniz etiket, Ollama'nın indirme yaptığı kayıt deposunda kendiliğinden kontrol edilir ve kesin boyutu gösterilir. İndirme bitince model depodakiyle karşılaştırılır. **Yüklü** sekmesi her modelin güncel olup olmadığını gösterir; yeni sürüm varsa **Güncelle** düğmesi çıkar.
- Listede olmayan bir modeli ya da etiketi (ör. `qwen3:14b-q8_0`) alttaki kutuya yazabilirsiniz; indirmeden önce kontrol edilir.
- İnternet yoksa en son alınan liste, o da yoksa kısa bir yerleşik liste gösterilir. Liste 12 saatte bir yenilenir.

**Çalışan** sekmesi bellekte yüklü modelleri gösterir; buradan bir modeli bellekten çıkarabilirsiniz.

---

## Hangi modeli seçmeliyim?

Ajan testlerinin (`scripts/agent-e2e.ts`) GPU'suz bir dizüstü bilgisayardaki (Ryzen 5 7530U, 16 GB RAM) sonuçları. Süreler donanıma göre değişir; GPU varsa her adım çok daha hızlıdır.

| Model | Boyut | Sonuç | Ne için? |
| :--- | :---: | :--- | :--- |
| `qwen2.5-coder:7b` | 4,7 GB | Web sitesi 3,5–10 dk · hata düzeltme ve test 3,3 dk · ayar dosyası 4,7 dk · Python komut satırı aracı (gerçek komutlarla test ederek) 9,6 dk | Ajan görevleri (önerilen) |
| `qwen3:8b` | 5,2 GB | Web sitesi 14,5 dk · hata düzeltme 5,5 dk · Python aracı 28 dk | Daha titiz iş; CPU'da 2–3 kat yavaş |
| `gemma2:2b` | 1,6 GB | Sayfa onarımı 2,3 dk · yeni web sitesi son denemede 3,7 dk, denemeden denemeye tutarsız | Sohbet ve küçük düzenlemeler |

Ayarlar › Ajan'dan bağlam uzunluğunu, adım başına en fazla çıktıyı ve qwen3 gibi düşünen modeller için "Adımlardan önce düşün" seçeneğini ayarlayabilirsiniz. "Otomatik", bu bilgisayara uygun değerleri seçer.

---

## Kısayollar

| Kısayol | İşlev |
| :--- | :--- |
| `Ctrl+N` | Yeni sohbet (Kod sekmesinde açık projede yeni görev) |
| `Ctrl+Shift+N` | Yeni Proje |
| `Ctrl+K` | Komut paleti |
| `Ctrl+Shift+M` | Model Yöneticisi |
| `Ctrl+,` | Ayarlar |

---

## Sık sorulan sorular

**İlk adım neden uzun sürüyor?**
Model belleğe yüklenir ve görevin tamamını bir kez okur; GPU'suz bir bilgisayarda bu 1–3 dakika sürebilir. Sonraki adımlar Ollama'nın önbelleğini kullandığı için daha hızlıdır.

**"DÖNGÜ TESPİT EDİLDİ" ya da "İLERLEME YOK" mesajı aldım.**
Model kendini tekrar etmeye başladı ya da ilerleyemedi. İsteği daha somut yazın (dosya adı, beklenen sonuç) veya daha büyük bir model deneyin.

**Görev "Görev Eksik Tamamlandı" diye bitti.**
Ajan işi yaptı ama otomatik kontrollerin bir kısmı geçmedi; kartta hangilerinin geçmediği yazar. Aynı oturumda `şunu da düzelt: …` diyerek devam edebilirsiniz.

**Uygulamayı kapatıp açtım, "Değişiklikleri geri al" çalışmıyor.**
Önceki dosya içerikleri yalnızca bellekte tutulur ve uygulama kapanınca silinir. Geri almayı uygulamayı kapatmadan yapın; kalıcı bir geri dönüş noktası için projede git kullanın.

**Güncellemeden sonra görev çubuğunda hâlâ eski simge görünüyor.**
Windows simgeleri önbellekte tutar. Uygulamayı görev çubuğundan kaldırıp yeniden sabitleyin ya da oturumu kapatıp açın.

**Linux'ta AppImage açılmıyor.**
AppImage için FUSE 2 gerekir: Ubuntu 24.04'te `sudo apt install libfuse2t64`, 22.04'te `sudo apt install libfuse2`. Ubuntu 23.10 ve sonrasındaki sandbox kısıtlamasını Emir Code algılar ve uygulamayı sandbox olmadan başlatır.

**Kodum internete gider mi?**
Hayır. Modeller bilgisayarınızda çalışır. Emir Code internete yalnızca şunlar için bağlanır: web erişimi (aramalar DuckDuckGo'ya gider, ajan web sayfası da açabilir), Model Yöneticisi (Keşfet ve Yüklü sekmeleri açıkken model listesi için ollama.com, doğrulama için Ollama kayıt deposu) ve siz istediğinizde kurulum sihirbazının Ollama ya da Node.js indirmesi. Web erişimi varsayılan olarak açıktır; Ayarlar › Web erişimi'nden tamamen ya da sohbet ve ajan için ayrı ayrı kapatabilirsiniz.
