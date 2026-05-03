<div align="center">

# Nipah! Anime

**A bilingual desktop app for anime and manga.**  
**Una aplicación de escritorio bilingüe para anime y manga.**

Watch anime, read manga, track progress, and manage your library from one desktop app built for people who want everything in one place.  
Mira anime, lee manga, sigue tu progreso y gestiona tu biblioteca desde una sola app de escritorio pensada para tenerlo todo en un solo lugar.

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-1f6feb?style=flat-square)](#supported-platforms)
[![Built With](https://img.shields.io/badge/built%20with-Wails%20%2B%20Go%20%2B%20React-f97316?style=flat-square)](#tech-stack)
[![AniList Sync](https://img.shields.io/badge/sync-AniList-02a9ff?style=flat-square)](#english)
[![Version](https://img.shields.io/badge/release-v3.0.0-22c55e?style=flat-square)](https://github.com/NipahDevTeam/Nipah--Anime/releases)

<p>
  <a href="#english">English</a> ·
  <a href="#espanol">Español</a> ·
  <a href="#supported-platforms">Platforms</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#providers">Providers</a>
</p>

</div>

<p align="center">
  <img src="./app1.png" alt="Nipah! Anime home interface" width="100%" />
</p>

<p align="center">
  <img src="./app2.png" alt="Nipah! Anime anime catalog" width="49%" />
  <img src="./app3.png" alt="Nipah! Anime manga catalog" width="49%" />
</p>

---

## Supported Platforms

- **Windows** via installer
- **Linux** via `.deb`, `.AppImage`, and `PKGBUILD`

> Nipah! Anime is designed as a desktop-first experience. The app is built to feel fast, focused, and comfortable for long viewing and reading sessions.

---

## Tech Stack

- **Go** for the desktop backend and app logic
- **Wails** for the desktop application layer
- **React** for the frontend interface
- **Vite** for the frontend build pipeline
- **MPV** for anime playback

---

<a id="english"></a>

## English

### What is Nipah! Anime?

Nipah! Anime is a desktop app that brings together anime streaming, manga reading, AniList syncing, and local library management in one place. It is built for users who want a cleaner workflow than juggling browser tabs, separate readers, media lists, and local folders all at once.

The app is designed for both English-speaking and Spanish-speaking users, with a bilingual interface and source support that reflects both audiences.

### Why use it?

- Keep anime, manga, lists, and local content in one desktop app.
- Move between watching, reading, and tracking without leaving the interface.
- Use AniList sync to keep your progress updated.
- Mix online usage with a local library workflow.
- Choose between English and Spanish in the app itself.

### Features

- Stream anime from multiple online providers.
- Download episodes directly where supported.
- Read manga inside the app with a dedicated reader.
- Sync anime and manga progress with AniList.
- Manage anime and manga lists from one place.
- Browse modern anime and manga catalogs quickly.
- Keep a local library for offline or self-managed content.
- Continue watching and continue reading with a desktop-first flow.

### Providers

<a id="providers"></a>

#### Anime

- `JKAnime` [ES]
- `AnimeFLV` [ES]
- `AnimeAV1` [ES] [Dubbed Anime] [Direct Download]
- `AnimePahe` [EN] [Dubbed Anime] [Direct Download]
- `AnimeHeaven` [EN]
- `AnimeGG` [EN]

#### Manga

- `M440` [ES]
- `SenshiManga` [ES]
- `MangaOni` [ES]
- `MangaFire` [EN/ES]
- `MangaPill` [EN]
- `WeebCentral` [EN]
- `TempleToons` [EN]

<details>
<summary><strong>Notes</strong></summary>

- Provider availability can change over time depending on upstream services.
- Audio variants, stream behavior, and direct downloads vary by provider.

</details>

---

<a id="espanol"></a>

## Español

### ¿Qué es Nipah! Anime?

Nipah! Anime es una aplicación de escritorio que reúne streaming de anime, lectura de manga, sincronización con AniList y gestión de biblioteca local en un solo lugar. Está pensada para usuarios que quieren una experiencia más limpia que depender de pestañas del navegador, lectores separados, listas externas y carpetas locales al mismo tiempo.

La aplicación está diseñada tanto para usuarios hispanohablantes como para usuarios de habla inglesa, con una interfaz bilingüe y soporte de fuentes pensado para ambas audiencias.

### ¿Por qué usarla?

- Reúne anime, manga, listas y contenido local en una sola app.
- Permite pasar de ver a leer y seguir progreso sin salir de la interfaz.
- Usa sincronización con AniList para mantener el progreso al día.
- Combina uso online con una biblioteca local.
- Permite elegir entre español e inglés dentro de la aplicación.

### Funcionalidades

- Reproduce anime desde múltiples proveedores online.
- Descarga episodios directamente donde esté soportado.
- Lee manga dentro de la app con un lector dedicado.
- Sincroniza el progreso de anime y manga con AniList.
- Administra listas de anime y manga desde un solo lugar.
- Explora catálogos modernos de anime y manga rápidamente.
- Mantén una biblioteca local para contenido offline o gestionado por ti.
- Continúa viendo y continúa leyendo con un flujo pensado para escritorio.

### Proveedores

#### Anime

- `JKAnime` [ES]
- `AnimeFLV` [ES]
- `AnimeAV1` [ES] [Anime doblado] [Descarga directa]
- `AnimePahe` [EN] [Anime doblado] [Descarga directa]
- `AnimeHeaven` [EN]
- `AnimeGG` [EN]

#### Manga

- `M440` [ES]
- `SenshiManga` [ES]
- `MangaOni` [ES]
- `MangaFire` [EN/ES]
- `MangaPill` [EN]
- `WeebCentral` [EN]
- `TempleToons` [EN]

<details>
<summary><strong>Notas</strong></summary>

- La disponibilidad de los proveedores puede cambiar con el tiempo según los servicios externos.
- Las variantes de audio, el comportamiento del streaming y la descarga directa varían según el proveedor.

</details>

---

## Installation

### English

#### Windows

1. Open the latest release on GitHub.
2. Download `Nipah! Anime-amd64-installer.exe`.
3. Run the installer.
4. Choose your preferred app language on first install.
5. Launch Nipah! Anime from the desktop shortcut or Start Menu.

#### Linux

Choose the format that best fits your system:

- `.deb` for Debian, Ubuntu, Linux Mint, and similar distributions
- `.AppImage` for a portable single-file build
- `PKGBUILD` for Arch Linux and Arch-based distributions

#### Installation Notes

- On **Windows**, MPV is bundled with the installer build.
- On **Linux**, `mpv` is required by the packaged release.
- The Linux package set currently targets `x86_64`.

### Español

#### Windows

1. Abre la última release en GitHub.
2. Descarga `Nipah! Anime-amd64-installer.exe`.
3. Ejecuta el instalador.
4. Elige el idioma preferido de la aplicación durante la instalación inicial.
5. Abre Nipah! Anime desde el acceso directo del escritorio o desde el menú Inicio.

#### Linux

Elige el formato que mejor se adapte a tu sistema:

- `.deb` para Debian, Ubuntu, Linux Mint y distribuciones similares
- `.AppImage` para una compilación portable en un solo archivo
- `PKGBUILD` para Arch Linux y distribuciones basadas en Arch

#### Notas de instalación

- En **Windows**, MPV viene incluido con el instalador.
- En **Linux**, `mpv` es necesario para la versión empaquetada.
- El conjunto actual de paquetes para Linux está orientado a `x86_64`.

---

## AniList

AniList is used for account sync and progress tracking.

- Anime progress sync
- Manga progress sync
- List management integration
- Better continuity between long sessions and restarts

---

## Disclaimer

Nipah! Anime is a desktop client. It does not host or distribute media content. Anime and manga are accessed through third-party providers whose availability may change over time.

Use responsibly and according to the laws and regulations of your country.

