# Koremap

Google Maps favorilerini Kore haritasında gösteren, tek dokunuşla **Naver Map**'te
yol tarifi açan telefon uygulaması. Kurulum gerektirmeyen bir PWA — Android ve iOS'ta
tarayıcıdan çalışır, ana ekrana eklenince tam ekran uygulama gibi açılır.

**Canlı:** https://fatihkaraguzel95.github.io/koremap/

---

## Neden böyle çalışıyor

Naver 지도'nun favorilerine dosya içe aktarma yolu yok — ne uygulamada, ne
`map.naver.com`'da, ne de yazılabilir bir API'de. Bu yüzden uygulama Naver'a
*yazmıyor*; favorileri kendi içinde tutup navigasyonu Naver'a devrediyor:

```
Google Takeout  →  Koremap (liste + harita)  →  nmap:// deep link  →  Naver Map
```

Kaydetme adımı ortadan kalkıyor, zaman kaybının asıl kaynağı olan
"Naver'da doğru yeri arama" işi bitiyor.

## Özellikler

- **İçe aktarma** — Takeout `.zip`'ini olduğu gibi at; içindeki CSV / JSON / KML / GPX
  dosyaları bulunup ayrıştırılır (ZIP açma tarayıcının `DecompressionStream`'i ile,
  kütüphanesiz)
- **Sadece Kore filtresi** — diğer ülkelerdeki kayıtları içe aktarmada eler
- **Harita** — kümelenen pin'ler, listeye göre renk, arama, kategori filtreleri
- **Detay** — not, adres, koordinat, konumuna uzaklık
- **Naver'a devret** — toplu taşıma / araba / yürüyerek yol tarifi ya da yeri göster.
  Naver uygulaması kuruluysa o açılır, değilse ~1,3 sn sonra `map.naver.com`'a düşer
- **Eksik veri tamamlama** — Google'ın vermediği koordinat ve isimleri
  OpenStreetMap (Nominatim) üzerinden bulur; koordinattan isim (ters geocoding) ve
  adresten koordinat (kademeli sadeleştirmeyle ileri geocoding)
- **Çevrimdışı** — service worker uygulama kabuğunu ve gezilen harita karolarını
  önbelleğe alır
- **Açık/koyu tema**, konum takibi, yakınlığa göre sıralama

Veriler yalnızca telefonun `localStorage`'ında durur; hiçbir sunucuya gitmez.

## Telefona kurma

1. Telefonda yukarıdaki adresi aç
2. **iOS (Safari):** Paylaş → *Ana Ekrana Ekle*
   **Android (Chrome):** ⋮ → *Uygulamayı yükle*
3. Ana ekrandaki simgeden aç — adres çubuğu olmadan tam ekran açılır

## Favorileri Google'dan indirme

1. [takeout.google.com](https://takeout.google.com) → **Tümünün seçimini kaldır**
2. **Saved** (*Kaydedilenler*) kutusunu işaretle — favori listelerin burada
   > "Maps (your places)" tek başına yetmez; o yalnızca eski yıldızlı kayıtları
   > verir ve çoğu zaman isimsiz, koordinatsız gelir.
3. Dışa aktar → e-postaya gelen `.zip`'i indir
4. Zip'i uygulamaya sürükle

Alternatif (tek liste, daha hızlı): masaüstünde
[google.com/maps](https://google.com/maps) → **Kaydedilenler** → listeyi aç →
**⋮** → *Listeyi dışa aktar* → CSV.

## Yerelde çalıştırma

```bash
python -m http.server 8781
# http://localhost:8781
```

Service worker ve konum izni için `http://localhost` ya da HTTPS gerekir;
`file://` ile açılırsa harita çalışır ama PWA özellikleri devre dışı kalır.

## Dosyalar

| Dosya | İş |
|---|---|
| `index.html` | iskelet, ikonlar, modal |
| `app.css` | tema token'ları, alt panel, liste/detay |
| `app.js` | harita, panel, Naver deep link'leri, içe aktarma, geocoding |
| `parse.js` | Takeout ayrıştırıcıları (GeoJSON / CSV / KML / GPX) + URL'den koordinat çıkarma |
| `sw.js` | çevrimdışı önbellek |

## Kaynaklar

- [Naver Maps URL Scheme](https://guide.ncloud-docs.com/docs/naveropenapiv3-maps-url-scheme)
- [Nominatim kullanım koşulları](https://operations.osmfoundation.org/policies/nominatim/) — saniyede 1 istek
