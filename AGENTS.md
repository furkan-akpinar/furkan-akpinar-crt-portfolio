# Portföy geliştirme yönergeleri

Bu proje Furkan Akpınar'ın dört bölümlü kişisel portföyüdür: Ana Sayfa, Projeler, Hakkımda ve İletişim. Geçerli ürün ve çalıştırma bilgisi README.md, metin ve proje verileri src/content/portfolio.ts içindedir.

- Kullanıcının onayladığı tasarımı koru. Film geometrisini, geçiş zamanlamalarını, CRT görünümünü, tipografiyi, yedi posterin sırasını ve ışık değerlerini açık tasarım talebi olmadan değiştirme.
- Tek kalıcı Canvas ve tek GSAP/Lenis saati kullan. Karelik verileri React state'e taşıma; kaynakların hata, iptal ve unmount sırasında serbest bırakılmasını koru.
- Masaüstü 4K ve mobil 1024px model paketleri ortak geometri kullanır. Manifestteki dosyaları ayrı ayrı silme; iki paket de bütünlük testine tabidir.
- Görünmez semantik HTML, GPU fallback, klavye, dokunma ve azaltılmış hareket desteği aktiftir; ekran görüntüsünde görünmediği için kaldırma.
- Yeni bağımlılık eklemeden önce mevcut araçlarla çözümü değerlendir. Sürümleri kilit dosyasıyla yönet.
- public yalnız güncel yayın varlıklarını içersin. Ham kaynakları, eski ekran kayıtlarını ve yedekleri public veya proje içine biriktirme. Lisans ve kaynak bildirimlerini koru.
- Kod değişikliğinden sonra npm run check ve npm run build çalıştır. Etkileşim veya sahne değişikliklerinde qa/README.md içindeki gerçek tarayıcı kontrolünü uygula; komut başarısını görsel eşitlik kanıtı sayma.
- 1440×900, 768×1024 ve 390×844 ölçülerini; ileri/geri gezinme, film döngüsü, menü, rotation, reduced-motion ve GPU'suz yolu doğrula. Chromium emülasyonu fiziksel iPhone/Safari testi değildir.
- Kullanıcı istemedikçe commit/push/deploy yapma. Gizli anahtarları ve yerel oturum kayıtlarını pakete koyma.
- Kurulu Next sürümüne ait ilgili rehberi node_modules/next/dist/docs altında oku. Belirsiz kütüphane API veya CLI davranışları için Context7 varsa önce resolve-library-id, ardından tek konuya odaklı query-docs kullan. Genel refactoring için gereksiz dokümantasyon çağrısı yapma.

Bu temiz paket geçmiş araştırma klasörlerine, eski bilgisayar/telefon modellerine veya Git geçmişine bağımlı değildir. Kaynak ZIP açıldıktan sonra npm ci ile kurulabilir.
