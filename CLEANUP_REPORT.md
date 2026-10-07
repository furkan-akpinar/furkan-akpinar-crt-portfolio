# Temiz kaynak paketi

7 Ekim 2026 · Furkan Akpınar CRT Portföy

Bu teslim, çalışan portföyün ayrı bir kaynak kopyasıdır. Asıl çalışma klasöründeki uygulama, Git geçmişi ve canlı yayın değiştirilmedi. Başlangıç sürümü: `0b15432cf1c880d7a78de7580b7e86ef9e4003fa`.

## İnceleme kapsamı

Önce bütün çalışma klasörünün dosya/boyut envanteri, büyük dosyaları, tekrarları ve yayın listesi incelendi. Ardından uygulama, testler, geliştirme araçları, yapılandırma ve yönergelerde toplam 320 dosya / 17.762 satırlık yazılmış kod ve metin tam gövde okundu. Bağımlılıkların üçüncü taraf kaynakları, derlenmiş çıktılar ve eski kopyaların her satırı yeniden incelenmiş sayılmaz; bunlar envanter ve bağımlılık/üretim ilişkileri üzerinden değerlendirildi. Kilit dosyası yapısal olarak kontrol edildi.

Aktif 42 TypeScript/TSX modülünün tümü uygulama girişlerinden ulaşılabiliyor. Bu nedenle yalnız adına veya büyüklüğüne bakılarak bir uygulama modülü silinmedi. Kullanılmadığı kanıtlanan alanlar çağrıları ve testleriyle birlikte temizlendi.

Canlı portföy ayrıca gerçek GPU kullanan Windows Edge üzerinden açıldı. Ana Sayfa, Projeler, Hakkımda, İletişim; yedi projenin sıralı döngüsü, bağlantıları ve geri dönüşleri kontrol edildi.

## Klasör neden büyümüştü?

İlk ölçümde üst çalışma klasörü **15.363.316.887 bayt / 14,308 GiB** idi. Bunun büyük kısmı uygulama kodu değildi:

- Yaklaşık 10,18 GiB çalışma dokümanı ve araştırma; bunun 7,16 GiB bölümü ekran kayıtları ve görsel kanıtlardı.
- Yaklaşık 1,61 GiB eski yedekler.
- Yaklaşık 0,68 GiB güncel bağımlılıklar ve 1,05 GiB güncel/yan derleme çıktıları.
- Aktif `src` klasörü yalnız yaklaşık 245 KiB idi.

ZIP; eski kayıtları, ham araştırma dosyalarını, yedekleri, `.git`, `node_modules`, `.next`, `out`, `dist`, `.wrangler`, logları ve yerel ayarları içermez. Orijinal arşivler silinmedi. Bunların dışarıda bırakılması site tasarımını veya gerekli çalışma varlıklarını kaldırmaz. Kurulum ve derleme sırasında bağımlılıklar/çıktılar tekrar oluşacağı için açılmış çalışma klasörü zamanla ZIP'ten büyük olacaktır.

## Kodda yapılan temizlik

- Film şeridinde artık çağrılmayan ofis dokusu, portal karışımı, düzleştirme ve eski çıkış parametreleri kaldırıldı. Aktif halka geometrisi, panel kalibrasyonu ve yedi posterin örüntüsü korundu.
- Sürekli `null`/sıfır dönen kâğıt eylem zinciri, etkisiz callback aktarımları ve kullanılmayan getter'lar temizlendi.
- Tüketicisi olmayan UI seçenekleri, shader uniformu ve yinelenen prop kaldırıldı. Gerçek azaltılmış hareket davranışı ve testlerin kullandığı tanılama alanları korundu.
- Sabit sıfır nedeniyle sonuç üretmeyen eski Canvas2D hareket hesapları sadeleştirildi.
- Dokuz kullanılmayan seçiciye ait 12 CSS kuralı çıkarıldı; kalan kuralların sırası ve değerleri korundu.
- Uygulama kabuğu ve kaydırma koordinasyonu okunabilir biçime getirildi; olay işleyicileri isimlendirildi. Değişmeyen çalışma davranışı sözdizim ağacı karşılaştırmasıyla ayrıca kontrol edildi.
- `.gitignore`, geliştirme yönergeleri ve README güncel teslim yapısına uyarlandı. Gerekli kaynakların yanlışlıkla dışlanmasına neden olan tarihsel yayın listesi kaldırıldı.

Tek renderer/Canvas, tek animasyon saati, mobil doku seçimi, kaynakların serbest bırakılması, klavye/dokunma desteği ve GPU'suz okunabilir görünüm korunuyor. Bağımlılık sürümleri ve kilit dosyası değiştirilmedi.

## Canlı incelemede bulunan yükleme hatası

Masaüstü soğuk açılışında büyük model dokuları ile proje posterleri aynı anda indirilirken, iki çalışanla sırayla yüklenen bütün poster kuyruğuna tek bir 30 saniyelik süre uygulanıyordu. Kuyruğun sonunda bulunan, indirmeye yeni başlamış geçerli görseller bu ortak süre dolunca iptal edilebiliyordu. İncelenen istekler başarılı HTTP yanıtı verdi; sorun görselin bulunmaması değildi.

Temiz sürümde **her aktif görsel isteği kendi 30 saniyelik hakkını kullanır**. Kuyrukta beklemek sonraki görselin süresini tüketmez. Eşzamanlılık hâlâ iki; gerçek hata, takılma ve kaynak temizliği denetimleri korunur. Model/görsel kalitesi düşürülmedi. Başarı, hata, gerçek zaman aşımı, iptal ve geç callback davranışlarını kapsayan dört yükleyici testi eklendi.

## Windows ve Türkçe klasör yolları

Ek Node 22.18.0 kontrolünde, Windows'ta `fs.cpSync` ile özyinelemeli kopyalamanın Türkçe karakter içeren kaynak yolunda native süreç çökmesine neden olduğu tek dosyalık bağımsız örnekle yeniden üretildi. Aynı örnek ASCII yolda geçti. Bu bir renderer hatası değildi.

Temiz kopyada etkilenen test hazırlığı ve statik paket kopyalama işlemi, dosyaların baytlarını değiştirmeyen dizin oluşturma/listeleme/dosya kopyalama adımlarına ayrıldı. Doğrulamalar atlanmadı; kaynak seçimi ve yol güvenliği korundu.

## Korunan varlıklar

Yayına gereken **73 public dosyasının tamamı** başlangıç sürümüyle SHA-256 düzeyinde aynı. Bunlara yedi proje posteri, CRT videosu ve ışık verisi, fontlar, masaüstü/mobil bilgisayar paketleri, atıflar ve lisanslar dahildir.

Masaüstü 4K dokular ve mobil 1K türevleri korunuyor. Mobil modelin `../web/geometry.bin` bağımlılığı da paket içinde bulunur. glTF ve dönüşüm manifestlerindeki dosya/hash ilişkileri doğrulanır. Büyük ham GLB normal kurulum için gerekli değildir; mevcut hazırlanmış paketler ham GLB olmadan doğrulanıp kullanılabilir.

## Doğrulama ve sınırlar

- Ayrı kopyada `npm ci` ile temiz bağımlılık kurulumu tamamlandı.
- Tür kontrolü ve lint geçti. Node 24.19.0 ile **110/110**, Node 22.18.0 ile **110/110** test geçti; atlanan test yok.
- Üretim derlemesi başarılı. Statik yayın paketinde dosya boyutu ve varlık doğrulamaları çalıştı.
- Node 22 ile Türkçe karakterli yolda yeniden paketlenen 102 dosya, Node 24 üretim paketiyle hash ve bayt bazında eşleşti.
- Temiz üretim sürümünde **73/73 GPU tarayıcı kontrolü** ve **12/12 dokunma/DPR kontrolü** geçti. İleri/geri geçişler, proje döngüsü, mobil/tablet ölçüleri, ekran döndürme, WebGL, azaltılmış hareket, GPU kaybı ve yükleme hatası sonrası okunabilir görünüm kapsandı.
- Canlı sürümde dört bölüm ve proje döngüsü için **20/20 kontrol** geçti. Canlı soğuk masaüstü açılışında bulunan yukarıdaki zaman aşımı ayrı bir bulgudur; başarılı mobil tur bu bulguyu geçersiz kılmaz.
- Gerçek tarayıcıda her poster isteği 9 saniye bekletildi. Toplam açılış **44,3 saniye** sürmesine rağmen yedi posterin tamamı yüklendi; tek Canvas ile sahne açıldı ve JavaScript hatası oluşmadı. Böylece toplam 30 saniyelik eski sınırı aşan kuyruk ayrıca doğrulandı.
- Son temiz üretimden alınan **12 sabit kare**; 1440×900, 768×1024 ve 390×844 ölçülerinde orijinal üretim paketinin aynı kareleriyle piksel düzeyinde eşleşti. Tekrarlanabilirlik için azaltılmış hareket kullanıldı. Animasyon etkileşimleri ayrıca tarayıcıda test edildi; bu sonuç her olası animasyon karesinin birebir karşılaştırıldığı anlamına gelmez.

Mobil kontroller Windows Chromium/Edge üzerinde dokunma, DPR ve ekran ölçüsü emülasyonudur; fiziksel iPhone/Safari doğrulaması değildir. Bu teslimde canlıya yayın, GitHub'a gönderim veya orijinal klasörden silme yapılmadı.

## Paketi kullanma

Arşivi açıp proje klasöründe `npm ci` ve `npm run dev` çalıştırın. Üretim kontrolü için `npm run check`, `npm run build`, ardından `npm run preview` kullanılır. Ayrıntılar [README.md](README.md), tarayıcı araçları [qa/README.md](qa/README.md) içinde bulunur.

`MANIFEST.sha256`, teslim edilen kaynak ve varlık dosyalarının bütünlüğünü kontrol etmek içindir. Üretilen ZIP ayrıca tekrar okunarak dosya sayısı, boyut ve her dosyanın SHA-256 değeri doğrulanmıştır. Yeniden üretilebilir derleme çıktıları arşive eklenmemiştir.
