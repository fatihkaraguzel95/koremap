# Google Maps → Naver Map Favori Aktarımı

## Kısa cevap

**Doğrudan aktarım mümkün değil.** Naver 지도'nun favorilerine (즐겨찾기 / MY장소) dosya
içe aktarma özelliği yok — ne mobil uygulamada, ne map.naver.com'da, ne de yazılabilir
bir public API'de.

> Forumlarda dolaşan "KML'i CSV'ye çevir, Naver'a import et" cevabı uydurma;
> Naver'da öyle bir ekran yok.

Google tarafı ise sorunsuz: Takeout'tan yıldızlı yerleri/listeleri **CSV, KML veya
GeoJSON** olarak çıkarmak mümkün.

---

## Seçenekler

### 1. Yarı-otomatik köprü (en verimli)

Takeout çıktısını alıp, her mekan için tek tıkla Naver'da açan bir link listesi
(HTML sayfası) üretmek.

**Akış:**

1. Takeout → `Saved Places` / liste CSV'leri → ad + koordinat çıkar
2. Naver Local Search API (Naver Developers, ücretsiz key) ile her mekanı
   adı + koordinatıyla eşleştir, Naver place ID'sini bul
3. Koordinat mesafesiyle doğrula (ör. >150 m sapma varsa "şüpheli" işaretle)
4. Çıktı: yanında ✅/⚠️ durumu olan, `https://map.naver.com/p/entry/place/{id}`
   linkleri içeren bir sayfa

Sonra PC'de map.naver.com'da oturum açıp listeyi yukarıdan aşağı gezip yıldıza
tıklıyorsun. **100 mekan ≈ 10–15 dakika.**

Kaydetme adımı manuel kalıyor çünkü Naver'a programatik yazma yolu yok — ama asıl
zaman kaybı olan "arama + doğru yeri bulma" kısmı otomatikleşiyor.

### 2. Ana zorluk: isim eşleşmesi

Google'daki Korece mekanlar çoğu zaman romanize (ör. `Gwangjang Market`), Naver ise
Korece isimle çalışıyor (`광장시장`). Bu yüzden düz isimle arama sık sık patlar.
**Koordinat üzerinden eşleştirme şart.** Yukarıdaki araç bunu yapıyor.

### 3. Naver'ı hiç zorlamayan alternatif

Listeyi Google Maps'te bırak, Naver'ı sadece navigasyon için kullan. Kore'de Google
yol tarifi vermiyor ama kayıtlı yerler + koordinat kopyalama çalışıyor. Bir yere
giderken Google'dan adı kopyala → Naver'a yapıştır.

### 4. Gerçekten import destekleyen uygulamalar

Naver şart değilse:

- **Organic Maps** — KML/GPX import eder, Kore'de offline çalışır
- **Maps.me** — aynı şekilde

**Kakao Map** de Naver gibi import desteklemiyor; oraya kaçmanın anlamı yok.

---

## Sonraki adım

1. maddedeki aracı kurmak için gerekenler:

- Google Takeout çıktısı (`Saved Places` klasörü ya da liste CSV'leri)
- Bir [Naver Developers](https://developers.naver.com) Client ID / Secret

Key alınmak istenmezse API'siz, sadece arama linki üreten daha basit bir sürüm de
yapılabilir (eşleştirme doğrulaması olmadan).

---

## Kaynaklar

- [Can saved places in Google MyMap be transferred to Naver Map — Tripadvisor Seoul Forum](https://www.tripadvisor.com/ShowTopic-g294197-i8161-k14713311-Can_saved_places_in_Google_MyMap_be_transfer_over_to_Naver_M-Seoul.html)
- [How to Export Google Maps Saved Places (Takeout, CSV)](https://triplyplanner.com/blog/export-google-maps-saved-places)
