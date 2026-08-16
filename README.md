# Control de Asistencia v2

Aplicación web **PWA instalable** (móvil + escritorio) para el registro de personal: **entradas, salidas y ausencias** con fecha y hora exacta.

El marcado se hace desde la página tocando la **foto de perfil** del usuario y escribiendo su **clave asignada**. Cada usuario puede poner su propia foto de perfil (con su clave), y el administrador puede personalizar la app, gestionar usuarios e historial, y exportar a CSV.

## Características

- **Marcado por foto + clave**: se toca la foto en la pantalla principal y se ingresa la clave personal.
- **Registros**: entrada, salida y ausencia, con fecha y hora exactas y nota opcional.
- **Foto de perfil**: cada usuario sube su propia foto (autenticado con su clave).
- **Recuperación de clave** por **email** (SMTP) o **WhatsApp** (enlace `wa.me`). Sin SMTP configurado, el código se muestra en pantalla (modo local).
- **Panel de administración**:
  - Resumen del día (presentes, ausencias, sin marcar, entradas por hora).
  - Crear, editar, eliminar usuarios y **asignar administradores**.
  - Editar y eliminar registros del historial con filtros por fecha/usuario/tipo.
  - **Exportar historial a CSV**.
  - Personalizar: **logo**, **fondo/marca**, **nombre**, **tema claro/oscuro** por defecto y color de acento.
- **Modo día / noche** por usuario (y tema por defecto configurable por el admin).
- **PWA instalable**: botón "Instalar app" (Android/Chrome) o menú Compartir en iOS.

## Requisitos

- **Node.js 22.13 o superior** (usa el módulo nativo `node:sqlite`; no requiere compilar dependencias).

## Puesta en marcha

```bash
npm install
npm start
```

Abre `http://localhost:3000`

- **Primer acceso**: crea usuarios desde el **Panel admin**.
- **Administrador inicial**: tarjeta "Administrador", clave `1234` (cámbiala pronto).
- El administrador también marca asistencia con su foto + clave como cualquier usuario.

Para desarrollo con recarga automática:

```bash
npm run dev
```

## Configuración (opcional)

Copia `.env.example` a `.env`:

| Variable       | Descripción                                               |
|----------------|-----------------------------------------------------------|
| `PORT`         | Puerto del servidor (3000)                                |
| `APP_NAME`     | Nombre de la aplicación                                   |
| `ADMIN_PIN`    | Clave del administrador inicial (1234)                    |
| `ADMIN_EMAIL`  | Email del administrador inicial                           |
| `ADMIN_PHONE`  | Teléfono (WhatsApp) del administrador inicial             |
| `SMTP_*`       | Servidor SMTP para el envío del código por email          |

**WhatsApp**: no requiere configuración; al pedir recuperación la app genera un enlace `wa.me` con el código.

## PWA / Instalación móvil

- **Android / Chrome**: pulsa "Instalar app" en el encabezado.
- **iOS**: menú Compartir → "Añadir a pantalla de inicio".
- La app funciona offline para la interfaz (los datos se sincronizan al volver a estar en línea).
- Para producción, el PWA debe servirse por **HTTPS**.

## Estructura

```
server.js           # Servidor Express + manifest dinámico
db.js               # Base de datos SQLite nativa (node:sqlite)
routes/             # API (auth, attendance, users, settings)
public/             # Frontend + PWA (index.html, sw.js, icons)
scripts/            # Generador de iconos PWA
```

## Regenerar iconos PWA

```bash
npm run icons
```

## API (resumen)

| Método | Ruta                        | Descripción                              |
|--------|-----------------------------|------------------------------------------|
| POST   | `/api/auth/login`           | Validar clave (userId + pin) → token     |
| POST   | `/api/attendance/mark`      | Registrar entrada/salida/ausencia        |
| POST   | `/api/auth/recover`         | Pedir código de recuperación             |
| POST   | `/api/auth/reset-pin`       | Restablecer clave con el código          |
| GET    | `/api/attendance/history`   | Historial (admin)                        |
| GET    | `/api/attendance/export`    | Descargar CSV (admin)                    |
| GET    | `/api/users`                | Lista de usuarios (admin)                |
| PUT    | `/api/settings`             | Guardar configuración de la app (admin)  |
