<?php
/**
 * ms_api.php — Espectros de un compuesto orgánico por nombre: EM (EI), IR y RMN (1H, 13C).
 *
 * Flujo:
 *   1. PubChem PUG REST resuelve el identificador (nombre en inglés, CAS o InChIKey)
 *      → CID, InChI, InChIKey, fórmula, masa monoisotópica y número CAS.
 *   2. En paralelo:
 *        EM  · MassBank (API MassBank3): registros EI con ms_type = MS para el InChIKey.
 *        IR  · NIST Chemistry WebBook: espectros IR (colección Coblentz) en JCAMP-DX, por CAS.
 *        RMN · PubChem PUG-View: listas de desplazamientos experimentales (HMDB) 1H y 13C.
 *            · NMRShiftDB2: espectros experimentales por InChI (interfaz de automatización).
 *   3. Devuelve todo normalizado en JSON. Un fallo en una fuente no anula las demás.
 *
 * Uso:   GET ms_api.php?nombre=benzoic%20acid[&max=3][&tipos=ms,ir,rmn]
 *        GET ms_api.php?nombre=65-85-0
 *        GET ms_api.php?nombre=WPYMKLBDIGXBTP-UHFFFAOYSA-N
 *        GET ms_api.php?smiles=OC(%3DO)c1ccccc1      (estructura dibujada en JSME)
 *
 * Requisitos: PHP >= 7.4 con cURL, mbstring y DOM. Caché escribible (MS_CACHE_DIR).
 *
 * Fuentes y referencias:
 *   - MassBank Europe, https://massbank.eu — Horai et al., J. Mass Spectrom. 2010, 45, 703.
 *   - NIST Chemistry WebBook, SRD 69, https://webbook.nist.gov — Linstrom & Mallard (eds.).
 *   - PubChem, https://pubchem.ncbi.nlm.nih.gov — Kim et al., Nucleic Acids Res. 2025, 53, D1516.
 *   - HMDB, https://hmdb.ca — Wishart et al., Nucleic Acids Res. 2022, 50, D622.
 *   - NMRShiftDB2, https://nmrshiftdb.nmr.uni-koeln.de — Steinbeck & Kuhn, Phytochemistry 2004, 65, 2711.
 *
 * Nota: SDBS (AIST) no se consulta de forma programada porque sus condiciones de uso
 * prohíben la recolección automática ("Automatically collect data by robots ... are
 * prohibited", https://sdbs.db.aist.go.jp/Htmls/disclaimer_eng.html).
 */

declare(strict_types=1);

// ------------------------------------------------------------------ Configuración
const MASSBANK_WEB   = 'https://massbank.eu/MassBank/RecordDisplay?id=';
const EI_TYPES       = 'EI-B,EI-EBEB,EI-TOF,EI-QTOF,GC-EI-B,GC-EI-BE,GC-EI-FT,GC-EI-Q,GC-EI-QQ,GC-EI-QTOF,GC-EI-TOF';
const MAX_ESPECTROS  = 5;            // tope de espectros por técnica
const NIST_IR_INDICES = 4;           // índices de espectros IR que se intentan en NIST (0..n-1)
const IR_MAX_PUNTOS  = 1200;         // puntos de la curva IR devueltos (submuestreo)
const IR_MAX_BANDAS  = 30;
const CACHE_TTL      = 2592000;      // 30 días
const LIMITE_MIN     = 20;           // consultas por minuto y por IP
const HTTP_TIMEOUT   = 20;           // segundos por petición (las peticiones van en paralelo)

// Ajustables por variables de entorno (Dokploy → Environment):
//   MS_CACHE_DIR    Carpeta de caché FUERA de la raíz web (en Docker: /var/www/cache).
//   MS_TRUST_PROXY  1 = detrás de Traefik/Nginx; usa X-Forwarded-For para la IP real.
//   MS_CORS_ORIGIN  p. ej. https://midominio.com ; vacío = solo mismo origen.
//   MS_NMRSHIFTDB   0 = desactiva la consulta a NMRShiftDB2.
define('CACHE_DIR',   rtrim(getenv('MS_CACHE_DIR') ?: __DIR__ . '/cache', '/'));
define('TRUST_PROXY', getenv('MS_TRUST_PROXY') === '1');
define('CORS_ORIGIN', (string) (getenv('MS_CORS_ORIGIN') ?: ''));
define('USAR_NMRSHIFTDB', getenv('MS_NMRSHIFTDB') !== '0');

// Bases de las API (redirigibles por variables de entorno para pruebas).
define('MB_API',   getenv('MS_MASSBANK_API')   ?: 'https://massbank.eu/MassBank-api');
define('PC_API',   getenv('MS_PUBCHEM_API')    ?: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug');
define('PCV_API',  getenv('MS_PUBCHEM_VIEW')   ?: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view');
define('NIST_WEB', getenv('MS_NIST_WEBBOOK')   ?: 'https://webbook.nist.gov/cgi/cbook.cgi');
define('NSDB_WEB', getenv('MS_NMRSHIFTDB_URL') ?: 'https://nmrshiftdb.nmr.uni-koeln.de');

// ------------------------------------------------------------------ Cabeceras
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if (CORS_ORIGIN !== '') {
    header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    responder(405, ['error' => 'Método no permitido. Use GET.']);
}

// ================================================================== Utilidades
function responder(int $codigo, array $datos): void
{
    http_response_code($codigo);
    echo json_encode(
        $datos,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function asegurarCache(): void
{
    if (!is_dir(CACHE_DIR) && !@mkdir(CACHE_DIR, 0750, true)) {
        responder(500, ['error' => 'No se pudo crear el directorio de caché.']);
    }
    if (!is_writable(CACHE_DIR)) {
        responder(500, ['error' => 'El directorio de caché no tiene permiso de escritura.']);
    }
    $ht = CACHE_DIR . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "Require all denied\n");
    }
    // Limpieza ocasional (≈1 % de las peticiones) de archivos vencidos.
    if (mt_rand(1, 100) === 1) {
        $archivos = array_merge(glob(CACHE_DIR . '/h_*.json') ?: [], glob(CACHE_DIR . '/rl_*.json') ?: []);
        foreach ($archivos as $f) {
            $limite = strpos(basename($f), 'rl_') === 0 ? 120 : CACHE_TTL;
            if (filemtime($f) < time() - $limite) {
                @unlink($f);
            }
        }
    }
}

/** IP del cliente; detrás de un proxy inverso confiable usa X-Forwarded-For. */
function ipCliente(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'cli';
    if (TRUST_PROXY && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $primera = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($primera, FILTER_VALIDATE_IP)) {
            $ip = $primera;
        }
    }
    return $ip;
}

/** Límite simple de frecuencia por IP (ventana de 60 s). */
function limitarFrecuencia(): void
{
    $file = CACHE_DIR . '/rl_' . sha1(ipCliente()) . '.json';
    $now  = time();
    $fh   = @fopen($file, 'c+');
    if (!$fh) {
        return;
    }
    flock($fh, LOCK_EX);
    $marcas = json_decode((string) stream_get_contents($fh), true) ?: [];
    $marcas = array_values(array_filter($marcas, fn($t) => $t > $now - 60));
    if (count($marcas) >= LIMITE_MIN) {
        flock($fh, LOCK_UN);
        fclose($fh);
        header('Retry-After: 60');
        responder(429, ['error' => 'Demasiadas consultas. Espere un minuto.']);
    }
    $marcas[] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($marcas));
    flock($fh, LOCK_UN);
    fclose($fh);
}

function rutaCache(string $url): string
{
    return CACHE_DIR . '/h_' . sha1($url) . '.json';
}

/**
 * GET HTTP en paralelo (curl_multi) con caché en disco.
 * Devuelve [url => [codigo, cuerpo]]. Se cachean solo respuestas 200 y 404.
 */
function httpGetMany(array $urls): array
{
    $out = [];
    $pend = [];
    foreach (array_unique($urls) as $url) {
        $cf = rutaCache($url);
        if (is_file($cf) && filemtime($cf) > time() - CACHE_TTL) {
            $c = json_decode((string) file_get_contents($cf), true);
            if (is_array($c)) {
                $out[$url] = [(int) $c['code'], (string) $c['body']];
                continue;
            }
        }
        $pend[] = $url;
    }
    if (!$pend) {
        return $out;
    }
    $mh = curl_multi_init();
    $handles = [];
    foreach ($pend as $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => HTTP_TIMEOUT,
            CURLOPT_ENCODING       => '',
            CURLOPT_HTTPHEADER     => ['Accept: application/json, text/plain, */*'],
            CURLOPT_USERAGENT      => 'MSDatabase/2.0 (uso academico; UNACHI, Panama)',
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS | CURLPROTO_HTTP,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$url] = $ch;
    }
    do {
        $st = curl_multi_exec($mh, $activos);
        if ($activos) {
            curl_multi_select($mh, 1.0);
        }
    } while ($activos && $st === CURLM_OK);

    foreach ($handles as $url => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
        $body = $body === null ? '' : (string) $body;
        if ($code === 200 || $code === 404) {
            @file_put_contents(rutaCache($url), json_encode(['code' => $code, 'body' => $body], JSON_INVALID_UTF8_SUBSTITUTE), LOCK_EX);
        }
        $out[$url] = [$code, $body];
    }
    curl_multi_close($mh);
    return $out;
}

function httpGet(string $url): array
{
    return httpGetMany([$url])[$url];
}

function jsonDe(array $resp): ?array
{
    if ($resp[0] !== 200) {
        return null;
    }
    $d = json_decode($resp[1], true);
    return is_array($d) ? $d : null;
}

// ================================================================== 1. Compuesto (PubChem)
function casValido(string $cas): bool
{
    if (!preg_match('/^(\d{2,7})-(\d{2})-(\d)$/', $cas, $m)) {
        return false;
    }
    $digitos = strrev($m[1] . $m[2]);
    $suma = 0;
    for ($i = 0; $i < strlen($digitos); $i++) {
        $suma += ($i + 1) * (int) $digitos[$i];
    }
    return $suma % 10 === (int) $m[3];
}

/**
 * Resuelve el compuesto en PubChem. $modo: 'nombre' (nombre, CAS o InChIKey) o 'smiles'.
 * El SMILES va como parámetro de consulta (?smiles=), no en la ruta, porque puede contener
 * "/", "\" o "#", que rompen la sintaxis de la URL de PUG REST.
 */
function resolverCompuesto(string $q, string $modo = 'nombre'): ?array
{
    $props = '/property/InChI,InChIKey,MolecularFormula,MonoisotopicMass,IUPACName,Title/JSON';
    $esInchiKey = $modo === 'nombre' && (bool) preg_match('/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/', $q);
    if ($modo === 'smiles') {
        $url = PC_API . '/compound/smiles' . $props . '?smiles=' . rawurlencode($q);
    } else {
        $ruta = $esInchiKey ? '/compound/inchikey/' . rawurlencode($q) : '/compound/name/' . rawurlencode($q);
        $url = PC_API . $ruta . $props;
    }
    $p = jsonDe(httpGet($url))['PropertyTable']['Properties'][0] ?? null;
    if ($p !== null && empty($p['CID'])) {
        $p = null;   // PubChem responde CID 0 cuando la estructura no está registrada
    }

    if ($p === null) {
        return $esInchiKey ? ['nombre' => null, 'nombre_iupac' => null, 'formula' => null,
            'masa_monoisotopica' => null, 'inchikey' => $q, 'inchi' => null, 'cas' => null, 'pubchem_cid' => null] : null;
    }
    $c = [
        'nombre'             => $p['Title'] ?? ($p['IUPACName'] ?? $q),
        'nombre_iupac'       => $p['IUPACName'] ?? null,
        'formula'            => $p['MolecularFormula'] ?? null,
        'masa_monoisotopica' => isset($p['MonoisotopicMass']) ? round((float) $p['MonoisotopicMass'], 5) : null,
        'inchikey'           => $p['InChIKey'] ?? null,
        'inchi'              => $p['InChI'] ?? null,
        'cas'                => casValido($q) ? $q : null,
        'pubchem_cid'        => isset($p['CID']) ? (int) $p['CID'] : null,
    ];
    return $c;
}

/** CAS a partir de los sinónimos de PubChem (primer número con dígito de control válido). */
function casDeSinonimos(?array $d): ?string
{
    foreach ($d['InformationList']['Information'][0]['Synonym'] ?? [] as $s) {
        $s = trim((string) $s);
        if (casValido($s)) {
            return $s;
        }
    }
    return null;
}

// ================================================================== 2a. EM (MassBank)
function urlBusquedaMassBank(array $params): string
{
    $params['instrument_type'] = EI_TYPES;
    $params['ms_type']         = 'MS';
    return MB_API . '/records/search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function accesionesDe(?array $d): array
{
    $out = [];
    foreach ($d['data'] ?? [] as $r) {
        if (!empty($r['accession'])) {
            $out[] = ['accession' => (string) $r['accession'], 'atomcount' => (int) ($r['atomcount'] ?? 0)];
        }
    }
    return $out;
}

function subtag(array $rec, string $nombre): ?string
{
    foreach ($rec['acquisition']['mass_spectrometry']['subtags'] ?? [] as $s) {
        if (($s['subtag'] ?? '') === $nombre) {
            return (string) $s['value'];
        }
    }
    return null;
}

function normalizarRegistroMB(array $rec): ?array
{
    $vals = $rec['peak']['peak']['values'] ?? [];
    $max = 0.0;
    foreach ($vals as $v) {
        $max = max($max, (float) ($v['intensity'] ?? 0));
    }
    if (!$vals || $max <= 0) {
        return null;
    }
    $picos = [];
    foreach ($vals as $v) {
        $i = (float) ($v['intensity'] ?? 0);
        $picos[] = ['mz' => (float) $v['mz'], 'intensidad' => $i, 'intensidad_relativa' => round($i / $max * 100, 1)];
    }
    usort($picos, fn($a, $b) => $a['mz'] <=> $b['mz']);
    $base = array_reduce($picos, fn($c, $p) => ($c === null || $p['intensidad'] > $c['intensidad']) ? $p : $c);
    $acc = (string) $rec['accession'];
    return [
        'accession'          => $acc,
        'titulo'             => $rec['title'] ?? null,
        'nombres_registro'   => $rec['compound']['names'] ?? [],
        'formula_registro'   => $rec['compound']['formula'] ?? null,
        'instrumento'        => $rec['acquisition']['instrument'] ?? null,
        'tipo_instrumento'   => $rec['acquisition']['instrument_type'] ?? null,
        'tipo_ms'            => $rec['acquisition']['mass_spectrometry']['ms_type'] ?? null,
        'modo_ion'           => $rec['acquisition']['mass_spectrometry']['ion_mode'] ?? null,
        'energia_ionizacion' => subtag($rec, 'IONIZATION_ENERGY'),
        'splash'             => $rec['peak']['splash'] ?? null,
        'licencia'           => $rec['license'] ?? null,
        'fuente'             => 'MassBank',
        'url'                => MASSBANK_WEB . rawurlencode($acc),
        'num_picos'          => count($picos),
        'pico_base_mz'       => $base['mz'],
        'picos'              => $picos,
    ];
}

function espectrosMasas(?array $comp, string $q, int $max, array &$avisos, bool $porNombre = true): array
{
    $verificarNombre = false;
    $cand = [];
    if ($comp && !empty($comp['inchikey'])) {
        $cand = accesionesDe(jsonDe(httpGet(urlBusquedaMassBank(['inchi_key' => $comp['inchikey']]))));
    }
    if (!$cand && $porNombre) {
        // Respaldo: búsqueda por nombre (subcadena) con verificación de nombre exacto.
        $cand = accesionesDe(jsonDe(httpGet(urlBusquedaMassBank(['compound_name' => $q]))));
        usort($cand, fn($a, $b) => $a['atomcount'] <=> $b['atomcount']);
        $cand = array_slice($cand, 0, 25);
        $verificarNombre = true;
    }
    if (!$cand) {
        $avisos[] = 'EM: MassBank no tiene espectros EI para este compuesto.';
        return [];
    }
    $urls = array_map(fn($c) => MB_API . '/records/' . rawurlencode($c['accession']), $cand);
    $resp = httpGetMany(array_slice($urls, 0, $verificarNombre ? 25 : $max + 3));
    $qMin = mb_strtolower($q);
    $esp = [];
    foreach ($resp as $r) {
        $rec = jsonDe($r);
        if (!$rec || ($rec['acquisition']['mass_spectrometry']['ms_type'] ?? 'MS') !== 'MS') {
            continue;
        }
        if ($verificarNombre && !in_array($qMin, array_map('mb_strtolower', $rec['compound']['names'] ?? []), true)) {
            continue;
        }
        if ($n = normalizarRegistroMB($rec)) {
            $esp[] = $n;
        }
    }
    // Primero EI clásico (sin GC), luego mayor número de picos.
    usort($esp, function ($a, $b) {
        $pa = strpos((string) $a['tipo_instrumento'], 'GC-') === 0 ? 1 : 0;
        $pb = strpos((string) $b['tipo_instrumento'], 'GC-') === 0 ? 1 : 0;
        return [$pa, $b['num_picos']] <=> [$pb, $a['num_picos']];
    });
    if (!$esp) {
        $avisos[] = 'EM: no se encontraron espectros EI con coincidencia exacta del compuesto.';
    }
    return array_slice($esp, 0, $max);
}

// ================================================================== 2b. IR (NIST, JCAMP-DX)
/**
 * Decodifica una línea de datos JCAMP-DX (AFFN y ASDF: SQZ, DIF, DUP).
 * Devuelve [valores, terminaEnDif]. El primer valor es la abscisa.
 */
function decodificarLineaJcamp(string $linea): array
{
    $sqz = ['@' => 0, 'A' => 1, 'B' => 2, 'C' => 3, 'D' => 4, 'E' => 5, 'F' => 6, 'G' => 7, 'H' => 8, 'I' => 9,
            'a' => -1, 'b' => -2, 'c' => -3, 'd' => -4, 'e' => -5, 'f' => -6, 'g' => -7, 'h' => -8, 'i' => -9];
    $dif = ['%' => 0, 'J' => 1, 'K' => 2, 'L' => 3, 'M' => 4, 'N' => 5, 'O' => 6, 'P' => 7, 'Q' => 8, 'R' => 9,
            'j' => -1, 'k' => -2, 'l' => -3, 'm' => -4, 'n' => -5, 'o' => -6, 'p' => -7, 'q' => -8, 'r' => -9];
    $dup = ['S' => 1, 'T' => 2, 'U' => 3, 'V' => 4, 'W' => 5, 'X' => 6, 'Y' => 7, 'Z' => 8, 's' => 9];

    $linea = preg_replace('/\$\$.*$/', '', $linea);       // comentarios
    // Tokens: [tipo, texto]; tipos: abs (AFFN/SQZ), dif, dup.
    $tokens = [];
    $n = strlen($linea);
    $i = 0;
    while ($i < $n) {
        $ch = $linea[$i];
        if ($ch === ' ' || $ch === ',' || $ch === "\t" || $ch === ';') {
            $i++;
            continue;
        }
        if (isset($sqz[$ch]) || isset($dif[$ch]) || isset($dup[$ch])) {
            $j = $i + 1;
            while ($j < $n && (ctype_digit($linea[$j]) || $linea[$j] === '.')) {
                $j++;
            }
            $tipo = isset($sqz[$ch]) ? 'abs' : (isset($dif[$ch]) ? 'dif' : 'dup');
            $mapa = $tipo === 'abs' ? $sqz : ($tipo === 'dif' ? $dif : $dup);
            $d = $mapa[$ch];
            $resto = substr($linea, $i + 1, $j - $i - 1);
            $signo = $d < 0 ? '-' : '';
            $tokens[] = [$tipo, $signo . abs($d) . $resto];
            $i = $j;
            continue;
        }
        if ($ch === '+' || $ch === '-' || $ch === '.' || ctype_digit($ch)) {
            $j = $i + 1;
            while ($j < $n && (ctype_digit($linea[$j]) || $linea[$j] === '.'
                || (($linea[$j] === 'E' || $linea[$j] === 'e') && $j + 1 < $n && preg_match('/[0-9+\-]/', $linea[$j + 1]))
                || (($linea[$j] === '+' || $linea[$j] === '-') && ($linea[$j - 1] === 'E' || $linea[$j - 1] === 'e')))) {
                $j++;
            }
            $tokens[] = ['abs', substr($linea, $i, $j - $i)];
            $i = $j;
            continue;
        }
        $i++;   // carácter desconocido: se ignora
    }

    $vals = [];
    $ultimoTipo = null;
    $ultimoDif = 0.0;
    foreach ($tokens as [$tipo, $txt]) {
        if ($tipo === 'abs') {
            $vals[] = (float) $txt;
            $ultimoTipo = 'abs';
        } elseif ($tipo === 'dif') {
            $ultimoDif = (float) $txt;
            $vals[] = (count($vals) ? end($vals) : 0.0) + $ultimoDif;
            $ultimoTipo = 'dif';
        } else { // dup: repite la última operación (valor o diferencia) n-1 veces
            $veces = (int) $txt - 1;
            for ($k = 0; $k < $veces && $vals; $k++) {
                $vals[] = $ultimoTipo === 'dif' ? end($vals) + $ultimoDif : end($vals);
            }
        }
    }
    return [$vals, $ultimoTipo === 'dif'];
}

/** Interpreta un archivo JCAMP-DX de IR. Devuelve null si no es un JCAMP válido. */
function parsearJcampIR(string $txt): ?array
{
    if (strpos($txt, '##') === false || !preg_match('/##\s*(XYDATA|PEAK\s*TABLE|XYPOINTS)\s*=/i', $txt)) {
        return null;
    }
    $cab = [];
    $datos = [];
    $modo = null;
    foreach (preg_split('/\r\n|\r|\n/', $txt) as $l) {
        if (preg_match('/^##\s*([^=]+)=\s*(.*)$/', $l, $m)) {
            $clave = strtoupper(preg_replace('/[\s\-\/_]/', '', $m[1]));
            $valor = trim($m[2]);
            if (in_array($clave, ['XYDATA', 'PEAKTABLE', 'XYPOINTS'], true)) {
                $modo = $clave === 'XYDATA' ? 'xy' : 'pares';
                continue;
            }
            if ($clave === 'END') {
                break;
            }
            $modo = null;
            $cab[$clave] = $valor;
            continue;
        }
        if ($modo !== null && trim($l) !== '') {
            $datos[] = [$modo, $l];
        }
    }
    $xf = (float) ($cab['XFACTOR'] ?? 1) ?: 1.0;
    $yf = (float) ($cab['YFACTOR'] ?? 1) ?: 1.0;
    $x = [];
    $y = [];
    $prevDif = false;
    foreach ($datos as [$modo, $l]) {
        if ($modo === 'pares') {
            preg_match_all('/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/', $l, $mm);
            for ($k = 0; $k + 1 < count($mm[0]); $k += 2) {
                $x[] = (float) $mm[0][$k] * $xf;
                $y[] = (float) $mm[0][$k + 1] * $yf;
            }
            continue;
        }
        [$vals, $terminaDif] = decodificarLineaJcamp($l);
        if (count($vals) < 2) {
            continue;
        }
        $x0 = array_shift($vals) * $xf;
        if ($prevDif && $y) {           // valor de control repetido (Y-check) en formato DIF
            array_shift($vals);
            $x0 = null;
        }
        foreach ($vals as $k => $v) {
            $x[] = $x0;                  // provisional; se recalcula con FIRSTX/LASTX
            $y[] = $v * $yf;
        }
        $prevDif = $terminaDif;
    }
    $npts = count($y);
    if ($npts < 10) {
        return null;
    }
    // Abscisas equiespaciadas a partir de FIRSTX / LASTX (o DELTAX).
    $fx = isset($cab['FIRSTX']) ? (float) $cab['FIRSTX'] : null;
    $lx = isset($cab['LASTX']) ? (float) $cab['LASTX'] : null;
    $dx = isset($cab['DELTAX']) ? (float) $cab['DELTAX'] : null;
    if ($datos && $datos[0][0] === 'xy') {
        if ($fx !== null && $lx !== null) {
            $paso = ($lx - $fx) / max(1, $npts - 1);
        } elseif ($fx !== null && $dx !== null) {
            $paso = $dx;
        } else {
            return null;
        }
        for ($k = 0; $k < $npts; $k++) {
            $x[$k] = $fx + $k * $paso;
        }
    }
    // Unidades: abscisa → cm⁻¹
    $xu = strtoupper($cab['XUNITS'] ?? '1/CM');
    if (strpos($xu, 'MICRO') !== false || $xu === 'UM') {
        $x = array_map(fn($v) => $v > 0 ? 1e4 / $v : 0, $x);
    }
    $yu = strtoupper($cab['YUNITS'] ?? 'TRANSMITTANCE');
    $esAbs = strpos($yu, 'ABSORB') !== false;
    // Orden descendente de número de onda (convención IR).
    if ($x[0] < $x[$npts - 1]) {
        $x = array_reverse($x);
        $y = array_reverse($y);
    }
    return ['cab' => $cab, 'x' => $x, 'y' => $y, 'absorbancia' => $esAbs, 'y_unidad_original' => $yu];
}

/** Detección aproximada de bandas de absorción (máximos de absorbancia con prominencia). */
function detectarBandasIR(array $x, array $a): array
{
    $n = count($a);
    $amin = min($a);
    $amax = max($a);
    $rango = $amax - $amin;
    if ($rango <= 0) {
        return [];
    }
    $paso = abs($x[0] - $x[$n - 1]) / max(1, $n - 1);
    // Prominencia topográfica: se busca hasta un punto más alto o hasta ±600 cm⁻¹
    // (necesario para bandas anchas como ν(O–H) de ácidos carboxílicos).
    $ventana = max(2, (int) round(600 / max($paso, 1e-6)));
    $bandas = [];
    for ($i = 1; $i < $n - 1; $i++) {
        if (!($a[$i] >= $a[$i - 1] && $a[$i] > $a[$i + 1])) {
            continue;
        }
        $minIzq = $a[$i];
        for ($k = $i - 1; $k >= max(0, $i - $ventana); $k--) {
            if ($a[$k] > $a[$i]) {
                break;
            }
            $minIzq = min($minIzq, $a[$k]);
        }
        $minDer = $a[$i];
        for ($k = $i + 1; $k <= min($n - 1, $i + $ventana); $k++) {
            if ($a[$k] > $a[$i]) {
                break;
            }
            $minDer = min($minDer, $a[$k]);
        }
        $prom = $a[$i] - max($minIzq, $minDer);
        if ($prom >= 0.05 * $rango) {
            $rel = ($a[$i] - $amin) / $rango * 100;
            // Anchura a media prominencia (cm⁻¹): distingue bandas anchas (O–H con puente de H)
            // de bandas agudas (≡C–H, N–H libre, C≡N).
            $mitad = $a[$i] - $prom / 2;
            $iz = $i;
            while ($iz > 0 && $a[$iz] > $mitad && $i - $iz < $ventana) {
                $iz--;
            }
            $de = $i;
            while ($de < $n - 1 && $a[$de] > $mitad && $de - $i < $ventana) {
                $de++;
            }
            $ancho = abs($x[$iz] - $x[$de]);
            $bandas[] = [
                'numero_onda'         => round($x[$i], 1),
                'intensidad_relativa' => round($rel, 1),
                'clase'               => $rel >= 66 ? 'f' : ($rel >= 33 ? 'm' : 'd'),   // fuerte, media, débil
                'ancho'               => round($ancho, 0),
                'forma'               => $ancho >= 150 ? 'muy ancha' : ($ancho >= 60 ? 'ancha' : ($ancho <= 25 ? 'aguda' : 'media')),
            ];
        }
    }
    usort($bandas, fn($p, $q) => $q['intensidad_relativa'] <=> $p['intensidad_relativa']);
    $bandas = array_slice($bandas, 0, IR_MAX_BANDAS);
    usort($bandas, fn($p, $q) => $q['numero_onda'] <=> $p['numero_onda']);
    return $bandas;
}

function procesarIR(array $j, string $id, int $indice): array
{
    $n = count($j['y']);
    // Escala vertical: transmitancia en %, o absorbancia tal cual.
    $y = $j['y'];
    if (!$j['absorbancia']) {
        $ymax = max($y);
        $y = $ymax <= 1.5 ? array_map(fn($v) => $v * 100, $y) : $y;   // fracción → %
        $a = array_map(fn($t) => -log10(max(min($t, 100), 0.01) / 100), $y);
        $unidad = 'transmitancia (%)';
    } else {
        $a = $y;
        $unidad = 'absorbancia';
    }
    // Submuestreo que conserva bandas: en cada intervalo se toma el punto de mayor absorbancia.
    $px = [];
    $py = [];
    $bin = max(1, (int) ceil($n / IR_MAX_PUNTOS));
    for ($s = 0; $s < $n; $s += $bin) {
        $best = $s;
        for ($k = $s; $k < min($n, $s + $bin); $k++) {
            if ($a[$k] > $a[$best]) {
                $best = $k;
            }
        }
        $px[] = round($j['x'][$best], 2);
        $py[] = round($y[$best], 4);
    }
    $c = $j['cab'];
    return [
        'id'          => $id . '-IR-' . $indice,
        'titulo'      => $c['TITLE'] ?? null,
        'estado'      => $c['STATE'] ?? null,
        'tecnica'     => $c['SAMPLINGPROCEDURE'] ?? ($c['$NISTSOURCE'] ?? null),
        'instrumento' => $c['SPECTROMETERDATASYSTEM'] ?? ($c['INSTRUMENTPARAMETERS'] ?? null),
        'resolucion'  => $c['RESOLUTION'] ?? null,
        'origen'      => $c['ORIGIN'] ?? null,
        'propietario' => $c['OWNER'] ?? null,
        'fuente'      => 'NIST Chemistry WebBook (SRD 69)',
        'url'         => NIST_WEB . '?ID=' . rawurlencode($id) . '&Type=IR-SPEC&Index=' . $indice,
        'url_jcamp'   => NIST_WEB . '?JCAMP=' . rawurlencode($id) . '&Index=' . $indice . '&Type=IR',
        'rango_cm1'   => [round(max($j['x']), 1), round(min($j['x']), 1)],
        'y_unidad'    => $unidad,
        'num_puntos_original' => $n,
        'bandas'      => detectarBandasIR($j['x'], $a),
        'curva'       => ['x' => $px, 'y' => $py],
    ];
}

function espectrosIR(?string $cas, int $max, array &$avisos): array
{
    if (!$cas) {
        $avisos[] = 'IR: no se obtuvo el número CAS del compuesto; no se pudo consultar NIST.';
        return [];
    }
    $id = 'C' . str_replace('-', '', $cas);
    $urls = [];
    for ($i = 0; $i < NIST_IR_INDICES; $i++) {
        $urls[$i] = NIST_WEB . '?JCAMP=' . $id . '&Index=' . $i . '&Type=IR';
    }
    $resp = httpGetMany(array_values($urls));
    $out = [];
    $vistos = [];
    foreach ($urls as $i => $u) {
        [$code, $body] = $resp[$u] ?? [0, ''];
        if ($code !== 200 || !($j = parsearJcampIR($body))) {
            continue;
        }
        $huella = md5(implode(',', array_slice($j['y'], 0, 50)) . count($j['y']));
        if (isset($vistos[$huella])) {
            continue;
        }
        $vistos[$huella] = true;
        $out[] = procesarIR($j, $id, $i);
        if (count($out) >= $max) {
            break;
        }
    }
    if (!$out) {
        $avisos[] = 'IR: NIST WebBook no ofrece espectros IR descargables para este compuesto.';
    }
    return $out;
}

// ================================================================== 2c. RMN (PubChem/HMDB y NMRShiftDB2)
function buscarSeccion(array $secciones, string $titulo): ?array
{
    foreach ($secciones as $s) {
        if (($s['TOCHeading'] ?? '') === $titulo) {
            return $s;
        }
        if (!empty($s['Section']) && ($r = buscarSeccion($s['Section'], $titulo))) {
            return $r;
        }
    }
    return null;
}

function textoValor(array $item): string
{
    $partes = [];
    foreach ($item['Value']['StringWithMarkup'] ?? [] as $s) {
        $partes[] = (string) ($s['String'] ?? '');
    }
    if (!$partes && isset($item['Value']['Number'])) {
        $partes[] = implode(', ', (array) $item['Value']['Number']);
    }
    return trim(implode(' ', $partes));
}

/** Espectros RMN de PubChem PUG-View para un núcleo ('1H' o '13C'). */
function rmnPubChem(?array $doc, string $nucleo, array &$enlaces): array
{
    if (!$doc) {
        return [];
    }
    $sec = buscarSeccion($doc['Record']['Section'] ?? [], $nucleo . ' NMR Spectra');
    if (!$sec) {
        return [];
    }
    $refs = [];
    foreach ($doc['Record']['Reference'] ?? [] as $r) {
        $refs[$r['ReferenceNumber']] = $r;
    }
    // Agrupación de los campos por ReferenceNumber (cada grupo = un espectro).
    $grupos = [];
    foreach ($sec['Information'] ?? [] as $it) {
        $rn = $it['ReferenceNumber'] ?? 0;
        $grupos[$rn][] = $it;
    }
    $out = [];
    foreach ($grupos as $rn => $items) {
        $campos = [];
        $urlEsp = null;
        foreach ($items as $it) {
            $campos[$it['Name'] ?? ''] = textoValor($it);
            if (($it['Name'] ?? '') === 'Spectra ID' && !empty($it['URL'])) {
                $urlEsp = $it['URL'];
            }
        }
        $ref = $refs[$rn] ?? [];
        $listaPicos = null;
        foreach ($campos as $k => $v) {
            if (stripos($k, 'Shifts') === 0) {
                $listaPicos = $v;
            }
        }
        if ($listaPicos === null) {
            // Espectro sin datos numéricos (p. ej. SpectraBase): solo se ofrece el enlace.
            if (!empty($ref['URL'])) {
                $enlaces[] = ['nucleo' => $nucleo, 'fuente' => $ref['SourceName'] ?? null, 'url' => $ref['URL'],
                    'nota' => $campos['Copyright'] ?? null];
            }
            continue;
        }
        $picos = [];
        foreach (preg_split('/\s*,\s*/', $listaPicos) as $par) {
            if (preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)/', $par, $m)) {
                $picos[] = ['ppm' => (float) $m[1], 'intensidad' => (float) $m[2]];
            }
        }
        if (!$picos) {
            continue;
        }
        $imax = max(array_column($picos, 'intensidad')) ?: 1;
        foreach ($picos as &$p) {
            $p['intensidad_relativa'] = round($p['intensidad'] / $imax * 100, 1);
        }
        unset($p);
        usort($picos, fn($a, $b) => $b['ppm'] <=> $a['ppm']);
        $out[] = [
            'id'          => (string) ($ref['SourceID'] ?? ('PubChem-' . $rn)),
            'nucleo'      => $nucleo,
            'frecuencia'  => $campos['Frequency'] ?? null,
            'disolvente'  => $campos['Solvent'] ?? null,
            'ph'          => $campos['pH'] ?? null,
            'instrumento' => $campos['Instrument Type'] ?? ($campos['Instrument Name'] ?? null),
            'fuente'      => ($ref['SourceName'] ?? 'PubChem') . ' (vía PubChem)',
            'licencia'    => $ref['LicenseNote'] ?? null,
            'url'         => $urlEsp ?? ($ref['URL'] ?? null),
            'num_picos'   => count($picos),
            'picos'       => $picos,
        ];
    }
    return $out;
}

/** Espectros experimentales de NMRShiftDB2 a partir del CML de su interfaz de automatización. */
function rmnNmrShiftDB(string $cml, string $nucleo): array
{
    if (stripos($cml, '<cml') === false && stripos($cml, '<spectrum') === false) {
        return [];
    }
    $prev = libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $ok = $dom->loadXML($cml, LIBXML_NONET);   // sin entidades externas ni red (anti-XXE)
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    if (!$ok) {
        return [];
    }
    $xp = new DOMXPath($dom);
    $out = [];
    foreach ($xp->query('//*[local-name()="spectrum"]') as $sp) {
        /** @var DOMElement $sp */
        $meta = [];
        foreach ($xp->query('.//*[local-name()="metadata"]', $sp) as $md) {
            /** @var DOMElement $md */
            $meta[strtolower($md->getAttribute('name'))] = $md->getAttribute('content');
        }
        $obs = $meta['nmr:observenucleus'] ?? ($meta['cml:observenucleus'] ?? $nucleo);
        if ($obs && strcasecmp(preg_replace('/[^0-9A-Za-z]/', '', $obs), $nucleo) !== 0) {
            continue;
        }
        $frecuencia = null;
        $temperatura = null;
        foreach ($xp->query('.//*[local-name()="scalar"]', $sp) as $sc) {
            /** @var DOMElement $sc */
            $ref = strtolower($sc->getAttribute('dictRef') . ' ' . $sc->getAttribute('title'));
            if (strpos($ref, 'field') !== false || strpos($ref, 'frequency') !== false) {
                $frecuencia = trim($sc->textContent) . ' MHz';
            } elseif (strpos($ref, 'temp') !== false) {
                $u = strtolower(preg_replace('/^.*:/', '', $sc->getAttribute('units')));
                $temperatura = trim($sc->textContent) . ' ' . ($u === 'k' || $u === 'kelvin' ? 'K' : ($u === 'celsius' ? '°C' : $u));
            }
        }
        $disolvente = null;
        foreach ($xp->query('.//*[local-name()="substance"]', $sp) as $su) {
            /** @var DOMElement $su */
            if (stripos($su->getAttribute('role') . $su->getAttribute('dictRef'), 'solvent') !== false) {
                $disolvente = $su->getAttribute('title') ?: $su->getAttribute('id');
            }
        }
        $picos = [];
        foreach ($xp->query('.//*[local-name()="peak"]', $sp) as $pk) {
            /** @var DOMElement $pk */
            if ($pk->getAttribute('xValue') === '') {
                continue;
            }
            $picos[] = [
                'ppm'          => (float) $pk->getAttribute('xValue'),
                'intensidad'   => $pk->getAttribute('yValue') !== '' ? (float) $pk->getAttribute('yValue') : 1.0,
                'multiplicidad'=> $pk->getAttribute('peakMultiplicity') ?: null,
                'atomos'       => $pk->getAttribute('atomRefs') ?: null,
            ];
        }
        if (!$picos) {
            continue;
        }
        $imax = max(array_column($picos, 'intensidad')) ?: 1;
        foreach ($picos as &$p) {
            $p['intensidad_relativa'] = round($p['intensidad'] / $imax * 100, 1);
        }
        unset($p);
        usort($picos, fn($a, $b) => $b['ppm'] <=> $a['ppm']);
        $idSp = $sp->getAttribute('id');
        $num = preg_replace('/\D/', '', $idSp);
        $out[] = [
            'id'          => $idSp ?: 'nmrshiftdb',
            'nucleo'      => $nucleo,
            'frecuencia'  => $frecuencia,
            'disolvente'  => $disolvente,
            'temperatura' => $temperatura,
            'instrumento' => null,
            'fuente'      => 'NMRShiftDB2',
            'licencia'    => 'Datos abiertos de NMRShiftDB2 (cite Steinbeck & Kuhn, 2004)',
            'url'         => $num !== '' ? 'https://nmrshiftdb.nmr.uni-koeln.de/spectrum/' . $num : NSDB_WEB,
            'num_picos'   => count($picos),
            'picos'       => $picos,
        ];
    }
    return $out;
}

function urlNmrShiftDB(string $inchi, string $nucleo): string
{
    // La interfaz espera el InChI completo en la ruta (las "/" del InChI forman parte de él).
    $seguro = preg_replace_callback('/[^A-Za-z0-9=\/\-\.\(\),\+;\?\*]/', fn($m) => rawurlencode($m[0]), $inchi);
    return NSDB_WEB . '/NmrshiftdbServlet/nmrshiftdbaction/exportcmlbyinchi/inchi/' . $seguro . '/spectrumtype/' . $nucleo;
}

// ================================================================== Programa principal
$smiles = trim((string) ($_GET['smiles'] ?? ''));
if ($smiles !== '') {
    // Búsqueda por estructura (SMILES dibujado en JSME o pegado por el usuario).
    $modo = 'smiles';
    $q = $smiles;
    if (strlen($q) > 500 || !preg_match('/^[A-Za-z0-9@+\-\[\]()\\\\\/=#$%.:*~]+$/', $q)) {
        responder(400, ['error' => 'SMILES no válido (máximo 500 caracteres, sin espacios).']);
    }
    if (strpos($q, '.') !== false) {
        responder(400, ['error' => 'El SMILES contiene varios fragmentos (".") ; dibuje una sola molécula.']);
    }
} else {
    $modo = 'nombre';
    $q = trim((string) ($_GET['nombre'] ?? ''));
    $q = preg_replace('/\s+/u', ' ', $q);
    if ($q === '' || mb_strlen($q) > 150) {
        responder(400, ['error' => 'Indique "nombre" (1–150 caracteres) o "smiles".']);
    }
    if (preg_match('/[\x00-\x1F<>{}]/u', $q)) {
        responder(400, ['error' => 'El nombre contiene caracteres no válidos.']);
    }
}
$max = max(1, min(MAX_ESPECTROS, (int) ($_GET['max'] ?? 3)));
$tipos = array_intersect(
    array_map('trim', explode(',', strtolower((string) ($_GET['tipos'] ?? 'ms,ir,rmn')))),
    ['ms', 'ir', 'rmn']
) ?: ['ms', 'ir', 'rmn'];

asegurarCache();
limitarFrecuencia();

$avisos = [];
$comp = resolverCompuesto($q, $modo);
$cid = $comp['pubchem_cid'] ?? null;

// Descarga paralela de lo que depende del CID / InChI.
$urlsAux = [];
if ($cid) {
    // Estructura 2D (molfile) para la interpretación en el navegador con RDKit.js.
    $urlsAux['sdf'] = PC_API . '/compound/cid/' . $cid . '/SDF?record_type=2d';
    if (in_array('ir', $tipos, true) && empty($comp['cas'])) {
        $urlsAux['sin'] = PC_API . '/compound/cid/' . $cid . '/synonyms/JSON';
    }
    if (in_array('rmn', $tipos, true)) {
        $urlsAux['h1']  = PCV_API . '/data/compound/' . $cid . '/JSON?heading=' . rawurlencode('1H NMR Spectra');
        $urlsAux['c13'] = PCV_API . '/data/compound/' . $cid . '/JSON?heading=' . rawurlencode('13C NMR Spectra');
    }
}
if (USAR_NMRSHIFTDB && in_array('rmn', $tipos, true) && !empty($comp['inchi'])) {
    $urlsAux['nsH'] = urlNmrShiftDB($comp['inchi'], '1H');
    $urlsAux['nsC'] = urlNmrShiftDB($comp['inchi'], '13C');
}
$aux = $urlsAux ? httpGetMany(array_values($urlsAux)) : [];
$r = fn(string $k) => isset($urlsAux[$k]) ? ($aux[$urlsAux[$k]] ?? [0, '']) : [0, ''];

if ($comp && empty($comp['cas']) && isset($urlsAux['sin'])) {
    $comp['cas'] = casDeSinonimos(jsonDe($r('sin')));
}
if ($comp) {
    $comp['molfile'] = null;
    if (isset($urlsAux['sdf'])) {
        [$cS, $bS] = $r('sdf');
        $pos = strpos($bS, 'M  END');
        if ($cS === 200 && $pos !== false && $pos < 200000) {
            $comp['molfile'] = substr($bS, 0, $pos + 6);
        }
    }
    $comp['smiles'] = $modo === 'smiles' ? $q : null;
}

$resultado = [];

// --- EM
if (in_array('ms', $tipos, true)) {
    $resultado['espectros'] = espectrosMasas($comp, $q, $max, $avisos, $modo === 'nombre');
}

// --- IR
if (in_array('ir', $tipos, true)) {
    if ($comp) {
        $resultado['ir'] = espectrosIR($comp['cas'] ?? null, $max, $avisos);
    } else {
        $resultado['ir'] = [];
        $avisos[] = 'IR: el compuesto no se identificó en PubChem; use el nombre en inglés o el CAS.';
    }
}

// --- RMN
if (in_array('rmn', $tipos, true)) {
    $enlaces = [];
    $rmn = ['1H' => [], '13C' => []];
    if ($cid) {
        $rmn['1H']  = rmnPubChem(jsonDe($r('h1')), '1H', $enlaces);
        $rmn['13C'] = rmnPubChem(jsonDe($r('c13')), '13C', $enlaces);
    }
    if (isset($urlsAux['nsH'])) {
        [$c1, $b1] = $r('nsH');
        [$c2, $b2] = $r('nsC');
        $rmn['1H']  = array_merge(rmnNmrShiftDB($c1 === 200 ? $b1 : '', '1H'), $rmn['1H']);
        $rmn['13C'] = array_merge(rmnNmrShiftDB($c2 === 200 ? $b2 : '', '13C'), $rmn['13C']);
    }
    foreach (['1H', '13C'] as $nu) {
        $rmn[$nu] = array_slice($rmn[$nu], 0, $max);
        if (!$rmn[$nu]) {
            $avisos[] = "RMN $nu: no se encontraron listas de desplazamientos experimentales.";
        }
    }
    $rmn['enlaces'] = array_values(array_unique($enlaces, SORT_REGULAR));
    $resultado['rmn'] = $rmn;
}

$total = count($resultado['espectros'] ?? []) + count($resultado['ir'] ?? [])
       + count($resultado['rmn']['1H'] ?? []) + count($resultado['rmn']['13C'] ?? []);

if ($total === 0) {
    responder(404, [
        'consulta'  => $q,
        'modo'      => $modo,
        'compuesto' => $comp,
        'avisos'    => $avisos,
        'error'     => $comp
            ? 'El compuesto existe en PubChem, pero no se encontraron espectros en las fuentes consultadas.'
            : ($modo === 'smiles'
                ? 'La estructura no está registrada en PubChem; no hay espectros experimentales asociados.'
                : 'Compuesto no encontrado. Use el nombre en inglés, el número CAS o el InChIKey.'),
    ]);
}

responder(200, [
    'consulta'  => $q,
    'modo'      => $modo,
    'tipos'     => array_values($tipos),
    'compuesto' => $comp,
    'devueltos' => [
        'ms'      => count($resultado['espectros'] ?? []),
        'ir'      => count($resultado['ir'] ?? []),
        'rmn_1H'  => count($resultado['rmn']['1H'] ?? []),
        'rmn_13C' => count($resultado['rmn']['13C'] ?? []),
    ],
] + $resultado + [
    'avisos'         => $avisos,
    'fuentes'        => [
        'ms'  => 'MassBank Europe (https://massbank.eu). Horai H. et al. J. Mass Spectrom. 2010, 45, 703–714. doi:10.1002/jms.1777',
        'ir'  => 'NIST Chemistry WebBook, NIST Standard Reference Database 69 (https://webbook.nist.gov); espectros de la Coblentz Society. © U.S. Secretary of Commerce.',
        'rmn' => 'PubChem (https://pubchem.ncbi.nlm.nih.gov), datos de HMDB (Wishart D.S. et al. Nucleic Acids Res. 2022, 50, D622–D631. doi:10.1093/nar/gkab1062); '
               . 'NMRShiftDB2 (Steinbeck C., Kuhn S. Phytochemistry 2004, 65, 2711–2717. doi:10.1016/j.phytochem.2004.08.027).',
    ],
    'fecha_consulta' => gmdate('c'),
]);
