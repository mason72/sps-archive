/**
 * Fonts for the paste-ready cards.
 *
 * `ImageResponse` (satori) draws text itself and needs TTF/OTF bytes; it does
 * not see the next/font faces the app loads. The gallery's OG image gets by
 * with satori's default serif; a card a client pastes into a deck does not.
 * The two faces are fetched from Google Fonts once per server instance and
 * kept in module scope. A fetch failure degrades to satori's defaults rather
 * than failing the card: a plainer card beats no card.
 */

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
}

const FACES: { name: string; weight: CardFont["weight"]; css: string }[] = [
  { name: "Playfair Display", weight: 700, css: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700" },
  { name: "Inter", weight: 500, css: "https://fonts.googleapis.com/css2?family=Inter:wght@500" },
  { name: "Inter", weight: 600, css: "https://fonts.googleapis.com/css2?family=Inter:wght@600" },
];

// A user agent old enough that Google Fonts answers with WOFF (modern UAs get
// woff2, which satori cannot read).
const TTF_UA = "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:5.0) Gecko/20100101 Firefox/5.0";

let cached: Promise<CardFont[]> | null = null;

async function fetchFace(face: (typeof FACES)[number]): Promise<CardFont | null> {
  try {
    const css = await fetch(face.css, {
      headers: { "User-Agent": TTF_UA },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.text() : ""));
    // satori reads TTF, OTF and WOFF (not woff2); Google answers this UA with WOFF.
    const url = /src:\s*url\(([^)]+\.(?:ttf|otf|woff))\)/.exec(css)?.[1];
    if (!url) return null;
    const data = await fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) =>
      r.ok ? r.arrayBuffer() : null
    );
    if (!data) return null;
    return { name: face.name, data, weight: face.weight, style: "normal" };
  } catch {
    return null;
  }
}

export function loadCardFonts(): Promise<CardFont[]> {
  if (!cached) {
    cached = Promise.all(FACES.map(fetchFace)).then((faces) => {
      const ok = faces.filter((f): f is CardFont => f !== null);
      // Keep retrying on later requests until every face has loaded once.
      if (ok.length < FACES.length) cached = null;
      return ok;
    });
  }
  return cached;
}
