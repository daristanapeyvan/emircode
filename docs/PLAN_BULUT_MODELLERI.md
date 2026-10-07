# Plan: Bulut modelleri, Claude ve GPT

Bu belge, Emir Code'a yerel Ollama modellerinin yanında **Ollama Cloud**, **Claude (Anthropic)** ve **GPT (OpenAI)** modellerinin nasıl eklendiğini anlatır: hedefler, mimari, güvenlik, arayüz, ajanın bu modellere uyarlanması, testler, belgeler ve sonraki adımlar. Uygulama hâlinin özeti en sondaki "Durum" bölümündedir.

---

## 1. Hedefler

1. Kullanıcı sohbette ve Kod sekmesindeki ajanda yerel modellerin yanında bulut modellerini de seçebilmeli:
   - **Ollama Cloud**: ollama.com'da çalışan büyük açık modeller (`gpt-oss:120b`, `qwen3-coder:480b`, `deepseek-v3.1:671b` …). İki yol:
     - *Ollama üzerinden*: bilgisayardaki Ollama `ollama signin` ile oturum açtıysa `…-cloud` etiketli modeller normal yüklü model gibi görünür.
     - *API anahtarıyla*: Ollama kurulu olmasa da ollama.com API'si doğrudan kullanılır.
   - **Claude**: Anthropic Messages API (ör. `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`).
   - **GPT**: OpenAI Chat Completions API (hesabın erişebildiği `gpt-*` ve `o*` modelleri).
2. Yerel kullanım olduğu gibi kalmalı: Ollama'sız, hesapsız, telemetrisiz çalışma varsayılan olmaya devam eder. Bulut sağlayıcıları yalnızca kullanıcı bir anahtar girdiğinde (ya da Ollama'da oturum açtığında) devreye girer.
3. API anahtarları güvende olmalı: diskte işletim sisteminin anahtar zinciriyle şifreli, arayüze ve ajanın komutlarına hiç verilmeden.
4. Ajanın bütün korumaları (dosya kontrolleri, onaylar, yalıtılmış komutlar, güvenilmeyen veri işaretleri) bulut modellerinde de aynen geçerli olmalı.
5. Belgeler (README, Türkçe kılavuz, mimari, güvenlik modeli, örnekler, değişiklik günlüğü, katkı rehberi) yeni durumu eksiksiz anlatmalı; özellikle hangi verinin bilgisayardan çıktığı açıkça yazılmalı.

**Kapsam dışı (bu sürüm):** OpenAI uyumlu özel adresler (OpenRouter, LM Studio, Azure), Google Gemini, Amazon Bedrock / Vertex AI, maliyet takibi ve bütçe sınırı. Bunlar bölüm 13'te sonraki adımlar olarak listelenir.

---

## 2. Başlangıç durumu

- Bütün model istekleri renderer'dan doğrudan Ollama'ya (`http://localhost:11434`) gidiyordu (`OllamaClient`).
- Model adı düz bir dizeydi (`qwen2.5-coder:7b`); sohbetler, görevler ve ayarlar bu dizeyi saklıyordu.
- Ajan Ollama'ya özgü özelliklere dayanıyordu: `format` (JSON Schema ile dilbilgisi kısıtlı çıktı), `think`, `num_ctx`, `num_predict`, `done_reason: "length"`, `prompt_eval_count`.
- Model Yöneticisi ollama.com listesinde yalnızca bulutta çalışan modelleri bilerek gizliyordu.
- README ve kılavuz "istekler yalnızca bilgisayarınızdaki Ollama'ya gider" diyordu.

---

## 3. Mimari

```
Renderer (arayüz, ajan motoru)                     Main process (Node.js)
───────────────────────────────                     ──────────────────────────────────────────
ChatService / AgentEngine                            electron/cloud/
        │                                              ├─ keyStore.ts   anahtarlar (safeStorage)
        ▼                                              ├─ schema.ts     JSON Schema dönüşümü
src/lib/providers/ModelGateway.ts ──(yerel)──► Ollama  ├─ anthropic.ts  @anthropic-ai/sdk
        │                                              ├─ openai.ts     openai SDK
        └──(bulut)── window.electronAPI.cloudChat ───► ├─ ollamaCloud.ts ollama.com /api/chat
                     ◄── cloud:event (parça, son, hata) └─ index.ts      IPC, istek takibi, iptal
```

- **Model kimliği.** Bulut modelleri `sağlayıcı::model` biçiminde saklanır: `anthropic::claude-opus-5-5`, `openai::gpt-5`, `ollama-cloud::gpt-oss:120b`. `::` hiçbir Ollama model adında geçmediği için eski kayıtlar (düz adlar) yerel Ollama modeli olarak kalır; geçiş (migration) gerekmez. Yardımcılar: `src/lib/providers/modelRef.ts`.
- **Tek giriş noktası.** `ModelGateway.chatStream` Ollama'nın `chatStream` imzasını korur. Yerel model için `ollamaClient`'a, bulut modeli için main process'e gider. Ajan ve sohbet aynı parça (chunk) biçimini alır; böylece ajan döngüsünde sağlayıcıya özel dal yoktur.
- **Ağ isteği main process'te.** Renderer hiçbir bulut adresine istek atmaz ve anahtarı hiç görmez. Main process yalnızca sabit adreslere bağlanır: `api.anthropic.com`, `api.openai.com`, `ollama.com`.
- **Akış.** Main process sağlayıcının akışını (SSE / NDJSON) Ollama parçalarına çevirir ve `cloud:event` ile renderer'a gönderir: `chunk`, `end`, `error`. Her isteğin bir kimliği vardır; `cloud:abort` isteği durdurur.
- **Resmî SDK'lar.** Claude için `@anthropic-ai/sdk`, GPT için `openai` paketi kullanılır (otomatik yeniden deneme, tip güvenliği, akış ayrıştırma). Ollama Cloud, Ollama'nın kendi HTTP API'siyle konuşur.

---

## 4. Sağlayıcılar ve istek çevirisi

| Ollama alanı | Claude (Messages API) | GPT (Chat Completions) | Ollama Cloud (API) |
| --- | --- | --- | --- |
| `system` | `system` (+ önbellek) | `role: "system"` mesajı | aynen |
| `messages` | ilk mesaj kullanıcı, boş ve sondaki asistan mesajları atılır | aynen | aynen |
| `images` | `image` içerik blokları (tür base64'ün başından anlaşılır) | `image_url` data URL | aynen |
| `format` (şema) | `output_config.format` (`json_schema`), şema düzleştirilir | `response_format` (`json_schema`, strict değil) | aynen |
| `think` | `thinking: {type: "adaptive", display: "summarized"}`; eski modellerde bütçeli düşünme | akıl yürüten modellerde `reasoning_effort` | aynen |
| `num_predict` | `max_tokens` (varsayılan 16 384) | `max_completion_tokens` | aynen |
| `num_ctx` | gönderilmez; bağlam bütçesi uygulamada | gönderilmez | aynen |
| örnekleme (temperature …) | gönderilmez (yeni modeller reddeder) | gönderilmez (akıl yürüten modeller reddeder) | aynen |
| `done_reason` | `max_tokens` → `length`, `refusal` → hata | `length` → `length`, `content_filter` → hata | aynen |
| `prompt_eval_count` | `input + cache_creation + cache_read` | `prompt_tokens` | aynen |

Ek kararlar:
- **Önbellek (prompt caching).** Ajanın sistem istemi sabit, geçmişi yalnızca sona eklenir. Claude isteklerinde üst düzey `cache_control` ile önceki adımlar önbellekten okunur; OpenAI önbelleği kendiliğinden çalışır.
- **Şema düzleştirme.** Ajanın şeması her araç için bir `anyOf` dalıdır. Claude ve GPT için tek bir nesneye çevrilir: `action` bir `enum`, alanlar isteğe bağlı, `additionalProperties: false`; desteklenmeyen kısıtlar (`minLength`, `maxLength` …) çıkarılır. Alanların doğruluğunu zaten `ToolDispatcher` denetler.
- **Reddetme (refusal).** Claude'un güvenlik sınıflandırıcıları bir isteği reddedebilir. Bunu destekleyen modellerde sunucu tarafı yedek model (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) açıktır; istek reddedilirse Anthropic aynı isteği önerdiği modelde yeniden çalıştırır. Yine reddedilirse kullanıcı açık bir mesaj görür. Sunucu bu alanı kabul etmezse istek onsuz tekrarlanır.
- **Geri dönüşler.** Sağlayıcı şemayı ya da düşünme ayarını reddederse ajan, Ollama'da olduğu gibi o özelliği kapatıp aynı adımı tekrarlar (`format_unsupported`, `think_unsupported` hata kodları).

---

## 5. Ajanın bulut modellerine uyarlanması

| Konu | Yerel model | Bulut modeli |
| --- | --- | --- |
| Bağlam penceresi | donanıma göre (8K–32K) | Ayarlar › Bulut modelleri › Bağlam (Otomatik: 64K, modelin sınırını aşmaz) |
| Adım başına çıktı | 3K–8K | 16K (modelin sınırına ve pencerenin yarısına kadar) |
| Küçük model kısayolları | ≤ 4,5B için kısa araç listesi | yok; tam araç listesi |
| Tasarım kategorisi sorusu | 48 token | 1024 token (düşünen modeller boş cevap vermesin) |
| Hata mesajları | "Ollama'ya ulaşılamıyor" | anahtar geçersiz, kota/limit, sağlayıcıya ulaşılamıyor, model yok, istek reddedildi, Ollama'da oturum açılmamış |

Dosya kontrolleri, onay seviyeleri, yalıtılmış komutlar, kabul kontrolleri, tekrar ve ilerleme korumaları değişmez.

---

## 6. API anahtarlarının güvenliği

- Anahtarlar `emir_code_data.json`'da **tutulmaz**; ayrı bir `cloud_keys.json` dosyasında, Electron `safeStorage` ile şifreli durur (Windows: DPAPI, macOS: Keychain, Linux: libsecret/KWallet). Dosya yalnızca kullanıcının okuyabileceği izinle yazılır.
- Linux'ta gerçek bir anahtar zinciri yoksa (`basic_text`) anahtar diske yazılmaz, yalnızca uygulama açık kaldığı sürece bellekte tutulur ve ayarlar bunu söyler.
- Ortam değişkenleri de okunur: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_API_KEY` (kayıtlı anahtar yoksa).
- Anahtar main process'ten hiç çıkmaz: arayüz yalnızca "ayarlı mı, kaynağı ne, son 4 karakteri" bilgisini alır. Kaydetmeden önce anahtar, sağlayıcının model listesi istenerek doğrulanır.
- Ajanın çalıştırdığı komutlar zaten yalnızca izinli sistem değişkenlerini alır; bu üç değişken onlara geçmez. Ajan `cloud_keys.json`'ı okuyamaz (proje klasörünün dışındadır).
- IPC girdileri main process'te doğrulanır: sağlayıcı listede olmalı, model adı belirli karakterlerden oluşmalı, istek boyutu sınırlıdır.

---

## 7. Gizlilik

- Bulut modeli seçildiğinde istemler, ekler ve ajanın okuduğu proje dosyaları, komut çıktıları ve web sonuçları **seçilen sağlayıcıya gider** ve orada onun koşullarına göre işlenir. Bu, ayarlarda, model seçicide (bulut simgesi), ajan günlüğünde ve belgelerde açıkça yazar.
- Yerel modelde hiçbir şey değişmez; bulut sağlayıcısına yalnızca kullanıcı bir bulut modeli seçtiğinde istek gider. Anahtar kaydederken ve model listesini yenilerken sağlayıcının model listesi okunur.
- Telemetri yoktur; uygulama sağlayıcıya kullanıcı hakkında ek bilgi göndermez.

---

## 8. Arayüz

1. **Ayarlar › Bulut modelleri** (yeni sekme): her sağlayıcı için anahtar alanı, Kaydet (anahtar kaydedilmeden önce sağlayıcıda denenir)/Değiştir/Kaldır, durum (kayıtlı, ortam değişkeninden, yalnızca bu oturum), model sayısı, model listesini yenileme ve "anahtarı nereden alırım" bağlantısı; Ollama Cloud için `ollama signin` açıklaması; bulut modellerinin bağlam penceresi; gizlilik notu.
2. **Model seçici**: modeller gruplanır (Bu bilgisayar · Ollama Cloud · Claude · GPT), bulut modellerinde bulut simgesi; çok model varsa arama kutusu; "Bulut modelleri ekle" kısayolu.
3. **Model Yöneticisi › Keşfet**: yeni "Bulut (ollama.com)" kategorisi. Modelin sayfasında bulut etiketleri ayrı bir "Bulut" grubundadır; bellek uyumu yerine "ollama.com'da çalışır, `ollama signin` gerekir" yazar, düğme "Ekle"dir (yalnızca küçük bir tanım indirilir).
4. **İlk açılış sihirbazı**: Ollama yoksa "Bulut modeli kullan" seçeneği Ayarlar › Bulut modelleri'ni açar.
5. **Ollama bağlantı uyarısı** yalnızca yerel bir model seçiliyken görünür; yalnızca bulut kullanan biri sürekli kırmızı uyarı görmez.
6. **Komut paleti** bulut modellerine de geçebilir; sohbet mesajlarında model adı okunur biçimde (ör. `claude-opus-5-5 · Claude`) görünür.
7. Görsel ekleme, modelin görsel desteğine göre açılır (Claude ve çoğu GPT modeli destekler).

---

## 9. Hata yönetimi

Main process her hatayı bir koda çevirir; renderer kodu arayüz dilindeki mesaja dönüştürür:

| Kod | Ne zaman | Kullanıcının gördüğü |
| --- | --- | --- |
| `no_key` | anahtar yok | Ayarlar › Bulut modelleri'nde anahtar girin |
| `auth` | 401/403 | anahtar geçersiz ya da yetkisiz |
| `quota` | bakiye/kota bitti | sağlayıcı hesabında kota veya ödeme sorunu |
| `rate_limit` | 429 | sınır aşıldı, biraz sonra tekrar deneyin |
| `overloaded` | 5xx / 529 | sağlayıcı geçici olarak yoğun |
| `not_found` | 404 model | model bu hesapta yok |
| `format_unsupported` / `think_unsupported` | 400 şema/düşünme | ajan özelliği kapatıp tekrarlar |
| `context_length` | istem çok uzun | bağlam ayarını düşürün |
| `refusal` | sağlayıcı reddetti | istek reddedildi (kategori) |
| `network` | bağlantı yok | sağlayıcıya ulaşılamıyor |
| `bad_request` | diğer 400'ler | sağlayıcının mesajı |

SDK'lar 429, 5xx ve bağlantı hatalarını kendileri iki kez yeniden dener.

---

## 10. Testler

- `test_cloud_providers.ts` (yeni, `npm test` içinde, ağ gerektirmez):
  - model kimlikleri ve görünen adlar, eski düz adların yerel kalması;
  - şema düzleştirme ve kısıt temizliği;
  - Claude, GPT ve Ollama Cloud istek gövdeleri (sistem, görseller, düşünme, önbellek, yedek model, örnekleme gönderilmemesi);
  - akış çevirileri: metin, düşünme, kullanım sayıları, `length`, reddetme, içerik filtresi;
  - hata sınıflandırması (`auth`, `quota`, `rate_limit`, `format_unsupported` …);
  - anahtar deposu: şifreli kayıt, şifreleme yoksa yalnızca bellek, ortam değişkeni, maskeleme, anahtarın dosyada düz metin olmaması;
  - bulut model bilgisi ve istek profili (bağlam, çıktı, küçük model olmama);
  - `ModelGateway`'in yerel/bulut yönlendirmesi ve iptal;
  - bulut modeliyle tam bir ajan görevi (sahte köprüyle): dosya yazılır, hiçbir adım yerel Ollama'ya gitmez, sağlayıcı şemayı reddedince ajan şemasız devam eder.
- `test_model_library.ts`: bulut etiketleri ayrı grupta, "Bulut" kategorisi.
- `scripts/verify_functionality.js`: anahtarların renderer'a ve depolama dosyasına girmediğine dair statik kontroller.

---

## 11. Belgeler

README (özellikler, başlangıç, modeller, gizlilik, sorun giderme), `docs/KULLANIM.md`, `ARCHITECTURE.md` (yeni "Cloud models" bölümü), `docs/SECURITY_MODEL.md` (anahtarlar, veri akışı, sınırlar), `docs/EXAMPLES.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` ve `package.json` açıklaması güncellenir.

---

## 12. Riskler ve açık noktalar

| Risk | Etkisi | Önlem |
| --- | --- | --- |
| Sağlayıcı API'leri değişir (alan adları, beta başlıkları, model listeleri) | İstek reddedilir | Resmî SDK'lar; reddedilen şema/düşünme/yedek model alanı otomatik olarak bırakılır; hata kodları kullanıcıya açık mesaj olarak gösterilir |
| Gerçek anahtarlarla otomatik test yok | Canlı API'ye özgü bir hata CI'da görünmez | Sağlayıcı katmanı sahte istemcilerle uçtan uca test edilir; canlı deneme için sonraki adımlardaki kıyaslama |
| Maliyet | Uzun ajan görevleri çok token harcayabilir | Varsayılan 64K bağlam, önbellek, mesaj başına token gösterimi; sağlayıcının harcama sınırları |
| Güvenlik sınıflandırıcıları (Claude) | Meşru bir güvenlik/biyoloji işi reddedilebilir | Sunucu tarafı yedek model, kategoriyle açık hata mesajı |
| OpenAI model listesi bağlam penceresi vermez | Bağlam penceresi tahmin edilir | Aile bazlı değerler; bağlam ayarı zaten modelin sınırının altında (64K) |
| ollama.com'un bulut etiketleri ve API'si | Keşfet'teki bulut etiketlerinin doğrulaması değişebilir | Bulut etiketinde doğrulama sonucu düğmeyi kilitlemez; hata indirme sırasında gösterilir |
| Linux'ta anahtar deposu yok | Anahtar diske yazılamaz | Anahtar yalnızca oturum boyunca bellekte; ortam değişkeni seçeneği; ayarlarda uyarı |

---

## 13. Sonraki adımlar

Bu adımların ayrıntılı planı (sürümler, yaklaşım, dosyalar, kabul ölçütleri) ve durumu: [PLAN_ACIK_NOKTALAR.md](./PLAN_ACIK_NOKTALAR.md). Hepsi Emir Code 2.1.0'da uygulandı; 5. ve 6. maddelerin ölçümleri gerçek anahtarlarla çalıştırılmayı bekliyor.

1. OpenAI uyumlu özel adres (OpenRouter, LM Studio, vLLM, Azure OpenAI) — anahtarın kullanıcı tarafından seçilen bir adrese gideceği açıkça onaylatılarak.
2. Google Gemini ve Mistral sağlayıcıları.
3. Maliyet göstergesi: mesaj ve görev başına token ve tahmini ücret, isteğe bağlı görev bütçesi.
4. OpenAI Responses API ile akıl yürütme özetleri; Claude için çaba (`effort`) ayarı.
5. Ajan için sağlayıcıların yerel araç çağırma (tool use) biçimi — JSON eylem protokolüyle karşılaştırmalı ölçüm sonrası.
6. Bulut modelleri için ajan kıyaslaması (`scripts/agent-e2e.ts` bulut kimlikleriyle) ve README'deki model tablosuna sonuçlar.

---

## 14. Durum

| Faz | İçerik | Durum |
| --- | --- | --- |
| 1 | Model kimlikleri, main process sağlayıcı katmanı, anahtar deposu, IPC | ✅ |
| 2 | ModelGateway; sohbet ve ajanın bulut modelleriyle çalışması | ✅ |
| 3 | Ayarlar › Bulut modelleri, model seçici, Keşfet › Bulut, ilk açılış, komut paleti | ✅ |
| 4 | Testler ve belgeler | ✅ |
| 5 | Emir Code 2.0 sürümü (Windows ve Linux paketleri) | ✅ |
| 6 | Gerçek anahtarlarla canlı deneme ve bulut modelleri için ajan kıyaslaması | Araçlar 2.1.0'da hazır (`scripts/cloud-smoke.ts`, `scripts/agent-e2e.ts`); gerçek anahtarlarla çalıştırma bekliyor |
| 7 | Sonraki adımlar (bölüm 13) | ✅ 2.1.0: OpenAI uyumlu sunucular, Gemini, Mistral, maliyet ve görev bütçesi, çaba ve akıl yürütme özetleri, seçicide görünen modeller, Ollama Cloud kullanım sınırı, anahtar maskeleme; yerel araç çağırma deneysel (karar ölçüm bekliyor). Ayrıntılar: [PLAN_ACIK_NOKTALAR.md](./PLAN_ACIK_NOKTALAR.md) |
| 8 | Ajanın büyük modellere göre ayarı (kademeler, `read_files`, sınırlar) | ✅ 2.1.0 |
