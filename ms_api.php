<?php
/**
 * ms_api.php — Consulta de espectros de masas EI (tabla m/z) por nombre de compuesto.
 *
 * Flujo:
 *   1. Resuelve el identificador recibido (nombre en inglés, CAS o InChIKey) a InChIKey
 *      mediante PubChem PUG REST.
 *   2. Busca en MassBank (API REST oficial de MassBank3) los registros con ionización
 *      electrónica (EI-B, GC-EI-*) y ms_type = MS para ese InChIKey.
 *   3. Descarga cada registro y devuelve la tabla m/z normalizada en JSON.
 *
 * Uso:   GET ms_api.php?nombre=benzoic%20acid[&max=3]
 *        GET ms_api.php?nombre=65-85-0
 *        GET ms_api.php?nombre=WPYMKLBDIGXBTP-UHFFFAOYSA-N
 *
 * Requisitos: PHP >= 7.4 con extensión cURL. Directorio ./cache escribible.
 *
 * Fuentes de datos:
 *   - MassBank Europe, https://massbank.eu  (licencias CC por registro, campo "license")
 *   - PubChem PUG REST, https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 *
 * Nota: SDBS (AIST) no se consulta de forma programada porque sus condiciones de uso
 * prohíben la recolección automática de datos ("Automatically collect data by robots ...
 * are prohibited", https://sdbs.db.aist.go.jp/Htmls/disclaimer_eng.html).
 */

declare(strict_types=1);

// ------------------------------------------------------------------ Configuración
const MASSBANK_API   = 'https://massbank.eu/MassBank-api';
const MASSBANK_WEB   = 'https://massbank.eu/MassBank/RecordDisplay?id=';
const PUBCHEM_API    = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const EI_TYPES       = 'EI-B,EI-EBEB,EI-TOF,EI-QTOF,GC-EI-B,GC-EI-BE,GC-EI-FT,GC-EI-Q,GC-EI-QQ,GC-EI-QTOF,GC-EI-TOF';
const MAX_ESPECTROS  = 5;            // tope de registros devueltos por consulta
const CACHE_TTL      = 2592000;      // 30 días
const LIMITE_MIN     = 20;           // consultas por minuto y por IP
const HTTP_TIMEOUT   = 20;           // segundos

// Ajustables por variables de entorno (Dokploy → Environment):
//   MS_CACHE_DIR    Carpeta de caché FUERA de la raíz web (en Docker: /var/www/cache).
//   MS_TRUST_PROXY  1 = la app está detrás de Traefik/Nginx; usa X-Forwarded-For para la IP real.
//   MS_CORS_ORIGIN  p. ej. https://midominio.com ; vacío = solo mismo origen.
define('CACHE_DIR',   rtrim(getenv('MS_CACHE_DIR') ?: __DIR__ . '/cache', '/'));
define('TRUST_PROXY', getenv('MS_TRUST_PROXY') === '1');
define('CORS_ORIGIN', (string) (getenv('MS_CORS_ORIGIN') ?: ''));

// Permite redirigir las API en pruebas (variables de entorno opcionales).
$MB_API = getenv('MS_MASSBANK_API') ?: MASSBANK_API;
$PC_API = getenv('MS_PUBCHEM_API')  ?: PUBCHEM_API;

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

// ------------------------------------------------------------------ Utilidades
function responder(int $codigo, array $datos): void
{
    http_response_code($codigo);
    echo json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_PRETTY_PRINT);
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
    $ip   = ipCliente();
    $file = CACHE_DIR . '/rl_' . sha1($ip) . '.json';
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

/**
 * GET HTTP con caché en disco. Devuelve [codigo, cuerpo].
 * Solo se cachean respuestas 200 y 404 (resultado "no encontrado" estable).
 */
function httpGet(string $url): array
{
    $cacheFile = CACHE_DIR . '/h_' . sha1($url) . '.json';
    if (is_file($cacheFile) && filemtime($cacheFile) > time() - CACHE_TTL) {
        $c = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($c)) {
            return [$c['code'], $c['body']];
        }
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT        => HTTP_TIMEOUT,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_USERAGENT      => 'EIMS-Consulta/1.0 (uso academico; UNACHI)',
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS | CURLPROTO_HTTP,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        return [0, $err];
    }
    if ($code === 200 || $code === 404) {
        @file_put_contents($cacheFile, json_encode(['code' => $code, 'body' => $body]), LOCK_EX);
    }
    return [$code, (string) $body];
}

function getJson(string $url): ?array
{
    [$code, $body] = httpGet($url);
    if ($code !== 200) {
        return null;
    }
    $d = json_decode($body, true);
    return is_array($d) ? $d : null;
}

// ------------------------------------------------------------------ 1. Resolución del compuesto
function resolverCompuesto(string $q, string $pcApi): ?array
{
    $esInchiKey = (bool) preg_match('/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/', $q);
    $ruta = $esInchiKey
        ? '/compound/inchikey/' . rawurlencode($q)
        : '/compound/name/' . rawurlencode($q);
    $url = $pcApi . $ruta . '/property/InChIKey,MolecularFormula,MonoisotopicMass,IUPACName,Title/JSON';
    $d = getJson($url);
    $p = $d['PropertyTable']['Properties'][0] ?? null;

    if ($p === null) {
        // PubChem no lo reconoce; si era InChIKey, se usa tal cual.
        return $esInchiKey ? ['inchikey' => $q, 'nombre' => null, 'formula' => null,
                              'masa_monoisotopica' => null, 'pubchem_cid' => null] : null;
    }
    return [
        'nombre'             => $p['Title'] ?? ($p['IUPACName'] ?? $q),
        'nombre_iupac'       => $p['IUPACName'] ?? null,
        'formula'            => $p['MolecularFormula'] ?? null,
        'masa_monoisotopica' => isset($p['MonoisotopicMass']) ? round((float) $p['MonoisotopicMass'], 5) : null,
        'inchikey'           => $p['InChIKey'] ?? null,
        'pubchem_cid'        => $p['CID'] ?? null,
    ];
}

// ------------------------------------------------------------------ 2. Búsqueda en MassBank
function buscarAccesiones(array $params, string $mbApi): array
{
    $params['instrument_type'] = EI_TYPES;
    $params['ms_type']         = 'MS';
    $d = getJson($mbApi . '/records/search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986));
    $out = [];
    foreach ($d['data'] ?? [] as $r) {
        if (!empty($r['accession'])) {
            $out[] = ['accession' => (string) $r['accession'], 'atomcount' => (int) ($r['atomcount'] ?? 0)];
        }
    }
    return $out;
}

// ------------------------------------------------------------------ 3. Normalización del registro
function subtag(array $rec, string $nombre): ?string
{
    foreach ($rec['acquisition']['mass_spectrometry']['subtags'] ?? [] as $s) {
        if (($s['subtag'] ?? '') === $nombre) {
            return (string) $s['value'];
        }
    }
    return null;
}

function normalizarRegistro(array $rec): ?array
{
    $vals = $rec['peak']['peak']['values'] ?? [];
    if (!$vals) {
        return null;
    }
    $max = 0.0;
    foreach ($vals as $v) {
        $max = max($max, (float) ($v['intensity'] ?? 0));
    }
    if ($max <= 0) {
        return null;
    }
    $picos = [];
    foreach ($vals as $v) {
        $i = (float) ($v['intensity'] ?? 0);
        $picos[] = [
            'mz'                  => (float) $v['mz'],
            'intensidad'          => $i,
            'intensidad_relativa' => round($i / $max * 100, 1),   // % respecto del pico base
        ];
    }
    usort($picos, fn($a, $b) => $a['mz'] <=> $b['mz']);
    $base = array_reduce($picos, fn($c, $p) => ($c === null || $p['intensidad'] > $c['intensidad']) ? $p : $c);

    $acc = (string) $rec['accession'];
    return [
        'accession'           => $acc,
        'titulo'              => $rec['title'] ?? null,
        'nombres_registro'    => $rec['compound']['names'] ?? [],
        'formula_registro'    => $rec['compound']['formula'] ?? null,
        'instrumento'         => $rec['acquisition']['instrument'] ?? null,
        'tipo_instrumento'    => $rec['acquisition']['instrument_type'] ?? null,
        'tipo_ms'             => $rec['acquisition']['mass_spectrometry']['ms_type'] ?? null,
        'modo_ion'            => $rec['acquisition']['mass_spectrometry']['ion_mode'] ?? null,
        'energia_ionizacion'  => subtag($rec, 'IONIZATION_ENERGY'),
        'splash'              => $rec['peak']['splash'] ?? null,
        'licencia'            => $rec['license'] ?? null,
        'url'                 => MASSBANK_WEB . rawurlencode($acc),
        'num_picos'           => count($picos),
        'pico_base_mz'        => $base['mz'],
        'picos'               => $picos,
    ];
}

/** Prioriza espectros EI clásicos de sector magnético a 70 eV, luego GC-EI. */
function ordenarEspectros(array &$esp): void
{
    usort($esp, function ($a, $b) {
        $pa = (strpos((string) $a['tipo_instrumento'], 'GC-') === 0 ? 1 : 0);
        $pb = (strpos((string) $b['tipo_instrumento'], 'GC-') === 0 ? 1 : 0);
        return [$pa, $b['num_picos']] <=> [$pb, $a['num_picos']];
    });
}

// ------------------------------------------------------------------ Programa principal
$q = trim((string) ($_GET['nombre'] ?? ''));
$q = preg_replace('/\s+/u', ' ', $q);
if ($q === '' || mb_strlen($q) > 150) {
    responder(400, ['error' => 'Parámetro "nombre" requerido (1–150 caracteres).']);
}
if (preg_match('/[\x00-\x1F<>{}]/u', $q)) {
    responder(400, ['error' => 'El nombre contiene caracteres no válidos.']);
}
$max = (int) ($_GET['max'] ?? 3);
$max = max(1, min(MAX_ESPECTROS, $max));

asegurarCache();
limitarFrecuencia();

$compuesto = resolverCompuesto($q, $PC_API);
$candidatos = [];
$metodo = null;

if ($compuesto && !empty($compuesto['inchikey'])) {
    $candidatos = buscarAccesiones(['inchi_key' => $compuesto['inchikey']], $MB_API);
    $metodo = 'inchikey';
}

// Respaldo: búsqueda por nombre en MassBank (subcadena) con verificación de nombre exacto.
$verificarNombre = false;
if (!$candidatos) {
    $candidatos = buscarAccesiones(['compound_name' => $q], $MB_API);
    usort($candidatos, fn($a, $b) => $a['atomcount'] <=> $b['atomcount']);
    $candidatos = array_slice($candidatos, 0, 25);
    $metodo = 'nombre_massbank';
    $verificarNombre = true;
}

if (!$candidatos) {
    responder(404, [
        'consulta'  => $q,
        'compuesto' => $compuesto,
        'error'     => $compuesto
            ? 'El compuesto existe en PubChem, pero MassBank no tiene espectros EI para él.'
            : 'Compuesto no encontrado. Use el nombre en inglés, el número CAS o el InChIKey.',
    ]);
}

$espectros = [];
$qMin = mb_strtolower($q);
foreach ($candidatos as $c) {
    if (count($espectros) >= $max) {
        break;
    }
    $rec = getJson($MB_API . '/records/' . rawurlencode($c['accession']));
    if (!$rec || ($rec['acquisition']['mass_spectrometry']['ms_type'] ?? 'MS') !== 'MS') {
        continue;
    }
    if ($verificarNombre) {
        $nombres = array_map('mb_strtolower', $rec['compound']['names'] ?? []);
        if (!in_array($qMin, $nombres, true)) {
            continue;
        }
    }
    $n = normalizarRegistro($rec);
    if ($n) {
        $espectros[] = $n;
    }
}

if (!$espectros) {
    responder(404, [
        'consulta'  => $q,
        'compuesto' => $compuesto,
        'error'     => 'No se encontraron espectros EI con coincidencia exacta del compuesto.',
    ]);
}
ordenarEspectros($espectros);

responder(200, [
    'consulta'        => $q,
    'metodo_busqueda' => $metodo,
    'compuesto'       => $compuesto,
    'total_encontrados' => count($candidatos),
    'devueltos'       => count($espectros),
    'espectros'       => $espectros,
    'fuente'          => 'MassBank Europe (https://massbank.eu); identificación vía PubChem',
    'cita'            => 'Horai H. et al. MassBank: a public repository for sharing mass spectral data for life sciences. '
                       . 'J. Mass Spectrom. 2010, 45, 703–714. doi:10.1002/jms.1777',
    'fecha_consulta'  => gmdate('c'),
]);
