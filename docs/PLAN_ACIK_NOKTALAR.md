# Plan: Açık noktalar (Emir Code 2.x yol haritası)

Emir Code 2.0 ile bulut modelleri (Ollama Cloud, Claude, GPT) geldi; tasarımı [PLAN_BULUT_MODELLERI.md](./PLAN_BULUT_MODELLERI.md) anlatıyor. Bu belge, o planda açık kalan ve "sonraki adımlar" olarak bırakılan işleri sürümlere bölerek planlar: her iş için neden gerektiği, nasıl yapılacağı, hangi dosyalara dokunacağı, ne zaman bitmiş sayılacağı ve nasıl test edileceği.

---

## Özet

| # | İş | Hedef sürüm | Büyüklük | Öncelik |
| --- | --- | --- | --- | --- |
| 1 | Gerçek anahtarlarla canlı doğrulama (kılavuz + duman testi betiği) | 2.0.x | Küçük | Yüksek |
| 2 | Hata mesajlarında anahtar maskeleme | 2.0.x | Küçük | Yüksek |
| 3 | Bulut modelleri için ajan kıyaslaması | 2.1 | Orta | Yüksek |
| 4 | Maliyet göstergesi ve görev bütçesi | 2.1 | Orta | Yüksek |
| 5 | Model seçicide görünen bulut modellerini seçme | 2.1 | Küçük | Orta |
| 6 | Akıl yürütme ayarları: Claude çabası, OpenAI akıl yürütme özetleri | 2.1 | Orta | Orta |
| 7 | Ollama Cloud iyileştirmeleri (kullanım sınırı, örnek sayfa testleri) | 2.1 | Küçük | Orta |
| 8 | OpenAI uyumlu özel adres (OpenRouter, LM Studio, vLLM, Azure) | 2.2 | Orta | Orta |
| 9 | Google Gemini ve Mistral sağlayıcıları | 2.2 | Orta | Düşük |
| 10 | Sağlayıcıların yerel araç çağırma biçimi: ölçüm ve karar | 2.3 | Büyük (araştırma) | Düşük |

Her sürümün ortak kuralları değişmez: anahtarlar main process'te kalır, sağlayıcı katmanı ağsız testlerle (`test_cloud_providers.ts`) korunur, her metin `en.ts` ve `tr.ts`'de bulunur, belgeler aynı sürümde güncellenir.

---

## 1. Gerçek anahtarlarla canlı doğrulama — 2.0.x

**Neden.** 2.0'daki sağlayıcı katmanı sahte istemcilerle uçtan uca test edildi; gerçek API'lerin bir alanı reddetmesi ya da akış biçiminin değişmesi ancak canlı denemede görülür.

**Yaklaşım.**
- `scripts/cloud-smoke.ts`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_API_KEY` ortam değişkenlerinden hangisi varsa o sağlayıcı için `CloudService`'i Electron olmadan (anahtar deposu yalnızca ortam değişkeniyle) kurar ve her biri için:
  1. model listesini okur,
  2. kısa bir sohbet cevabı akıtır (`"Reply with OK"`),
  3. ajanın şemasıyla tek bir JSON eylemi ister ve `ToolDispatcher` ile ayrıştırır,
  4. düşünme açıkken bir istek gönderir,
  5. sonuçları ve token sayılarını tablo olarak yazar.
- `docs/KULLANIM.md` ve `CONTRIBUTING.md`'ye elle doğrulama listesi: anahtar kaydetme/kaldırma, Linux'ta anahtar deposu olmadan, yanlış anahtar, sohbette görsel, ajan görevi, durdurma, `ollama signin` ile bulut etiketi.
- İsteğe bağlı CI işi (`workflow_dispatch`, depo gizli değişkenleriyle): yalnızca depo sahibi elle başlatır; çatal (fork) PR'larında hiç çalışmaz, böylece anahtarlar dışarı açılmaz.

**Dosyalar.** `scripts/cloud-smoke.ts` (yeni), `.github/workflows/cloud-smoke.yml` (yeni), `CONTRIBUTING.md`.

**Bitti sayılır.** Üç sağlayıcının her biri için betik beş adımı da geçer; bir alan reddedilirse betik hangi isteğin neden reddedildiğini yazar.

---

## 2. Hata mesajlarında anahtar maskeleme — 2.0.x

**Neden.** Bazı sağlayıcılar hatalı anahtarın bir kısmını hata metnine yazar. 2.0'da bu metin arayüzde "ayrıntı" olarak görünebilir ve günlüklere düşebilir.

**Yaklaşım.** `electron/cloud/errors.ts` içinde `classifyCloudError`'ın döndürdüğü mesajdan bilinen anahtar biçimleri (`sk-…`, `sk-ant-…`, `sk-proj-…`, uzun base64/hex dizileri) ve o an kullanılan anahtarın kendisi `…abcd` biçimine indirilir. Anahtar deposu, maskelenecek değerleri `CloudService`'e verir.

**Bitti sayılır.** Anahtarı içeren her sağlayıcı hata metni, arayüze ve günlüğe maskelenmiş ulaşır. `test_cloud_providers.ts`'e örnek hata metinleriyle kontroller eklenir; `verify_functionality.js` maskelemenin kullanıldığını denetler.

---

## 3. Bulut modelleri için ajan kıyaslaması — 2.1

**Neden.** README'deki model tablosu yalnızca yerel modellerin ölçülmüş sonuçlarını gösteriyor. Kullanıcı hangi bulut modelinin ajan görevlerinde ne kadar hızlı, isabetli ve pahalı olduğunu bilmeli.

**Yaklaşım.**
- `scripts/agent-e2e.ts` `anthropic::claude-sonnet-5-5`, `openai::gpt-5`, `ollama-cloud::qwen3-coder:480b` gibi kimlikleri kabul eder. Node'da Electron olmadığı için `scripts/cloud-bridge.ts` (yeni), `window.electronAPI.cloudChat` / `onCloudEvent` / `cloudAbort` / `cloudDescribe`'ı doğrudan `CloudService` ile karşılar.
- Her senaryoda süre, adım sayısı, giriş/önbellek/çıkış token'ları ve (iş 4'teki fiyat tablosuyla) tahmini ücret kaydedilir.
- Sonuçlar README ve `docs/KULLANIM.md`'deki model tablosuna, ölçüm tarihiyle eklenir.

**Dosyalar.** `scripts/agent-e2e.ts`, `scripts/cloud-bridge.ts` (yeni), README, `docs/KULLANIM.md`.

**Bitti sayılır.** En az üç bulut modeli için `web-new`, `js-bugfix`, `python-cli` ve `json-config` senaryoları ölçülmüş ve tabloya yazılmış olur. Kıyaslama ağsız testlere girmez; elle çalıştırılır.

---

## 4. Maliyet göstergesi ve görev bütçesi — 2.1

**Neden.** Bulut modelleri token başına ücretlidir; uzun bir ajan görevi beklenenden pahalı olabilir. 2.0 yalnızca token sayılarını gösteriyor.

**Yaklaşım.**
- `src/lib/providers/pricing.ts`: model başına giriş, önbellekten okuma ve çıkış fiyatları. Fiyatlar zamanla değiştiği için tablo uygulamayla gelir ama **Ayarlar › Bulut modelleri**'nden düzenlenebilir ve "tahmini" olarak gösterilir; fiyatı bilinmeyen modelde yalnızca token sayısı görünür.
- Sohbet mesajında ve ajan görevinin tamamlanma kartında tahmini ücret.
- **Görev bütçesi** ayarı (token ya da tahmini ücret): aşılınca ajan yeni adım başlatmaz, görevi "bütçe doldu" notuyla durdurur ve o ana kadarki değişiklikleri korur. Durma, mevcut sınırlar (adım, süre) gibi `AgentEngine` döngüsünde denetlenir.
- Claude'da ileride `task_budget` (beta) kullanılabilir; ilk sürümde istemci tarafı sınır yeterlidir.

**Dosyalar.** `src/lib/providers/pricing.ts` (yeni), `src/lib/agent/AgentEngine.ts`, `src/components/chat/ChatMessage.tsx`, ajan tamamlanma kartı, `CloudSettings.tsx`, `src/types/settings.ts`, çeviriler.

**Bitti sayılır.** Bütçe aşıldığında görev en geç bir adım sonra durur ve kartta harcama görünür; testlerde sahte kullanım sayılarıyla bütçe aşımı ve fiyatsız model denetlenir.

---

## 5. Model seçicide görünen bulut modellerini seçme — 2.1

**Neden.** OpenAI hesabı onlarca model döndürebilir; seçici kalabalıklaşır.

**Yaklaşım.** **Ayarlar › Bulut modelleri**'nde her sağlayıcının altında model listesi ve "seçicide göster" kutuları. Varsayılan: Claude için en yeni üç model, OpenAI için tarihsiz en yeni beş sohbet modeli, Ollama Cloud için hepsi. Seçim `settings.cloud.visibleModels`'ta saklanır; seçilmeyen modeller komut paletinden ve aramadan yine bulunur.

**Bitti sayılır.** Seçici yalnızca işaretli modelleri gösterir; seçili bir modelin işareti kaldırılırsa sohbetteki model bozulmaz.

---

## 6. Akıl yürütme ayarları — 2.1

**Neden.** "Adımlardan önce düşün" bugün yalnızca açık/kapalı. Claude'un `effort` ayarı ve OpenAI'ın akıl yürütme özetleri hem kaliteyi hem maliyeti belirgin biçimde etkiler.

**Yaklaşım.**
- Claude: Ayarlar › Bulut modelleri'nde "Çaba: Otomatik / Düşük / Orta / Yüksek / En yüksek" → `output_config.effort`. Ajan ve sohbet için ayrı değer (ajanda varsayılan Yüksek, sohbette Düşük önerilir). Modelin desteklemediği düzey (Models API'nin `capabilities.effort` bilgisi) seçilemez.
- OpenAI: akıl yürüten modeller için Responses API'ye geçiş (`reasoning.summary: "auto"`), özetler mevcut düşünme bloğunda (`ReasoningBlock`) görünür. Chat Completions yalnızca akıl yürütmeyen modeller için kalır.
- İki sağlayıcıda da çevirici (translator) testleri genişletilir.

**Bitti sayılır.** Çaba ayarı isteklere yansır ve testlerle denetlenir; GPT-5 ile sohbette akıl yürütme özeti görünür.

---

## 7. Ollama Cloud iyileştirmeleri — 2.1

**Yaklaşım.**
- Saatlik/haftalık kullanım sınırı hataları (`429` ve "usage limit") ayrı bir açıklamayla gösterilir: sınırın ne zaman sıfırlanacağı yazıyorsa o da gösterilir.
- `test_fixtures/ollama/` altına bulut etiketleri olan bir modelin örnek sayfası eklenir; `parseTagsHtml` ve bulut grubu bununla test edilir. `npm run check:library` canlı sayfada bulut etiketlerini de denetler.
- Yerel Ollama'nın oturum durumunun (signin) okunabildiği sürümlerde Ayarlar › Bulut modelleri bunu gösterir; okunamıyorsa bugünkü açıklama kalır.

**Bitti sayılır.** Kullanım sınırı hatası kullanıcıya "kota" yerine "kullanım sınırı" olarak açıklanır; bulut etiketleri örnek sayfayla test edilir.

---

## 8. OpenAI uyumlu özel adres — 2.2

**Neden.** OpenRouter, Groq, LM Studio, vLLM ve Azure OpenAI aynı API'yi konuşur; tek bir sağlayıcı ile pek çok model açılır.

**Yaklaşım.**
- Yeni sağlayıcı `openai-compatible`: ad, temel adres (base URL), isteğe bağlı anahtar. Birden fazla tanım eklenebilir; model kimliği `openai-compatible:<tanım-id>::<model>`.
- **Güvenlik kuralları:** adres `https` olmalı; yalnızca `localhost`/`127.0.0.1` için `http` kabul edilir. Anahtar, kaydedildiği adrese bağlıdır: adres değişirse anahtar silinir ve yeniden istenir. Kaydederken kullanıcıya "anahtar bu adrese gönderilecek" diye açık onay sorulur. Yönlendirmeler izlenmez. Yerel ağ adresleri (web erişimindeki kurallarla) yalnızca kullanıcı açıkça "yerel sunucu" seçtiğinde kabul edilir.
- `openai.ts`'deki istek ve akış çevirisi aynen kullanılır; model listesi `GET {base}/models`. Desteklenmeyen alanlar (ör. `json_schema`) mevcut geri dönüşle bırakılır.
- Belgeler: güvenlik modeline "kullanıcının seçtiği adres" bölümü.

**Bitti sayılır.** LM Studio (yerel) ve OpenRouter (uzak) ile sohbet ve ajan görevi çalışır; adres değişince anahtarın silindiği ve `http` uzak adresin reddedildiği testlerle denetlenir.

---

## 9. Google Gemini ve Mistral — 2.2

**Yaklaşım.**
- Gemini: resmî `@google/genai` SDK'sı, sabit adres; şema `responseSchema` biçimine (OpenAPI alt kümesi) çevrilir; düşünme `thinkingConfig` ile.
- Mistral: resmî SDK ya da OpenAI uyumlu uç; şema `response_format` ile.
- Her biri için anahtar deposu, model listesi, hata kodları ve çevirici testleri; model seçicide kendi başlığı.

**Bitti sayılır.** İki sağlayıcı da `test_cloud_providers.ts`'teki diğer sağlayıcılarla aynı kapsamda test edilir ve iş 1'deki duman testinden geçer.

---

## 10. Yerel araç çağırma biçimi: ölçüm ve karar — 2.3

**Neden.** Ajan bugün her sağlayıcıyla aynı JSON eylem protokolünü kullanıyor (yerel modeller için tasarlandı, büyük modeller de sorunsuz izliyor). Claude ve GPT'nin kendi araç çağırma biçimi (tool use) uzun görevlerde daha az token ve daha iyi paralel okuma sağlayabilir.

**Yaklaşım.**
- Deneysel bir ayar: eylem şemasından araç tanımları üretilir; geçmiş, araç çağrısı / araç sonucu bloklarıyla tutulur. Ajanın denetimleri (onay, dosya kontrolleri, yalıtım) aynı işleyicilerden (`src/lib/agent/run/`) geçer.
- İş 3'teki kıyaslamayla iki biçim karşılaştırılır: başarı oranı, adım sayısı, token ve süre.
- Karar ölçütü: başarı oranı düşmeden token veya süre en az %20 iyileşirse bulut sağlayıcılarında varsayılan olur; değilse deney kaldırılır.

**Bitti sayılır.** Ölçüm sonuçları ve karar bu belgeye yazılır.

---

## Test ve yayın düzeni

- Her iş, ağsız testleriyle birlikte gelir; canlı denemeler (iş 1 ve 3) elle ve yalnızca depo sahibinin anahtarlarıyla yapılır.
- Her sürüm `CHANGELOG.md`'de anlatılır ve `vX.Y.Z` etiketiyle yayınlanır; sürüm iş akışı Windows ve Linux paketlerini üretir.
- Güvenlikle ilgili işler (2, 8) `docs/SECURITY_MODEL.md` güncellenmeden birleştirilmez.
