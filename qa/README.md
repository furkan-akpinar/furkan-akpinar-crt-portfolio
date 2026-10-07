# Üretim tarayıcı kontrolleri

Node testleri `npm run check` ile çalışır. Buradaki dosyalar, gerçek GPU tarayıcısında kullanılan Playwright CLI `run-code` fonksiyonlarıdır; uygulama runtime'ına veya üretim paketine eklenmez. Eski revizyonlara bağlı yüzlerce deneme aracı bu pakette bulunmaz.

Önce `npm run build` ve `npm run preview` çalıştırın. Playwright CLI mevcutsa ayrı terminalde:

```powershell
New-Item -ItemType Directory -Force artifacts
playwright-cli.cmd -s=portfolio open http://127.0.0.1:3256/ --browser=msedge
playwright-cli.cmd -s=portfolio run-code --filename=qa/browser.js
playwright-cli.cmd -s=portfolio run-code --filename=qa/touch.js
playwright-cli.cmd -s=portfolio run-code --filename=qa/mobile-viewport.js
playwright-cli.cmd -s=portfolio run-code --filename=qa/project-title.js
```

CLI başka platformda `playwright-cli` adıyla çalışabilir. Araç bu projenin runtime bağımlılığı değildir. Kontrol dosyaları mevcut sekmenin origin adresini hedefler; canlı site için önce o adresi açabilirsiniz. İzole bir test sekmesi kullanın. İşlevler sayfayı yeniden yükler, bölümler arasında gezinir ve hata/fallback davranışını sınamak için geçici istek engelleme/GPU context loss uygular; sunucuda veri değiştirmez.

- `browser.js`: üç viewport, doğru model/doku seviyesi, film sırası ve linkleri, klavye, ileri/geri geçişler, resize/rotation, hareket tercihi, GPU fallback ve yükleme hataları.
- `project-title.js`: 1440, 768, 390 ve 320 piksel genişliklerde başlık yerleşimi, yedi projenin sırası ve bağlantıları, gerçek bağlantı hedeflerinin hizası ve taşma kontrolü. Dalga yalnızca responsive başlıkta ilerlemeli; masaüstünde ve azaltılmış hareket tercihinde durmalı. Başlıkların okunaklılığı, yerel parlama ve filmle hizası için görüntüler ayrıca incelenir. Beklenen sonuç 45/45 kontroldür.
- `touch.js`: DPR3/coarse-pointer emülasyonu, gerçek touch olaylarıyla menü ve dikey geçişler, Projeler ↔ Hakkımda geçişinin iki yönde parmak hareketini izlemesi. Kısa harekette geçiş kısmi kalmalı; parmak durduğunda ve bırakıldıktan 1,7 saniye sonra ilerleme değişmemeli; yeni dokunuş kaldığı yerden devam etmeli. Eşit ters hareket aynı konuma dönmeli; ekran yüksekliğinin yaklaşık %75'i kadar tek hareket geçişi tamamlamalı. Aynı parmak iki uçta geçiş aralığıyla sınırlı kalmalı ve yön değiştirince geri ilerleyebilmeli. Ayrıca tek yatay harekette tam bir proje ilerleme ve geri dönme sınanır. Yatay hareket sahnenin dikey konumunu değiştirmemeli; dokunma ve yön değişimi boyunca belge kilitli, model tek ve mobil kalmalı; 4K doku indirilmemeli.
- `mobile-viewport.js`: CDP dokunma emülasyonunda 440×820 → 440×932 → 440×820 yükseklik değişimini projeler, merkezden açılma, Hakkımda, kâğıt kıvrımı ve iletişim konumlarında sınar. Yalnız yükseklik değiştiğinde sahne konumu, ilerleme, `storyHeight`, `sceneHeight`, canvas ölçüleri ve etkileşim alanları sabit kalmalı. İleri/geri dokunma, iletişim sonuna erişim, 956×440 yön değişiminde normalize sahne konumu ve ilk açılışın 440×932 olduğu durumda araç çubuğunun görünmesi de denetlenir. Kare örnekleri boyunca kök belgenin hareket etmediği ve taşmadığı kontrol edilir. Azaltılmış hareket tercihi ve GPU'suz metin görünümü ayrıca sınanır.

Dokunmatik GPU görünümünde kaydırma, belgeyi taşımadan sayısal sahne konumunu değiştiren uygulama sürücüsüne aittir: `scrollMode === 'controlled'`, `window.scrollY === 0` ve `document.documentElement.scrollHeight <= innerHeight` olmalıdır. `window.__sceneDiagnostics.scrollPosition` gerçek sahne uzaklığını, `storyHeight` bölüm hesabının birimini, `sceneHeight` sabit render yüksekliğini ve `scrollLimit` iletişim sonuna kadar izin verilen uzaklığı verir. Test konumu, `study-navigate` olayına `vh * storyHeight` sayısı gönderilip 1300 ms beklenerek seçilir; mobil sahne için `window.scrollTo` kullanılmaz. Yön değişiminde yeni genişliğe göre ölçüler yenilenebilir, fakat normalize sahne konumu korunmalıdır.

Azaltılmış hareket tercihinde dokunmatik GPU görünümü yine `controlled` kalır; video durur, sayısal gezinme animasyonsuz tamamlanır. GPU'suz metin görünümü belge kilidini kaldırmalı ve gerçek dokunma hareketiyle normal belge kaydırmasına izin vermelidir. Masaüstü normal belge kaydırma yolunu kullanır. Bu yolların kontrollerinde aynı `window.scrollY` beklentisi uygulanmaz.

Sonuç nesnesinde `passed === total`, beklenen kontrol sayısının tamamı ve boş `errors` dizisi aranmalıdır. `touch.js` ve `mobile-viewport.js` ayrıca `completed === true` ve `passed === total === expected` vermelidir; erken durmada henüz çalışmayan kontroller de başarısız sayılır. Görüntüler `artifacts/` altına yazılır; Git/ZIP dışında tutulur. Aynı tarayıcı oturumunda önce genel kontrol, sonra dokunma kontrolü çalıştırın.

Görsel kontrol ayrıca yapılır: Ana Sayfa, Projeler, Hakkımda, İletişim; monitöre yaklaşma, merkezden açılma, kâğıt kıvrımı ve 1,2 saniyelik menü sinyali. Öncesi/sonrası aynı viewport ve sahne ilerlemesinde karşılaştırılmalıdır. Test sayısı tasarım eşitliğini kanıtlamaz. Emülasyon Windows Chromium üzerinde çalışır; iOS user-agent ve CDP yükseklik değişimi fiziksel Safari'nin adres çubuğunu, güvenli alanlarını veya gerçek compositor davranışını çalıştırmaz. Telefon kaydında araç çubuğunun açılıp kapanması, ters yönde kaydırma, iletişim altının erişilebilirliği ve pinch/zoom ayrıca karşılaştırılmalıdır; bu manuel kontroller yapılmadan fiziksel iPhone/Safari doğrulandı denmez.
