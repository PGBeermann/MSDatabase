# MSDatabase — Espectros EM, IR y RMN por nombre de compuesto

`GET ms_api.php?nombre=<nombre en inglés | CAS | InChIKey>&max=1..5&tipos=ms,ir,rmn` → JSON
`GET ms_api.php?smiles=<SMILES codificado en URL>&…` → JSON (búsqueda por estructura)
`index.html` — interfaz de consulta (una consulta a la vez), con editor de estructuras JSME y
pestañas EM / IR / RMN ¹H / RMN ¹³C.

### Búsqueda por estructura (JSME)
- El panel «Buscar por estructura» integra el editor JSME (Bienfait & Ertl, *J. Cheminform.* 2013, 5, 24;
  licencia BSD-3). Al dibujar, el SMILES se actualiza en el campo de texto; también puede pegarse un SMILES
  y pulsar «↑ Dibujar».
- El servidor envía el SMILES a PubChem como parámetro `?smiles=` (no en la ruta, porque `/`, `\` y `#`
  rompen la URL) y continúa con el InChIKey/CAS/InChI obtenidos, igual que en la búsqueda por nombre.
- Solo se encuentran espectros de compuestos **registrados en PubChem**; una estructura nueva devuelve 404.
  Se rechazan SMILES con varios fragmentos (`.`).
- JSME 2024.4.29 se instala con npm durante la construcción y se sirve en `/jsme/`; si falta, la página
  lo carga desde jsDelivr.

## Interpretación de los espectros (en el navegador)

Debajo de cada espectro aparece su interpretación, calculada en el navegador con **RDKit.js 2026.3.6**
sobre la estructura (molfile 2D de PubChem o SMILES dibujado en JSME):

| Técnica | Qué se obtiene | Fundamento |
|---|---|---|
| **EM** | Cada pico experimental intenso (≥ 5 %) se asocia con el ion de igual m/z generado por el **motor mecanístico de PGBeermann/masas** (copiado sin cambios en `vendor/eims-engine`, MIT): fórmula, tipo OE⁺•/EE⁺, ruta con flechas de 1 y 2 e⁻, ion y neutro dibujados. Los picos que el motor no explica se contrastan con tablas de pérdidas neutras desde M⁺• e iones característicos. Además: ion molecular, regla del N, IDH, n(C) por M+1, patrones de Cl/Br/S y coseno experimental vs. predicho. | McLafferty & Tureček 1993; Gross 2017; reglas del Predictor EI‑MS |
| **IR** | Grupos funcionales de la estructura (≈ 27 patrones SMARTS) con sus bandas diagnósticas: observada / no observada / fuera del intervalo; patrón de sustitución del benceno (γ C–H); asignación por región de las bandas restantes; ausencias significativas (sin C=O, sin O–H/N–H, sin C≡N/C≡C). Cada banda lleva su forma (aguda/ancha) por la anchura a media altura. | Silverstein 2014; Pavia 2015; Socrates 2001 |
| **RMN ¹H** | Entornos químicamente equivalentes (simetría topológica), δ estimados (CH₃ tabulados, regla de Shoolery para CH₂/CH, incrementos Z orto/meta/para en bencenos), multiplicidad n+1, agrupación de líneas en multipletes (< 20 Hz), integración relativa, H intercambiables en D₂O, efecto del pH (carboxilatos), señales de disolventes. | Silverstein 2014; Pretsch 2009; Fulmer 2010 |
| **RMN ¹³C** | Entornos de C, δ estimados (tablas por entorno e incrementos aromáticos ipso/orto/meta/para), tipo de C frente a la multiplicidad DEPT de NMRShiftDB, asignación de costo mínimo, disolvente. | Silverstein 2014; Pretsch 2009; Fulmer 2010 |

Las estimaciones son aditivas y orientativas (±0,2–0,4 ppm en ¹H, ±3–8 ppm en ¹³C); su propósito es
docente: proponer y justificar asignaciones, no sustituir el análisis del espectroscopista.

Pruebas: `npm test` (31 comprobaciones con ácido benzoico, acetofenona, acetato de etilo, etanol y
1‑bromobutano).

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

La primera construcción tarda unos minutos (descarga de RDKit.js, ≈ 7 MB de WebAssembly). El VPS debe tener salida HTTPS hacia `massbank.eu`, `pubchem.ncbi.nlm.nih.gov`,
`webbook.nist.gov` y `nmrshiftdb.nmr.uni-koeln.de`. Compruébelo desde el VPS:

    for h in massbank.eu pubchem.ncbi.nlm.nih.gov webbook.nist.gov nmrshiftdb.nmr.uni-koeln.de; do
      curl -s -o /dev/null -w "%{http_code} $h\n" https://$h/; done

## Instalación alternativa sin Docker (Apache o Nginx + PHP-FPM)

- PHP ≥ 7.4 con `curl`, `mbstring` y `dom`: `apt install php-curl php-mbstring php-xml` y reinicie PHP-FPM/Apache.
- Construya los recursos del navegador (Node ≥ 18): `npm ci && npm run build` → carpeta `build/`
  (`js/eims-engine.js`, `rdkit/`, `jsme/`).
- Copie a la carpeta pública: el contenido de `build/`, `index.html`, `ms_api.php` y la carpeta `js/`.
- Sirva los `.wasm` como `application/wasm` (Apache: `AddType application/wasm .wasm`).
- Cree la caché **fuera** de la raíz web y dele permisos:

      mkdir -p /var/www/msdatabase-cache && chown www-data: /var/www/msdatabase-cache && chmod 750 /var/www/msdatabase-cache

- Defina las variables de entorno para PHP-FPM (`/etc/php/8.x/fpm/pool.d/www.conf`):

      env[MS_CACHE_DIR] = /var/www/msdatabase-cache
      env[MS_TRUST_PROXY] = 0     ; 1 solo si hay un proxy inverso delante

## Parámetros fijos (al inicio de ms_api.php)
`CACHE_TTL` (30 días) · `LIMITE_MIN` (20 consultas/min por IP) · `MAX_ESPECTROS` (5 por técnica) ·
`HTTP_TIMEOUT` (20 s) · `NIST_IR_INDICES` (4) · `IR_MAX_PUNTOS` (1200) · `IR_MAX_BANDAS` (30).

## Respuesta (200)

    consulta, modo (nombre | smiles), tipos, compuesto {nombre, nombre_iupac, formula, masa_monoisotopica, inchikey, inchi, cas, pubchem_cid, molfile, smiles},
    devueltos {ms, ir, rmn_1H, rmn_13C},
    espectros [ {accession, titulo, instrumento, tipo_instrumento, energia_ionizacion, licencia, url,
                 num_picos, pico_base_mz, picos [ {mz, intensidad, intensidad_relativa} ] } ],
    ir        [ {id, titulo, estado, tecnica, instrumento, origen, propietario, url, url_jcamp, rango_cm1,
                 y_unidad, num_puntos_original,
                 bandas [ {numero_onda, intensidad_relativa, clase: f|m|d, ancho, forma} ],
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
