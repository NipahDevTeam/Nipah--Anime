<div align="center">

# Nipah! Anime

**A bilingual desktop app for watching anime, reading manga, and syncing your progress with AniList.**

[![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square&logo=windows)](https://github.com)
[![Built with Wails](https://img.shields.io/badge/built%20with-Wails-ff3e00?style=flat-square)](https://wails.io)
[![AniList](https://img.shields.io/badge/sync-AniList-02a9ff?style=flat-square)](https://anilist.co)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

<br/>

<a href="#english-readme">🇺🇸 English</a> &nbsp;|&nbsp; <a href="#readme-español">🇪🇸 Español</a>

</div>

---

<a id="english-readme"></a>

<div align="right"><a href="#readme-español">🇪🇸 Ver en Español</a></div>

## What is Nipah! Anime?

Nipah! Anime is a **desktop client** for anime and manga fans who want everything in one place — streaming, reading, progress tracking, and AniList sync — without opening a browser. Built with Go, React, and Wails, it runs as a native Windows app with a polished bilingual UI designed for both Spanish-speaking and English-speaking audiences.

> **Watch anime. Read manga. Track everything. Sync with AniList. All from your desktop.**

---

## Screenshots

> *(Screenshots)*
> <img width="2559" height="1355" alt="search" src="https://github.com/user-attachments/assets/91965ff8-5ebb-429a-96c9-b51ffcd7d2dc" />
<img width="2559" height="1358" alt="discover" src="https://github.com/user-attachments/assets/d2057270-fd08-45e9-a7a5-52ef5fa8870b" />
<img width="2559" height="1365" alt="my_lists" src="https://github.com/user-attachments/assets/b0f020db-4828-4a94-ae77-cd652cd9dbb0" />



---

## Features

###  Anime
- Online anime search and streaming
- Direct playback through **MPV** (no browser needed)
- Episode progress tracking with **Continue Watching** on Home
- AniList-powered title matching for hard-to-find aliases
- Automatic AniList progress sync as you watch

###  Manga
- Online manga search and in-app reader
- Chapter progress persistence with **Continue Reading** on Home
- AniList-backed cover and identity matching
- Automatic chapter backfill when jumping ahead
- AniList manga progress sync

###  Local Library
- Import local anime and manga folders
- Automatic scan on startup
- Local progress persistence for offline content

###  Lists & Tracking
- Separate anime and manga list views
- Add titles manually from AniList search
- Edit status, episode/chapter progress, and score
- Remove from local list or from AniList simultaneously
- Local-first sync queue with automatic retry for failed AniList jobs

###  UI & Experience
- **Bilingual interface** — Español and English, switchable at any time
- Redesigned Home with anime and manga sections
- Onboarding screen for new users
- Discover page with curated AniList trending content
- Clean typography and focused visual design

###  Auto-Updater
- In-app update checker connected to GitHub Releases
- Changelog shown directly in the update popup
- One-click download and launch of the newest installer

---

## Supported Sources

### Anime
| Source | Language |
|--------|----------|
| JKAnime | Spanish |
| AnimePahe | English |

### Manga
| Source | Language |
|--------|-------|
| SenshiManga | Spanish |
| MangaOni | Spanish |
| TempleToons | English |
| MangaFire | English |

---

## AniList Integration

Nipah! Anime uses **AniList** as its primary account and sync provider.

-  AniList login
-  Anime list sync (watch status, progress, score)
-  Manga list sync (read status, chapter progress, score)
-  Automatic progress push from playback and reading sessions

---

## Installation

1. Go to the [**Releases**](../../releases) page.
2. Download the latest `.exe` installer.
3. Run the installer and follow the on-screen steps.
4. Launch **Nipah! Anime** from your desktop or Start Menu.

---

## Requirements

| Requirement | Details |
|-------------|---------|
| OS | Windows 10 / 11 (64-bit) |
| MPV | Required for anime playback ([mpv.io](https://mpv.io)) |
| Internet | Required for online sources and AniList sync |

### MPV Setup

Nipah! Anime uses **MPV** as its video player. MPV is automatically installed along with the app if you don't already have it. You need to have MPV installed and accessible on your system `PATH`, or placed in the app directory.

- Download MPV from [mpv.io](https://mpv.io/installation/)
- Add the folder containing `mpv.exe` to your system PATH, or place it alongside the app executable.

---

## Updates

The app includes a built-in updater. When a new version is available:

1. A notification will appear on launch.
2. You can read the changelog directly in the popup.
3. Click **Download & Install** to automatically fetch and launch the new installer.

You can also check for updates manually in **Settings**.

---

## Disclaimer

Nipah! Anime is a **desktop client** — it does not host, store, or distribute any media content. All anime and manga content is sourced from third-party websites. The availability of sources may change over time and is not under the control of this project.

Use responsibly and in accordance with the laws of your country.

---

<br/>
<br/>

---

<a id="readme-español"></a>

<div align="right"><a href="#english-readme">🇺🇸 View in English</a></div>

## ¿Qué es Nipah! Anime?

Nipah! Anime es un **cliente de escritorio** para fans del anime y el manga que quieren tenerlo todo en un solo lugar — streaming, lectura, seguimiento de progreso y sincronización con AniList — sin necesidad de abrir un navegador. Construido con Go, React y Wails, funciona como una aplicación nativa de Windows con una interfaz bilingüe pensada tanto para hispanohablantes como para angloparlantes.

> **Mira anime. Lee manga. Registra tu progreso. Sincroniza con AniList. Todo desde tu escritorio.**

---

## Capturas de pantalla

> <img width="2559" height="1351" alt="buscar" src="https://github.com/user-attachments/assets/1dc1f9b5-7368-46c5-9648-c812a5a8282b" />
<img width="2559" height="1351" alt="mi_lista" src="https://github.com/user-attachments/assets/8aa1c331-4d3c-494e-8ea9-ee40739da89e" />
<img width="2559" height="1361" alt="descubrir" src="https://github.com/user-attachments/assets/e3a618c5-aa2c-4c95-80b2-d8f0d3c36601" />


---

## Funcionalidades

###  Anime
- Búsqueda y reproducción de anime en línea 
- Reproducción directa con **MPV** (sin necesidad de un navegador)
- Seguimiento de episodios con **Continuar viendo** en la pantalla principal
- Coincidencia de títulos con AniList para aliases difíciles de encontrar
- Sincronización automática del progreso con AniList mientras ves

###  Manga
- Búsqueda de manga en línea con lector integrado en la app
- Persistencia del progreso por capítulo con **Continuar leyendo** en el inicio
- Identificación de portadas y títulos mediante AniList
- Marcado automático de capítulos anteriores al abrir uno más avanzado
- Sincronización del progreso de manga con AniList

###  Biblioteca Local
- Importa carpetas locales de anime y manga
- Escaneo automático al iniciar la aplicación
- Persistencia del progreso local para contenido sin conexión

###  Listas y Seguimiento
- Vistas separadas para tu lista de anime y manga
- Agrega títulos manualmente desde la búsqueda de AniList
- Edita el estado, el progreso de episodios/capítulos y la puntuación
- Elimina de tu lista local o también de AniList al mismo tiempo
- Cola de sincronización local con reintento automático para trabajos fallidos de AniList

###  Interfaz y Experiencia
- **Interfaz bilingüe** — Español e inglés, cambiable en cualquier momento
- Pantalla de inicio rediseñada con secciones de anime y manga
- Pantalla de bienvenida para nuevos usuarios
- Página de Descubrir con contenido de tendencias de AniList
- Tipografía limpia y diseño visual enfocado

### 🔄 Actualizador Automático
- Verificador de actualizaciones integrado conectado a GitHub Releases
- El changelog se muestra directamente en el popup de actualización
- Descarga e instalación con un solo clic del instalador más reciente

---

## Fuentes Soportadas

### Anime
| Fuente | Idioma |
|--------|--------|
| JKAnime | Español |
| AnimePahe | Inglés |

### Manga
| Fuente | Idioma |
|--------|-------|
| SenshiManga | Español |
| MangaOni | Español |
| TempleToons | Ingles |
| MangaFire | Ingles |

---

## Integración con AniList

Nipah! Anime usa **AniList** como su proveedor principal de cuenta y sincronización.

-  Inicio de sesión con AniList
-  Sincronización de lista de anime (estado, progreso, puntuación)
-  Sincronización de lista de manga (estado, capítulo, puntuación)
-  Envío automático del progreso desde la reproducción y la lectura

---

## Instalación

1. Ve a la página de [**Releases**](../../releases).
2. Descarga el instalador `.exe` más reciente.
3. Ejecuta el instalador y sigue los pasos en pantalla.
4. Abre **Nipah! Anime** desde tu escritorio o el menú Inicio.

---

## Requisitos

| Requisito | Detalles |
|-----------|---------|
| Sistema Operativo | Windows 10 / 11 (64-bit) |
| MPV | Necesario para reproducir anime ([mpv.io](https://mpv.io)) |
| Internet | Necesario para fuentes en línea y sincronización con AniList |

### Configuración de MPV

Nipah! Anime utiliza **MPV** como reproductor de video. MPV se instal automaticamente junto con la app. Necesitas tener MPV instalado y accesible desde el `PATH` del sistema, o colocarlo en el directorio de la aplicación.

- Descarga MPV desde [mpv.io](https://mpv.io/installation/)
- Agrega la carpeta que contiene `mpv.exe` al PATH del sistema, o colócalo junto al ejecutable de la app.

---

## Actualizaciones

La app incluye un actualizador integrado. Cuando hay una nueva versión disponible:

1. Aparecerá una notificación al iniciar.
2. Puedes leer el changelog directamente en el popup.
3. Haz clic en **Descargar e Instalar** para obtener y lanzar el nuevo instalador automáticamente.

También puedes buscar actualizaciones manualmente desde **Configuración**.

---

## Aviso Legal

Nipah! Anime es un **cliente de escritorio** — no aloja, almacena ni distribuye ningún contenido multimedia. Todo el contenido de anime y manga proviene de sitios web de terceros. La disponibilidad de las fuentes puede cambiar con el tiempo y está fuera del control de este proyecto.

Úsalo de forma responsable y de acuerdo con las leyes de tu país.

---

<div align="center">

Made with love for anime fans everywhere · Hecho con amor para fans del anime en todo el mundo

</div>
docs: update README with bilingual layout
