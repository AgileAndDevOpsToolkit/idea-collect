<?php
declare(strict_types=1);
require __DIR__ . '/../app/database.php';
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
try {
    $db = database();
    $db->query('SELECT 1 FROM sessions LIMIT 1')->closeCursor();
    $dir = getenv('DATA_DIR') ?: dirname(__DIR__) . '/var';
    if (!is_writable($dir) || !is_writable($dir . '/atelier.sqlite')) {
        throw new RuntimeException('Stockage en lecture seule.');
    }
    echo "ok\n";
} catch (Throwable $error) {
    error_log('Atelier readiness: ' . $error->getMessage());
    http_response_code(503);
    echo "unavailable\n";
}
