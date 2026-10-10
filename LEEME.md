# MSDatabase — Consulta EI-MS (tabla m/z)

`GET ms_api.php?nombre=<nombre en inglés | CAS | InChIKey>&max=1..5` → JSON
`index.html` — interfaz de consulta (una consulta a la vez).

Fuentes: MassBank Europe (espectros) y PubChem PUG REST (identificación del compuesto).

## Despliegue en el VPS de Hostinger con Dokploy (recomendado)

1. **Create Service → Application**, proveedor **GitHub**, repositorio `PGBeermann/MSDatabase`, rama `main`.
2. **Build Type: Dockerfile** (ruta `Dockerfile`, contexto `.`). No use Nixpacks: no detecta PHP sin `composer.json`/`index.php`.
3. **Domains**: dominio o subdominio → *Container Port* **80**, HTTPS activado (certificado Let's Encrypt).
   Antes, cree en el DNS un registro A del subdominio apuntando a la IP del VPS.
4. **Advanced → Volumes/Mounts** (opcional, conserva la caché entre despliegues):
   Volume Mount · nombre `msdatabase-cache` · Mount Path `/var/www/cache`.
5. **Environment** (opcional; los valores por defecto ya están en el Dockerfile):

       MS_CACHE_DIR=/var/www/cache
       MS_TRUST_PROXY=1
       MS_CORS_ORIGIN=            # solo si el HTML se sirve desde otro dominio

6. **Deploy**. Prueba:

       curl "https://su-subdominio/ms_api.php?nombre=benzoic%20acid&max=1"

El VPS debe tener salida HTTPS hacia `massbank.eu` y `pubchem.ncbi.nlm.nih.gov`
(compruebe con `curl -I https://massbank.eu/MassBank-api/version` desde el VPS).

## Instalación alternativa sin Docker (Apache o Nginx + PHP-FPM)

- PHP ≥ 7.4 con `curl` y `mbstring`: `apt install php-curl php-mbstring` y reinicie PHP-FPM/Apache.
- Copie `index.html` y `ms_api.php` a la carpeta pública.
- Cree la caché **fuera** de la raíz web y dele permisos:

      mkdir -p /var/www/msdatabase-cache && chown www-data: /var/www/msdatabase-cache && chmod 750 /var/www/msdatabase-cache

- Defina la variable de entorno para PHP-FPM (`/etc/php/8.x/fpm/pool.d/www.conf`):

      env[MS_CACHE_DIR] = /var/www/msdatabase-cache
      env[MS_TRUST_PROXY] = 0     ; 1 solo si hay un proxy inverso delante

## Parámetros fijos (al inicio de ms_api.php)
`CACHE_TTL` (30 días) · `LIMITE_MIN` (20 consultas/min por IP) · `MAX_ESPECTROS` (5) · `HTTP_TIMEOUT` (20 s).

## Respuesta
200: `consulta, metodo_busqueda, compuesto{…}, total_encontrados, devueltos,
espectros[{accession, titulo, instrumento, tipo_instrumento, energia_ionizacion, licencia, url,
num_picos, pico_base_mz, picos[{mz, intensidad, intensidad_relativa}]}], fuente, cita, fecha_consulta`
Errores 400 / 404 / 429 / 500 con el campo `error`.

## Notas
- Nombres en inglés (PubChem); el número CAS funciona en cualquier idioma.
- `intensidad_relativa` está en % respecto del pico base.
- Cada registro de MassBank trae su licencia (campo `licencia`); respétela al reutilizar datos.
