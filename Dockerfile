# MSDatabase — imagen para Dokploy (Build Type: Dockerfile)
# Etapa 1 (Node): empaqueta el motor EI-MS (vendor/eims-engine), RDKit.js y JSME.
# Etapa 2 (PHP 8.3 + Apache): sirve la interfaz, el servicio ms_api.php y los recursos construidos.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# npm ci verifica la integridad (SHA-512) de cada paquete contra package-lock.json
RUN npm ci --no-audit --no-fund
COPY build.mjs ./
COPY src-js ./src-js
COPY vendor ./vendor
RUN node build.mjs


FROM php:8.3-apache
# La imagen oficial ya incluye las extensiones curl, mbstring, dom, json y filter.

# Configuración PHP y Apache de producción; WebAssembly con su tipo MIME, comprimido y con caché larga
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && { echo 'expose_php = Off'; echo 'max_execution_time = 90'; echo 'date.timezone = America/Panama'; } \
      > "$PHP_INI_DIR/conf.d/zz-msdatabase.ini" \
 && a2enmod headers deflate \
 && { echo 'ServerTokens Prod'; echo 'ServerSignature Off'; echo 'ServerName localhost'; \
      echo 'AddType application/wasm .wasm'; \
      echo 'AddOutputFilterByType DEFLATE application/wasm application/javascript text/javascript text/css text/html application/json'; \
      echo '<LocationMatch "^/(rdkit|jsme)/">'; echo '  Header set Cache-Control "public, max-age=2592000, immutable"'; echo '</LocationMatch>'; \
      echo '<LocationMatch "^/js/">'; echo '  Header set Cache-Control "public, max-age=3600"'; echo '</LocationMatch>'; } \
      > /etc/apache2/conf-available/zz-msdatabase.conf \
 && a2enconf zz-msdatabase

# Recursos construidos (js/eims-engine.js, rdkit/, jsme/) y archivos de la aplicación
COPY --from=build /src/build/ /var/www/html/
COPY index.html ms_api.php /var/www/html/
COPY js/ /var/www/html/js/

# Caché fuera de la raíz web, con escritura para Apache (www-data)
RUN mkdir -p /var/www/cache \
 && chown -R www-data:www-data /var/www/cache \
 && chmod 750 /var/www/cache

ENV MS_CACHE_DIR=/var/www/cache \
    MS_TRUST_PROXY=1

VOLUME ["/var/www/cache"]
EXPOSE 80

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD php -r 'exit(@file_get_contents("http://127.0.0.1/index.html") === false ? 1 : 0);'
