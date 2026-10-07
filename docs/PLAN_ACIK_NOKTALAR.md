# Plan: Açık noktalar (Emir Code 2.x yol haritası)

Emir Code 2.0 ile bulut modelleri (Ollama Cloud, Claude, GPT) geldi; tasarımı [PLAN_BULUT_MODELLERI.md](./PLAN_BULUT_MODELLERI.md) anlatıyor. Bu belge, o planda açık kalan ve "sonraki adımlar" olarak bırakılan işleri sürümlere bölerek planlar: her iş için neden gerektiği, nasıl yapılacağı, hangi dosyalara dokunacağı, ne zaman bitmiş sayılacağı ve nasıl test edileceği.

> **Durum (2.1.0):** Bütün işler, ilk planda 2.0.x, 2.1, 2.2 ve 2.3'e dağıtılmışken, tek seferde **Emir Code 2.1.0**'da uygulandı. Gerçek anahtar gerektiren adımlar dışında hepsi bitti: (1) canlı duman testinin ve (3) bulut kıyaslamasının **gerçek anahtarlarla çalıştırılması** ve (10) yerel araç çağırma biçimi için **ölçüme dayalı karar** bekliyor. Araçlar hazır (`scripts/cloud-smoke.ts`, `scripts/agent-e2e.ts --native-tools`, `Cloud smoke test` iş akışı); sonuçlar ölçüldükçe bu belgeye ve README'deki model tablosuna yazılacak. Plan dışında, ajanın büyük modellerde randımanlı çalışması için bir "büyük model" kademesi de eklendi (bkz. [Ek: büyük modeller](#ek-büyük-modeller-için-ajan-ayarları)).

---

## Özet

| # | İş | Hedef sürüm | Büyüklük | Öncelik | Durum |
| --- | --- | --- | --- | --- | --- |
| 1 | Gerçek anahtarlarla canlı doğrulama (kılavuz + duman testi betiği) | 2.0.x | Küçük | Yüksek | 2.1.0'da: betik, iş akışı, elle doğrulama listesi. Gerçek anahtarlarla çalıştırma bekliyor |
| 2 | Hata mesajlarında anahtar maskeleme | 2.0.x | Küçük | Yüksek | 2.1.0'da tamam |
| 3 | Bulut modelleri için ajan kıyaslaması | 2.1 | Orta | Yüksek | 2.1.0'da: köprü, token ve ücret ölçümü. Ölçümler bekliyor |
| 4 | Maliyet göstergesi ve görev bütçesi | 2.1 | Orta | Yüksek | 2.1.0'da tamam |
| 5 | Model seçicide görünen bulut modellerini seçme | 2.1 | Küçük | Orta | 2.1.0'da tamam |
| 6 | Akıl yürütme ayarları: Claude çabası, OpenAI akıl yürütme özetleri | 2.1 | Orta | Orta | 2.1.0'da tamam (Gemini düşünme düzeyi dahil) |
| 7 | Ollama Cloud iyileştirmeleri (kullanım sınırı, örnek sayfa testleri) | 2.1 | Küçük | Orta | 2.1.0'da tamam; yerel Ollama'nın oturum durumu okunmuyor (aşağıya bakın) |
| 8 | OpenAI uyumlu özel adres (OpenRouter, LM Studio, vLLM, Azure) | 2.2 | Orta | Orta | 2.1.0'da tamam |
| 9 | Google Gemini ve Mistral sağlayıcıları | 2.2 | Orta | Düşük | 2.1.0'da tamam |
| 10 | Sağlayıcıların yerel araç çağırma biçimi: ölçüm ve karar | 2.3 | Büyük (araştırma) | Düşük | 2.1.0'da deneysel ayar olarak; karar ölçüm bekliyor |

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

**Durum (2.1.0).** `scripts/cloud-smoke.ts` beş sağlayıcıyı ve bir OpenAI uyumlu sunucuyu (`EMIR_COMPAT_URL`) denetler: liste, kısa cevap, şemalı ajan adımı, düşünme ve çaba, yerel araç kipi (Claude, GPT) ve yanlış anahtarın maskelenmesi; sonuç tablo olarak yazılır. Betik `CloudService`'i Electron'suz kurmak için `scripts/cloud-bridge.ts`'i kullanır; sahte bir yerel sunucuyla uçtan uca denendi. `.github/workflows/cloud-smoke.yml` yalnızca elle başlatılır ve yalnızca bu depoda çalışır. Elle doğrulama listesi `docs/KULLANIM.md`'de, kullanımı `CONTRIBUTING.md`'de. **Bekleyen:** gerçek anahtarlarla ilk çalıştırma ve sonucun sürüm notlarına yazılması.

---

## 2. Hata mesajlarında anahtar maskeleme — 2.0.x

**Neden.** Bazı sağlayıcılar hatalı anahtarın bir kısmını hata metnine yazar. 2.0'da bu metin arayüzde "ayrıntı" olarak görünebilir ve günlüklere düşebilir.

**Yaklaşım.** `electron/cloud/errors.ts` içinde `classifyCloudError`'ın döndürdüğü mesajdan bilinen anahtar biçimleri (`sk-…`, `sk-ant-…`, `sk-proj-…`, uzun base64/hex dizileri) ve o an kullanılan anahtarın kendisi `…abcd` biçimine indirilir. Anahtar deposu, maskelenecek değerleri `CloudService`'e verir.

**Bitti sayılır.** Anahtarı içeren her sağlayıcı hata metni, arayüze ve günlüğe maskelenmiş ulaşır. `test_cloud_providers.ts`'e örnek hata metinleriyle kontroller eklenir; `verify_functionality.js` maskelemenin kullanıldığını denetler.

**Durum (2.1.0): tamam.** `redactSecrets` bilinen anahtarları (anahtar deposunun kayıtlı, oturumluk ve ortam anahtarları; o an kullanılan anahtar) ve anahtar biçimli her şeyi (`sk-`, `sk-ant-`, `sk-proj-`, `AIza`, `gsk_`, `Bearer …`, uzun rastgele diziler) `…abcd` biçimine indirir; model adları dokunulmadan kalır. Testler `test_cloud_features.ts`'te; `verify_functionality.js` maskelemenin hizmette kullanıldığını denetler.

---

## 3. Bulut modelleri için ajan kıyaslaması — 2.1

**Neden.** README'deki model tablosu yalnızca yerel modellerin ölçülmüş sonuçlarını gösteriyor. Kullanıcı hangi bulut modelinin ajan görevlerinde ne kadar hızlı, isabetli ve pahalı olduğunu bilmeli.

**Yaklaşım.**
- `scripts/agent-e2e.ts` `anthropic::claude-sonnet-5-5`, `openai::gpt-5`, `ollama-cloud::qwen3-coder:480b` gibi kimlikleri kabul eder. Node'da Electron olmadığı için `scripts/cloud-bridge.ts` (yeni), `window.electronAPI.cloudChat` / `onCloudEvent` / `cloudAbort` / `cloudDescribe`'ı doğrudan `CloudService` ile karşılar.
- Her senaryoda süre, adım sayısı, giriş/önbellek/çıkış token'ları ve (iş 4'teki fiyat tablosuyla) tahmini ücret kaydedilir.
- Sonuçlar README ve `docs/KULLANIM.md`'deki model tablosuna, ölçüm tarihiyle eklenir.

**Dosyalar.** `scripts/agent-e2e.ts`, `scripts/cloud-bridge.ts` (yeni), README, `docs/KULLANIM.md`.

**Bitti sayılır.** En az üç bulut modeli için `web-new`, `js-bugfix`, `python-cli` ve `json-config` senaryoları ölçülmüş ve tabloya yazılmış olur. Kıyaslama ağsız testlere girmez; elle çalıştırılır.

**Durum (2.1.0).** `scripts/agent-e2e.ts` artık `anthropic::…`, `openai::…`, `gemini::…`, `mistral::…`, `ollama-cloud::…` ve `openai-compatible:<id>::…` kimliklerini kabul eder; sonuçlara giriş, önbellek ve çıkış token'ları ile tahmini ücret eklenir; `--effort`, `--budget`, `--context` ve `--native-tools` bayrakları vardır. Köprü sahte bir sunucuyla uçtan uca denendi. **Bekleyen:** gerçek anahtarlarla ölçüm ve tablonun doldurulması.

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

**Durum (2.1.0): tamam.** Fiyat tablosu yalnızca liste fiyatı bilinen modelleri içerir (`PRICES_AS_OF`); fiyatı bilinmeyen modellerde (ör. Claude 5 ailesi) yalnızca token görünür ve kullanıcı fiyatı girer. Bütçe ücret olarak tutulur; %80'de uyarı, aşımda "Görev bütçesi doldu" ile durma. Claude'un önbelleğe yazma ek ücreti ve uzun bağlam katmanları hesaba katılmaz (arayüz "tahmini" der).

---

## 5. Model seçicide görünen bulut modellerini seçme — 2.1

**Neden.** OpenAI hesabı onlarca model döndürebilir; seçici kalabalıklaşır.

**Yaklaşım.** **Ayarlar › Bulut modelleri**'nde her sağlayıcının altında model listesi ve "seçicide göster" kutuları. Varsayılan: Claude için en yeni üç model, OpenAI için tarihsiz en yeni beş sohbet modeli, Ollama Cloud için hepsi. Seçim `settings.cloud.visibleModels`'ta saklanır; seçilmeyen modeller komut paletinden ve aramadan yine bulunur.

**Bitti sayılır.** Seçici yalnızca işaretli modelleri gösterir; seçili bir modelin işareti kaldırılırsa sohbetteki model bozulmaz.

**Durum (2.1.0): tamam.** Varsayılanlara Gemini (en yeni modeller, deneyler hariç), Mistral (`-latest`) ve sunucular (en çok 20 modelliyse hepsi) eklendi. Seçicinin araması gizli modelleri de bulur; grubun altında "Ayarlarda N model daha" bağlantısı vardır.

---

## 6. Akıl yürütme ayarları — 2.1

**Neden.** "Adımlardan önce düşün" bugün yalnızca açık/kapalı. Claude'un `effort` ayarı ve OpenAI'ın akıl yürütme özetleri hem kaliteyi hem maliyeti belirgin biçimde etkiler.

**Yaklaşım.**
- Claude: Ayarlar › Bulut modelleri'nde "Çaba: Otomatik / Düşük / Orta / Yüksek / En yüksek" → `output_config.effort`. Ajan ve sohbet için ayrı değer (ajanda varsayılan Yüksek, sohbette Düşük önerilir). Modelin desteklemediği düzey (Models API'nin `capabilities.effort` bilgisi) seçilemez.
- OpenAI: akıl yürüten modeller için Responses API'ye geçiş (`reasoning.summary: "auto"`), özetler mevcut düşünme bloğunda (`ReasoningBlock`) görünür. Chat Completions yalnızca akıl yürütmeyen modeller için kalır.
- İki sağlayıcıda da çevirici (translator) testleri genişletilir.

**Bitti sayılır.** Çaba ayarı isteklere yansır ve testlerle denetlenir; GPT-5 ile sohbette akıl yürütme özeti görünür.

**Durum (2.1.0): tamam.** Düzeyler: Otomatik, Düşük, Orta, Yüksek, Çok yüksek (`xhigh`), En yüksek (`max`); ajan ve sohbet için ayrı. Claude'da Models API'nin listelediği düzeylere göre en yakın alt düzey seçilir; reddedilen düzeyle istek bir kez çabasız yinelenir. OpenAI'ın akıl yürüten modelleri Responses API'den (`store: false`) gider; özetler düşünme bölümünde görünür ve kuruluş doğrulaması gerektiği için reddedilirse istek özetsiz yinelenir. Gemini'de çaba düşünme düzeyine (3) ya da bütçesine (2.5) dönüşür. Varsayılan "Otomatik"tir (sağlayıcının varsayılanı); plandaki "ajanda Yüksek, sohbette Düşük" önerisi ayarın açıklamasında kalır.

---

## 7. Ollama Cloud iyileştirmeleri — 2.1

**Yaklaşım.**
- Saatlik/haftalık kullanım sınırı hataları (`429` ve "usage limit") ayrı bir açıklamayla gösterilir: sınırın ne zaman sıfırlanacağı yazıyorsa o da gösterilir.
- `test_fixtures/ollama/` altına bulut etiketleri olan bir modelin örnek sayfası eklenir; `parseTagsHtml` ve bulut grubu bununla test edilir. `npm run check:library` canlı sayfada bulut etiketlerini de denetler.
- Yerel Ollama'nın oturum durumunun (signin) okunabildiği sürümlerde Ayarlar › Bulut modelleri bunu gösterir; okunamıyorsa bugünkü açıklama kalır.

**Bitti sayılır.** Kullanım sınırı hatası kullanıcıya "kota" yerine "kullanım sınırı" olarak açıklanır; bulut etiketleri örnek sayfayla test edilir.

**Durum (2.1.0): tamam.** Yeni hata kodu `usage_limit`; sıfırlanma zamanı metinden ya da `Retry-After`'dan okunur. Yerel Ollama üzerinden `-cloud` etiketlerinde de aynı açıklama gösterilir. Örnek sayfa `test_fixtures/ollama/tags_gpt-oss.html` (ollama.com bu geliştirme ortamından erişilemediği için canlı sayfanın biçimiyle elle hazırlandı); `npm run check:library` canlı sayfada bulut etiketlerini denetler. Yerel Ollama'nın oturum durumunu okuyan kararlı bir uç bilinmediği için bu kısım uygulanmadı; oturum açılmamışsa hata metni "ollama signin" demeye devam eder.

---

## 8. OpenAI uyumlu özel adres — 2.2

**Neden.** OpenRouter, Groq, LM Studio, vLLM ve Azure OpenAI aynı API'yi konuşur; tek bir sağlayıcı ile pek çok model açılır.

**Yaklaşım.**
- Yeni sağlayıcı `openai-compatible`: ad, temel adres (base URL), isteğe bağlı anahtar. Birden fazla tanım eklenebilir; model kimliği `openai-compatible:<tanım-id>::<model>`.
- **Güvenlik kuralları:** adres `https` olmalı; yalnızca `localhost`/`127.0.0.1` için `http` kabul edilir. Anahtar, kaydedildiği adrese bağlıdır: adres değişirse anahtar silinir ve yeniden istenir. Kaydederken kullanıcıya "anahtar bu adrese gönderilecek" diye açık onay sorulur. Yönlendirmeler izlenmez. Yerel ağ adresleri (web erişimindeki kurallarla) yalnızca kullanıcı açıkça "yerel sunucu" seçtiğinde kabul edilir.
- `openai.ts`'deki istek ve akış çevirisi aynen kullanılır; model listesi `GET {base}/models`. Desteklenmeyen alanlar (ör. `json_schema`) mevcut geri dönüşle bırakılır.
- Belgeler: güvenlik modeline "kullanıcının seçtiği adres" bölümü.

**Bitti sayılır.** LM Studio (yerel) ve OpenRouter (uzak) ile sohbet ve ajan görevi çalışır; adres değişince anahtarın silindiği ve `http` uzak adresin reddedildiği testlerle denetlenir.

**Durum (2.1.0): tamam.** Sağlayıcı kimliği `openai-compatible:<id>`. Anahtar, adresiyle birlikte şifrelenir; adres değişirse (ör. `cloud_endpoints.json` elle değiştirilirse) anahtar kullanılmaz. Adres düzenlenemez: sunucu kaldırılıp yeniden eklenir (anahtarı da silinir). Yerel ağ adresleri yalnızca "Bu sunucu yerel ağımda" işaretliyse `http` ile kabul edilir. Uzak sunucu eklenirken onay istenir. Testler gerçek bir yerel HTTP sunucusuyla (ekleme, sohbet, yönlendirmenin reddi, diskte değişen adres) `test_cloud_features.ts`'te. Azure OpenAI'ın kendine özgü kimlik doğrulaması (`api-key` başlığı, `api-version`) desteklenmez; Azure'un OpenAI uyumlu ucu anahtarı `Bearer` olarak kabul ediyorsa kullanılabilir. Gerçek LM Studio ve OpenRouter ile deneme, canlı doğrulamayla birlikte bekliyor.

---

## 9. Google Gemini ve Mistral — 2.2

**Yaklaşım.**
- Gemini: resmî `@google/genai` SDK'sı, sabit adres; şema `responseSchema` biçimine (OpenAPI alt kümesi) çevrilir; düşünme `thinkingConfig` ile.
- Mistral: resmî SDK ya da OpenAI uyumlu uç; şema `response_format` ile.
- Her biri için anahtar deposu, model listesi, hata kodları ve çevirici testleri; model seçicide kendi başlığı.

**Bitti sayılır.** İki sağlayıcı da `test_cloud_providers.ts`'teki diğer sağlayıcılarla aynı kapsamda test edilir ve iş 1'deki duman testinden geçer.

**Durum (2.1.0): tamam (duman testi gerçek anahtar bekliyor).** Gemini resmî `@google/genai` SDK'sıyla, Mistral OpenAI SDK'sının Mistral lehçesiyle (resmî Mistral SDK'sı yerine; aynı uç, bir bağımlılık az). Şema Gemini'de `responseJsonSchema` (birleştirilmiş nesne), Mistral'da `response_format`. Testler `test_cloud_features.ts`'te.

---

## 10. Yerel araç çağırma biçimi: ölçüm ve karar — 2.3

**Neden.** Ajan bugün her sağlayıcıyla aynı JSON eylem protokolünü kullanıyor (yerel modeller için tasarlandı, büyük modeller de sorunsuz izliyor). Claude ve GPT'nin kendi araç çağırma biçimi (tool use) uzun görevlerde daha az token ve daha iyi paralel okuma sağlayabilir.

**Yaklaşım.**
- Deneysel bir ayar: eylem şemasından araç tanımları üretilir; geçmiş, araç çağrısı / araç sonucu bloklarıyla tutulur. Ajanın denetimleri (onay, dosya kontrolleri, yalıtım) aynı işleyicilerden (`src/lib/agent/run/`) geçer.
- İş 3'teki kıyaslamayla iki biçim karşılaştırılır: başarı oranı, adım sayısı, token ve süre.
- Karar ölçütü: başarı oranı düşmeden token veya süre en az %20 iyileşirse bulut sağlayıcılarında varsayılan olur; değilse deney kaldırılır.

**Bitti sayılır.** Ölçüm sonuçları ve karar bu belgeye yazılır.

**Durum (2.1.0): deneysel ayar hazır, karar ölçüm bekliyor.**
- Ayarlar › Bulut modelleri › Deneysel › **Yerel araç çağrıları (Claude, GPT)**, varsayılan kapalı.
- Uygulama (`electron/cloud/nativeTools.ts`): eylem şemasının her varyantı bir araca dönüşür (`thought` korunur); Claude'da `tool_choice: any` ve paralel araç kapalı, GPT'de `tool_choice: required` ve `parallel_tool_calls: false`. Geçmişteki JSON eylemleri araç çağrısına, ardından gelen kullanıcı mesajı araç sonucuna çevrilir; sağlayıcının araç çağrısı yine ajanın JSON eylemi olarak döner. Böylece ajan, onaylar ve denetimler hiç değişmez.
- Sınırlar: Claude'da bu kipte düşünme kapalıdır (imzalı düşünme blokları olmadan araç geçmişi reddedilir); GPT'nin akıl yürüten modelleri bu kipte Chat Completions'tan gider (özet yok). Gemini, Mistral ve sunucular bu ayarı yok sayar.
- **Ölçüm yöntemi:** aynı modelle `web-new`, `js-bugfix`, `python-cli` ve `json-config` senaryoları her biçimde en az üçer kez: `scripts/agent-e2e.ts <model> <senaryolar>` ve `… --native-tools`. Karşılaştırılan: doğrulanan görev oranı, model adımı, giriş ve çıkış token'ı, tahmini ücret, süre.
- **Karar ölçütü (değişmedi):** başarı oranı düşmeden token ya da süre en az %20 iyileşirse Claude ve GPT'de varsayılan olur; değilse deney kaldırılır.
- **Sonuçlar:** henüz yok (geliştirme ortamında gerçek anahtar yoktu). Ölçüldüğünde bu başlığın altına tablo olarak eklenecek.

---

## Ek: büyük modeller için ajan ayarları

**Neden.** Ajan 2–8B yerel modeller ve 8–16K bağlam için ayarlanmıştı: az adım, 16 000 karakterde kesilen okumalar, adım başına tek dosya, kısa tutulan geçmiş ve küçük modelleri yönlendiren ayrıntılı kurallar. Büyük bir model (bulutta ya da 24B ve üzeri yerel) bu sınırlar içinde adım ve token harcıyordu: kesilen dosyaları yeniden okuyor, her dosya için ayrı bir tur atıyor, sıkıştırmada kendi son işini kaybediyordu ve her sıkıştırma sağlayıcının istem önbelleğini bozuyordu.

**Yapılanlar (2.1.0).**
- `modelTier`: *küçük* (≤ 4,5B), *orta* (tipik yerel model), *büyük* (≥ 24B yerel ya da her bulut modeli). Bu bilgisayardaki bir uyumlu sunucunun modeli adındaki boyuta göre sınıflanır.
- `agentLimitsFor` (`src/lib/agent/agentLimits.ts`): büyük modellerde 60 adım ve 90 araç çağrısı (35 ve 50 yerine), pencerenin %15'i kadar okuma (16 000–60 000 karakter), tek adımda en çok 8 dosya okuyan `read_files`, 12 dosyaya kadar önyükleme (pencerenin %30'u, en çok 48 000 karakter), sıkıştırmada 8 tam değişim ve bütçenin %60'ına kadar sıkıştırma (daha seyrek, önbellek dostu). Hepsi bağlam penceresiyle sınırlıdır; 8K pencereli büyük bir yerel model aşırı yüklenmez.
- Büyük modellerin sistem istemine üç çalışma kuralı eklenir: önce gereken her şeyi oku (birden çok dosyayı `read_files` ile), sonra değiştir, sonra doğrula; odaklı düzenlemeyi yeğle; düşünceyi kısa tut ve istenmeyen özellik ekleme. İstem büyük modellerde de görev boyunca sabittir.
- Tasarım temalarının temel stil katmanı, otomatikte bulut modellerine eklenmez (boyutu bilinmeyen her modelde açılıyordu).
- Küçük ve orta modellerin sınırları değişmedi. Testler: `test_agent_reliability.ts` (kademeler, sınırlar, istem, şema) ve `test_agent_engine.ts` (32B bir modelde `read_files`, büyük okuma, önyükleme; 7B'de araç sunulmaz).

---

## Test ve yayın düzeni

- Her iş, ağsız testleriyle birlikte gelir; canlı denemeler (iş 1 ve 3) elle ve yalnızca depo sahibinin anahtarlarıyla yapılır.
- Her sürüm `CHANGELOG.md`'de anlatılır ve `vX.Y.Z` etiketiyle yayınlanır; sürüm iş akışı Windows ve Linux paketlerini üretir.
- Güvenlikle ilgili işler (2, 8) `docs/SECURITY_MODEL.md` güncellenmeden birleştirilmez.
