# AFMS Desktop

Windows app for the Faculty of Technology academic platform at the University of El Oued.

Opens **https://ft-edugate.univ-eloued.dz/** in a native window. Login, cookies, and downloads stay in the app.

## Download

Get the latest build from the public [Releases](https://github.com/mfu-service/afms-desktop/releases/latest) page. Anyone with the link can download it.

| File | Use |
| --- | --- |
| [AFMS-Setup-1.1.0.exe](https://github.com/mfu-service/afms-desktop/releases/download/v1.1.0/AFMS-Setup-1.1.0.exe) | Installer (Start Menu + desktop shortcut) |
| [AFMS-Portable-1.1.0.exe](https://github.com/mfu-service/afms-desktop/releases/download/v1.1.0/AFMS-Portable-1.1.0.exe) | Run without installing |

Windows may show an unknown-publisher warning. Choose **More info** → **Run anyway** if you trust this university build.

## Run from source

```bash
npm install
npm start
```

Build Windows packages:

```bash
npm run dist
```
