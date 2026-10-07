# Üretim tarayıcı kontrolleri

Node testleri `npm run check` ile çalışır. Buradaki dosyalar, gerçek GPU tarayıcısında kullanılan Playwright CLI `run-code` fonksiyonlarıdır; uygulama runtime'ına veya üretim paketine eklenmez. Eski revizyonlara bağlı yüzlerce deneme aracı bu pakette bulunmaz.

Önce `npm run build` ve `npm run preview` çalıştırın. Playwright CLI mevcutsa ayrı terminalde:

```powershell
New-Item -ItemType Directory -Force artifacts
playwright-cli.cmd -s=portfolio open http://127.0.0.1:3256/ --browser=msedge
playwright-cli.cmd -s=portfolio run-code --filename=qa/browser.js
playwright-cli.cmd -s=portfolio run-code --filename=qa/touch.js
playwright-cli.cmd -s=portfolio run-code --filename=qa/mobile-viewport.js
```

CLI başka platformda `playwright-cli` adıyla çalışabilir. Araç bu projenin runtime bağımlılığı değildir. Kontrol dosyaları mevcut sekmenin origin adresini hedefler; canlı site için önce o adresi açabilirsiniz. İzole bir test sekmesi kullanın. İşlevler sayfayı yeniden yükler, bölümler arasında gezinir ve hata/fallback davranışını sınamak için geçici istek engelleme/GPU context loss uygular; sunucuda veri değiştirmez.

- `browser.js`: üç viewport, doğru model/doku seviyesi, film sırası ve linkleri, klavye, ileri/geri geçişler, resize/rotation, hareket tercihi, GPU fallback ve yükleme hataları.
- `touch.js`: DPR3/coarse-pointer emülasyonu, gerçek touch olaylarıyla menü ve swipe, rotation sırasında tek model ve 4K doku indirmeme.
- `mobile-viewport.js`: CDP dokunma emülasyonunda 440×820 → 440×932 → 440×820 yükseklik değişimini projeler, merkezden açılma, Hakkımda, kâğıt kıvrımı ve iletişim konumlarında sınar. Kaydırma konumu, sahne ilerlemesi ve ortak `storyHeight` değişmemeli; ileri/geri dokunma, iletişim sonuna erişim ve 956×440 yön değişiminde sahne korunmalıdır. Bu testte `completed === true` ve `passed === total === expected` aranır; erken durmada kalan kontroller de başarısız sayılır. Araç çubuğu işletim sistemi tarafından açılmadığından fiziksel telefondaki video ayrıca karşılaştırılmalıdır.

Sonuç nesnesinde `passed === total`, beklenen kontrol sayısının tamamı ve boş `errors` dizisi aranmalıdır. Erken otomasyon hatasında az sayıda kontrolün geçmesi başarı değildir. Görüntüler `artifacts/` altına yazılır; Git/ZIP dışında tutulur. Aynı tarayıcı oturumunda önce genel kontrol, sonra dokunma kontrolü çalıştırın.

Görsel kontrol ayrıca yapılır: Ana Sayfa, Projeler, Hakkımda, İletişim; monitöre yaklaşma, merkezden açılma, kâğıt kıvrımı ve 1,2 saniyelik menü sinyali. Öncesi/sonrası aynı viewport ve sahne ilerlemesinde karşılaştırılmalıdır. Test sayısı tasarım eşitliğini kanıtlamaz. Dokunma emülasyonunun motoru Windows Chromium'dur; iOS user-agent fiziksel Safari doğrulaması sağlamaz.
