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
