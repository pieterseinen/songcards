# Song Cards

Turn a Spotify playlist into printable, double-sided song cards: a QR code on the front, artist, release year and title on the back. The cards are made for the Song Scanner Android app, which plays the song without showing what it is.

Everything runs in your browser. Login uses Spotify's own login page (PKCE, no secret), and the PDF is generated locally.

## Using it

1. Open the page and paste a link to a Spotify playlist **you own or collaborate on**. For someone else's playlist, copy it first in Spotify: **⋯ → Add to other playlist → New playlist**.
2. Log in with Spotify when asked. Your account must be added to the app by its owner; it is in Spotify's development mode, which only allows listed users.
3. Leave **Find original release years** on (recommended). Spotify dates songs by the album they're on, so compilations and remasters get later years; with this on, each song is also looked up in Apple's iTunes catalog and MusicBrainz and the earliest year is used. It takes about 3 seconds per song because of those services' rate limits, and results are remembered in your browser. Check highlighted rows and type a year to override any song.
4. Download the PDF and print it **double-sided** (flip on the long edge unless you picked otherwise), at **100% / actual size**. Cut along the lines; 12 cards of 6.5 × 6.5 cm per A4 sheet.

## Running locally

Double-click `start.bat` (needs Python). It serves the page at `http://127.0.0.1:8888/`, which is registered as a redirect URI.

## Third-party code

- `lib/jspdf.umd.min.js`: [jsPDF](https://github.com/parallax/jsPDF) 2.5.1, MIT license
- `lib/qrcode.min.js`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by Kazuhiko Arase, MIT license
