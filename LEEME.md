# Consulta EI-MS (tabla m/z) — instalación

## Archivos
- `ms_api.php` — servicio: `GET ms_api.php?nombre=<nombre|CAS|InChIKey>&max=1..5` → JSON
- `index.html` — interfaz de consulta (una consulta a la vez)

## Instalación en el VPS (Hostinger)
1. Copie ambos archivos a una carpeta del sitio, p. ej. `/var/www/html/eims-ms/`.
2. Verifique que PHP tenga cURL: `php -m | grep curl` (si falta: `apt install php-curl` y reinicie PHP-FPM/Apache).
3. Dé permiso de escritura al usuario del servidor web: `chown www-data: /var/www/html/eims-ms`.
   El script crea `cache/` (con `.htaccess` que bloquea el acceso en Apache).
   **En Nginx**, añada: `location ^~ /eims-ms/cache/ { deny all; }`
4. Abra `https://su-dominio/eims-ms/index.html`.

## Ajustes (constantes al inicio de ms_api.php)
- `CACHE_TTL` (30 días), `LIMITE_MIN` (20 consultas/min por IP), `MAX_ESPECTROS` (5).
- `CORS_ORIGIN` si el HTML se sirve desde otro dominio.

## Prueba rápida
    curl "https://su-dominio/eims-ms/ms_api.php?nombre=benzoic%20acid&max=1"

## Estructura del JSON (200)
    consulta, metodo_busqueda (inchikey | nombre_massbank),
    compuesto {nombre, nombre_iupac, formula, masa_monoisotopica, inchikey, pubchem_cid},
    total_encontrados, devueltos,
    espectros [ {accession, titulo, instrumento, tipo_instrumento, energia_ionizacion,
                 licencia, url, num_picos, pico_base_mz,
                 picos [ {mz, intensidad, intensidad_relativa} ] } ],
    fuente, cita, fecha_consulta
Errores: 400 (parámetro), 404 (sin compuesto/espectros), 429 (límite), con campo `error`.

## Notas
- Los nombres deben ir en inglés (PubChem); también sirven el número CAS y el InChIKey.
- `intensidad_relativa` se recalcula en % respecto del pico base (100).
- Cada registro de MassBank trae su propia licencia (campo `licencia`); respétela al reutilizar datos.
