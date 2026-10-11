# MSDatabase — PHP 8.3 + Apache, listo para Dokploy
# La imagen oficial ya incluye las extensiones curl, mbstring, dom, json y filter.
FROM php:8.3-apache

# Configuración PHP de producción
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && { echo 'expose_php = Off'; echo 'max_execution_time = 90'; echo 'date.timezone = America/Panama'; } \
      > "$PHP_INI_DIR/conf.d/zz-msdatabase.ini" \
 && { echo 'ServerTokens Prod'; echo 'ServerSignature Off'; echo 'ServerName localhost'; } \
      > /etc/apache2/conf-available/zz-msdatabase.conf \
 && a2enconf zz-msdatabase

# Editor de estructuras JSME (BSD-3), servido localmente desde /jsme/.
# Se descarga de npm y se verifica su SHA-1 publicado (dist.shasum).
ARG JSME_VERSION=2024.4.29
ARG JSME_SHA1=e82af48b1e5bd4496f10fd5ead35fa0a6d81618f
RUN curl -fsSL -o /tmp/jsme.tgz "https://registry.npmjs.org/jsme-editor/-/jsme-editor-${JSME_VERSION}.tgz" \
 && echo "${JSME_SHA1}  /tmp/jsme.tgz" | sha1sum -c - \
 && mkdir -p /tmp/jsme && tar -xzf /tmp/jsme.tgz -C /tmp/jsme \
 && mv /tmp/jsme/package /var/www/html/jsme \
 && rm -rf /tmp/jsme /tmp/jsme.tgz

# Solo los archivos públicos van a la raíz web
COPY index.html ms_api.php /var/www/html/

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
