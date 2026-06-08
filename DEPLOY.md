# Lyjob Backend — Deploy en cPanel

## PASO 1: Base de datos MySQL

En cPanel → MySQL Databases:
1. Crear BD: `lyjob_db` → quedará como `tuusuario_lyjob_db`
2. Crear usuario: `lyjob_user` → quedará como `tuusuario_lyjob_user`
3. Asignar usuario a BD con ALL PRIVILEGES

## PASO 2: Subir el backend

1. Subir `lyjob-backend.zip` a la carpeta de tu dominio API
   (Ej: `api.lyjob.com` apuntando a `/home/tuusuario/api_lyjob/`)
2. Extraer el ZIP en esa carpeta

## PASO 3: Configurar .env

Editar el archivo `.env` con tus datos reales:
```
DB_NAME=tuusuario_lyjob_db
DB_USER=tuusuario_lyjob_user
DB_PASSWORD=tu_password_mysql
JWT_SECRET=genera_uno_en_https://randomkeygen.com (usa "504-bit WPA Key")
SMTP_HOST=mail.lyjob.com
SMTP_USER=no-reply@lyjob.com
SMTP_PASS=tu_password_de_correo
PAYPHONE_TOKEN=tu_token_payphone
PAYPHONE_STORE_ID=tu_store_id
```

## PASO 4: Node.js en cPanel

En cPanel → Setup Node.js App:
1. Crear nueva aplicación
2. Node.js version: 18 (o la más alta disponible)
3. Application mode: Production
4. Application root: /home/tuusuario/api_lyjob
5. Application URL: api.lyjob.com
6. Application startup file: app.js
7. Click "Create"

## PASO 5: Instalar dependencias y migrar BD

En la terminal de la app (botón "Run NPM Install" en cPanel):
```bash
npm install
node src/db/migrate.js
```

## PASO 6: Iniciar la app

En cPanel → Setup Node.js App → Click "Start App"

## PASO 7: Subir el frontend

1. Subir `lyjob-frontend.zip` a `public_html` de `lyjob.com`
2. Extraer y mover contenido de `dist/` al raíz de `public_html`

## Verificar que funciona

Abre: https://api.lyjob.com/health
Debe responder: `{"status":"ok","timestamp":"...","version":"1.0.0"}`
