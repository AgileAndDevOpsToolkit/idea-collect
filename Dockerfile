FROM php:8.4-apache-bookworm

ENV DATA_DIR=/data \
    APACHE_ENVVARS=/etc/apache2/atelier-envvars

RUN set -eu; \
    php -r 'exit(in_array("sqlite", PDO::getAvailableDrivers(), true) ? 0 : 1);'; \
    a2enmod headers; \
    printf 'Listen 8080\n' > /etc/apache2/ports.conf; \
    cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"; \
    printf 'expose_php=Off\nmemory_limit=64M\n' > "$PHP_INI_DIR/conf.d/atelier.ini"; \
    install -d -o www-data -g www-data -m 0770 /data

COPY docker/atelier-envvars /etc/apache2/atelier-envvars
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY app /var/www/atelier/app
COPY public /var/www/atelier/public

WORKDIR /var/www/atelier
USER 33:33
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD php -d default_socket_timeout=3 -r 'exit(@file_get_contents("http://127.0.0.1:8080/health.php") === "ok\n" ? 0 : 1);'
CMD ["apache2-foreground"]
