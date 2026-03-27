<div align="center">

# Nipah! Anime

**A bilingual desktop app for watching anime, reading manga, tracking progress, and syncing everything with AniList.**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=flat-square)](https://github.com/NipahDevTeam/Nipah--Anime/releases)
[![Built with Wails](https://img.shields.io/badge/built%20with-Wails-ff3e00?style=flat-square)](https://wails.io)
[![Sync](https://img.shields.io/badge/sync-AniList-02a9ff?style=flat-square)](https://anilist.co)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

<br/>

<a href="#english-readme">English</a> &nbsp;|&nbsp; <a href="#readme-espanol">Español</a>

</div>

---

<a id="english-readme"></a>

<div align="right"><a href="#readme-espanol">Ver en Español</a></div>

## What is Nipah! Anime?

Nipah! Anime is a **desktop client** for anime and manga fans who want everything in one place: streaming, reading, progress tracking, lists, and AniList sync, without living inside a browser.

Built with **Go, React, and Wails**, it aims to feel fast, native, and focused, with a bilingual UI designed for both Spanish-speaking and English-speaking users.

> **Watch anime. Read manga. Track everything. Sync with AniList. All from your desktop.**

---

## Screenshots

![Home](./readme/home.png)
![My Lists](./readme/my-lists.png)
![Anime Online](./readme/anime-online.png)
![Manga Online](./readme/manga-online.png)

---

## Features

### Anime
- Online anime search and streaming from multiple sources
- Direct playback through **MPV**
- Continue Watching support on Home
- AniList-powered title matching for difficult aliases
- Automatic AniList progress sync while you watch

### Manga
- Online manga search with in-app reading flow
- Multiple manga source support
- Continue Reading support on Home
- AniList-backed identity and cover matching
- Manga chapter progress sync with AniList

### Local Library
- Import local anime and manga folders
- Automatic scans on startup
- Local progress persistence for offline content

### Lists and Tracking
- Separate anime and manga list views
- Add titles manually from AniList
- Edit status, progress, and score
- Local-first sync queue with retry behavior for AniList jobs

### UI and Experience
- Bilingual interface: **English / Español**
- Catalog-first Home with anime and manga sections
- Cleaner featured hero, tighter layout, and auto-rotating spotlight
- Dark desktop-first visual design with black/orange direction

### Updates
- Built-in update checker connected to GitHub Releases
- Changelog shown inside the update flow
- One-click installer launch for new Windows releases

---

## Supported Platforms

- **Windows** via installer
- **Linux** via:
  - `.AppImage` bundled with **WebKit2GTK 4.1**
  - `.deb` package for Ubuntu/Debian-based distros
  - `PKGBUILD` for Arch-based distros

---

## Supported Sources

### Anime
- JKAnime
- AnimeFLV
- AnimeAV1
- AnimePahe
- AnimeHeaven
- AnimeGG

### Manga
- M440
- SenshiManga
- MangaOni
- WeebCentral
- TempleToons
- MangaPill
- MangaFire

Source availability may change over time depending on upstream sites.

---

## AniList Integration

Nipah! Anime uses **AniList** as its main account and sync provider.

- AniList login
- Anime list sync
- Manga list sync
- Automatic progress syncing from playback and reading

---

## Building from Source

OAuth credentials are not included in this repository.

Check `.env.example` for the environment variables needed to register and configure your own AniList app for local development.

Core stack:
- Go
- Wails v2
- React
- Vite

---

## Installation

### Windows
1. Go to the [Releases](https://github.com/NipahDevTeam/Nipah--Anime/releases) page.
2. Download the latest Windows installer.
3. Run the installer.
4. Choose language correctly. This will affect source preference inside the app.
5. Launch **Nipah! Anime** from Start Menu or desktop.

### Linux
Download the format that fits your distro from the latest release:
- `.AppImage`
- `.deb`
- `PKGBUILD`

---

## Requirements

| Requirement | Details |
|-------------|---------|
| OS | Windows 10/11 (64-bit) or modern Linux |
| MPV | Required for anime playback |
| Internet | Required for online sources and AniList sync |

### MPV

Nipah! Anime uses **MPV** for playback.

- On Windows, MPV can be bundled or configured manually
- On Linux, install `mpv` through your package manager

Official site: [mpv.io](https://mpv.io)

---

## Disclaimer

Nipah! Anime is a **desktop client**. It does not host, store, or distribute media content. Anime and manga are accessed through third-party sources whose availability may change over time.

Use responsibly and according to the laws of your country.

---

<br/>
<br/>

---

<a id="readme-espanol"></a>

<div align="right"><a href="#english-readme">View in English</a></div>

## ¿Qué es Nipah! Anime?

Nipah! Anime es un **cliente de escritorio** para fans del anime y el manga que quieren tener todo en un solo lugar: streaming, lectura, seguimiento de progreso, listas y sincronización con AniList, sin depender del navegador.

Construido con **Go, React y Wails**, busca sentirse rápido, nativo y enfocado, con una interfaz bilingüe pensada tanto para hispanohablantes como para usuarios en inglés.

> **Mira anime. Lee manga. Registra tu progreso. Sincroniza con AniList. Todo desde tu escritorio.**

---

## Capturas de pantalla

![Inicio](./readme/home.png)
![Mis Listas](./readme/my-lists.png)
![Anime Online](./readme/anime-online.png)
![Manga Online](./readme/manga-online.png)

---

## Funcionalidades

### Anime
- Búsqueda y streaming de anime en línea desde múltiples fuentes
- Reproducción directa con **MPV**
- Sección de **Continuar viendo** en Inicio
- Coincidencia de títulos con AniList para aliases difíciles
- Sincronización automática del progreso con AniList mientras ves

### Manga
- Búsqueda de manga en línea con flujo de lectura dentro de la app
- Soporte para múltiples fuentes de manga
- Sección de **Continuar leyendo** en Inicio
- Identidad y portadas apoyadas por AniList
- Sincronización de progreso de capítulos con AniList

### Biblioteca local
- Importa carpetas locales de anime y manga
- Escaneo automático al iniciar
- Persistencia de progreso para contenido offline

### Listas y seguimiento
- Vistas separadas para anime y manga
- Agregar títulos manualmente desde AniList
- Editar estado, progreso y puntuación
- Cola de sincronización local con reintentos para trabajos de AniList

### Interfaz y experiencia
- Interfaz bilingüe: **Español / English**
- Inicio orientado a catálogo con secciones de anime y manga
- Hero destacado más limpio, compacto y rotatorio
- Diseño oscuro con dirección visual negro/naranja

### Actualizaciones
- Verificador integrado conectado a GitHub Releases
- Changelog visible dentro del flujo de actualización
- Lanzamiento con un clic del instalador nuevo en Windows

---

## Plataformas soportadas

- **Windows** mediante instalador
- **Linux** mediante:
  - `.AppImage` con **WebKit2GTK 4.1** incluido
  - paquete `.deb` para Ubuntu/Debian y derivados
  - `PKGBUILD` para Arch y derivados

---

## Fuentes soportadas

### Anime
- JKAnime
- AnimeFLV
- AnimeAV1
- AnimePahe
- AnimeHeaven
- AnimeGG

### Manga
- M440
- SenshiManga
- MangaOni
- WeebCentral
- TempleToons
- MangaPill
- MangaFire

La disponibilidad de las fuentes puede cambiar con el tiempo según los sitios externos.

---

## Integración con AniList

Nipah! Anime usa **AniList** como proveedor principal de cuenta y sincronización.

- Inicio de sesión con AniList
- Sincronización de lista de anime
- Sincronización de lista de manga
- Envío automático del progreso desde reproducción y lectura

---

## Compilar desde el código fuente

Las credenciales OAuth no están incluidas en este repositorio.

Consulta `.env.example` para ver las variables necesarias y configurar tu propia app de AniList para desarrollo local.

Stack principal:
- Go
- Wails v2
- React
- Vite

---

## Instalación

### Windows
1. Ve a [Releases](https://github.com/NipahDevTeam/Nipah--Anime/releases).
2. Descarga el instalador más reciente para Windows.
3. Ejecuta el instalador.
4. Elige el idioma correctamente, esto afectara las preferencias de fuentes dentro de la app.
5. Abre **Nipah! Anime** desde el menú Inicio o el escritorio.

### Linux
Descarga desde la última release el formato que mejor se adapte a tu distro:
- `.AppImage`
- `.deb`
- `PKGBUILD`

---

## Requisitos

| Requisito | Detalles |
|-----------|----------|
| Sistema operativo | Windows 10/11 (64-bit) o Linux moderno |
| MPV | Necesario para reproducir anime |
| Internet | Necesario para fuentes online y sincronización con AniList |

### MPV

Nipah! Anime utiliza **MPV** como reproductor.

- En Windows puede venir incluido o configurarse manualmente
- En Linux debes instalar `mpv` desde el gestor de paquetes de tu distro

Sitio oficial: [mpv.io](https://mpv.io)

---

## Aviso legal

Nipah! Anime es un **cliente de escritorio**. No aloja, almacena ni distribuye contenido multimedia. El anime y manga se acceden desde fuentes de terceros cuya disponibilidad puede cambiar con el tiempo.

Úsalo de forma responsable y de acuerdo con las leyes de tu país.

---

<div align="center">

Made with love for anime fans everywhere · Hecho con amor para fans del anime en todo el mundo

</div>
