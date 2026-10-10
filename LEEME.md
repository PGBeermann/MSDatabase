# MSDatabase — Espectros EM, IR y RMN por nombre de compuesto

`GET ms_api.php?nombre=<nombre en inglés | CAS | InChIKey>&max=1..5&tipos=ms,ir,rmn` → JSON
`index.html` — interfaz de consulta (una consulta a la vez), con pestañas EM / IR / RMN ¹H / RMN ¹³C.

| Técnica | Fuente | Acceso | Datos que se devuelven |
|---|---|---|---|
| Identificación | PubChem PUG REST | API pública | CID, InChI, InChIKey, fórmula, masa, CAS |
| EM (EI) | MassBank Europe | API REST MassBank3 | tabla m/z – intensidad |
| IR | NIST Chemistry WebBook (SRD 69, colección Coblentz) | JCAMP-DX por CAS | curva (cm⁻¹ vs %T o A) y bandas detectadas |
| RMN ¹H/¹³C | PubChem PUG-View (datos de HMDB) | API pública | δ (ppm) – intensidad, frecuencia, disolvente |
| RMN ¹H/¹³C | NMRShiftDB2 | interfaz de automatización (CML por InChI) | δ (ppm), multiplicidad, asignación |

Cada fuente se consulta en paralelo; si una falla, las demás se devuelven igual y el motivo
aparece en `avisos`.

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
       MS_NMRSHIFTDB=1            # 0 desactiva la consulta a NMRShiftDB2

6. **Deploy**. Pruebas:

       curl "https://su-subdominio/ms_api.php?nombre=benzoic%20acid&max=1"
       curl "https://su-subdominio/ms_api.php?nombre=65-85-0&tipos=ir"

El VPS debe tener salida HTTPS hacia `massbank.eu`, `pubchem.ncbi.nlm.nih.gov`,
`webbook.nist.gov` y `nmrshiftdb.nmr.uni-koeln.de`. Compruébelo desde el VPS:

    for h in massbank.eu pubchem.ncbi.nlm.nih.gov webbook.nist.gov nmrshiftdb.nmr.uni-koeln.de; do
      curl -s -o /dev/null -w "%{http_code} $h\n" https://$h/; done

## Instalación alternativa sin Docker (Apache o Nginx + PHP-FPM)

- PHP ≥ 7.4 con `curl`, `mbstring` y `dom`: `apt install php-curl php-mbstring php-xml` y reinicie PHP-FPM/Apache.
- Copie `index.html` y `ms_api.php` a la carpeta pública.
- Cree la caché **fuera** de la raíz web y dele permisos:

      mkdir -p /var/www/msdatabase-cache && chown www-data: /var/www/msdatabase-cache && chmod 750 /var/www/msdatabase-cache

- Defina las variables de entorno para PHP-FPM (`/etc/php/8.x/fpm/pool.d/www.conf`):

      env[MS_CACHE_DIR] = /var/www/msdatabase-cache
      env[MS_TRUST_PROXY] = 0     ; 1 solo si hay un proxy inverso delante

## Parámetros fijos (al inicio de ms_api.php)
`CACHE_TTL` (30 días) · `LIMITE_MIN` (20 consultas/min por IP) · `MAX_ESPECTROS` (5 por técnica) ·
`HTTP_TIMEOUT` (20 s) · `NIST_IR_INDICES` (4) · `IR_MAX_PUNTOS` (1200) · `IR_MAX_BANDAS` (30).

## Respuesta (200)

    consulta, tipos, compuesto {nombre, nombre_iupac, formula, masa_monoisotopica, inchikey, inchi, cas, pubchem_cid},
    devueltos {ms, ir, rmn_1H, rmn_13C},
    espectros [ {accession, titulo, instrumento, tipo_instrumento, energia_ionizacion, licencia, url,
                 num_picos, pico_base_mz, picos [ {mz, intensidad, intensidad_relativa} ] } ],
    ir        [ {id, titulo, estado, tecnica, instrumento, origen, propietario, url, url_jcamp, rango_cm1,
                 y_unidad, num_puntos_original,
                 bandas [ {numero_onda, intensidad_relativa, clase: f|m|d} ],
                 curva {x: [cm⁻¹], y: [%T o A]} } ],
    rmn { "1H":  [ {id, nucleo, frecuencia, disolvente, ph, temperatura, instrumento, fuente, licencia, url,
                    num_picos, picos [ {ppm, intensidad, intensidad_relativa, multiplicidad?, atomos?} ] } ],
          "13C": [ … ],
          enlaces [ {nucleo, fuente, url, nota} ] },      // espectros solo-imagen (p. ej. SpectraBase)
    avisos [ … ], fuentes {ms, ir, rmn}, fecha_consulta

Errores 400 / 404 / 429 / 500 con el campo `error` (y `avisos` en el 404).

## Notas científicas y de uso
- Nombres en inglés (PubChem); el número CAS funciona en cualquier idioma.
- **EM**: `intensidad_relativa` en % del pico base.
- **IR**: la curva se submuestrea conservando los mínimos de transmitancia. Las bandas se detectan
  automáticamente sobre la absorbancia (A = −log T) por prominencia topográfica (≥ 5 % del intervalo);
  son orientativas y deben contrastarse con el espectro original (`url_jcamp`).
- **RMN (PubChem/HMDB)**: listas de picos experimentales tal como fueron depositadas; muchos espectros
  de HMDB están medidos en D₂O/agua a pH fisiológico, lo que desplaza las señales lábiles (OH, NH, COOH).
- **RMN (NMRShiftDB2)**: desplazamientos asignados, normalmente sin intensidades; en ¹³C la multiplicidad
  S, D, T, Q corresponde a C, CH, CH₂, CH₃.
- Cite las fuentes (campo `fuentes`) y respete la licencia de cada registro (`licencia`).
  Los espectros IR del NIST WebBook están protegidos (© U.S. Secretary of Commerce); úselos con fines
  académicos, con cita, y no los redistribuya masivamente.
- SDBS (AIST) no se consulta de forma automática: sus condiciones de uso lo prohíben.
