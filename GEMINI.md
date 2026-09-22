# Emir Code Project Rules & Agent Directives

## 1. Otomatik Kurucu (Installer) Güncelleme Kuralı
Kullanıcının kesin talimatı gereği:
- Bu projede yapılan **HER** geliştirme, hata düzeltmesi veya özellik ekleme çalışmasının sonunda mutlaka **yeni Windows Kurucu (Installer)** derlenecektir:
  ```powershell
  npm run build:installer
  ```
- Üretilen kurulum dosyası (`release/Emir Code Setup X.Y.Z.exe`) ve taşınabilir sürümün (`release/Emir Code X.Y.Z.exe`) sağlamlığı kontrol edilmelidir.
- Yeni bir sürüm veya release aşamasında Git etiketleri (`git tag -a vX.Y.Z -m "..."`) oluşturulup `origin`'e push edilerek GitHub Actions Release iş akışının tetiklenmesi ve sürümün GitHub Releases sayfasında yayınlanması sağlanmalıdır.

## 2. Çoklu Talimat ve Erken Kapanış Kuralı
- Kullanıcı tek seferde birden fazla iş veya adım talep ettiğinde asla tek bir tanesini yapıp durulmayacaktır.
- Bütün maddeler sırayla tamamlanıp doğrulanana kadar süreç sonlandırılmayacaktır.
