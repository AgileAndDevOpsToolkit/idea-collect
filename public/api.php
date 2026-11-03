<?php
declare(strict_types=1);
require __DIR__ . '/../app/config.php';
require __DIR__ . '/../app/database.php';
require __DIR__ . '/../app/http.php';
require __DIR__ . '/../app/atelier.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

try {
    if (!hash_equals(APP_KEY, $_SERVER['HTTP_X_APP_KEY'] ?? '')) {
        throw new ApiError(401, 'Clé d’application invalide.');
    }
    $routes = [
        'session' => 'GET', 'join' => 'POST', 'submit' => 'POST',
        'sessions' => 'GET', 'create' => 'POST', 'edit' => 'POST',
        'ideas' => 'GET', 'csv' => 'GET',
    ];
    $action = $_GET['action'] ?? '';
    if (!is_string($action) || !isset($routes[$action])) {
        throw new ApiError(404, 'Action inconnue.');
    }
    if ($_SERVER['REQUEST_METHOD'] !== $routes[$action]) {
        header('Allow: ' . $routes[$action]);
        throw new ApiError(405, 'Méthode HTTP incorrecte.');
    }
    if (!in_array($action, ['session', 'join', 'submit'], true) &&
        !hash_equals(ADMIN_KEY, $_SERVER['HTTP_X_ADMIN_KEY'] ?? '')) {
        throw new ApiError(401, 'Clé d’administration incorrecte.');
    }
    $db = database();
    switch ($action) {
        case 'sessions':
            $sessions = $db->query('SELECT s.code, s.question, s.revision, s.created_at,
                (SELECT COUNT(*) FROM ideas i WHERE i.session_code = s.code) AS idea_count
                FROM sessions s ORDER BY s.created_at DESC, s.rowid DESC')->fetchAll();
            jsonResponse(['sessions' => $sessions]);
            break;
        case 'session':
            jsonResponse(['session' => sessionInfo($db, codeInput())]);
            break;
        case 'create':
            jsonResponse(['session' => createSession($db, readBody())], 201);
            break;
        case 'join':
            jsonResponse(joinSession($db, codeInput(), readBody()), 201);
            break;
        case 'edit':
            jsonResponse(['session' => editQuestion($db, codeInput(), readBody())]);
            break;
        case 'submit':
            $result = addIdea($db, codeInput(), readBody());
            jsonResponse($result, $result['created'] ? 201 : 200);
            break;
        case 'ideas':
            $code = codeInput();
            jsonResponse(['session' => sessionInfo($db, $code), 'ideas' => ideasQuery($db, $code)->fetchAll(PDO::FETCH_COLUMN)]);
            break;
        case 'csv':
            exportCsv($db, codeInput());
            break;
    }
} catch (ApiError $error) {
    jsonResponse(['error' => $error->getMessage()], $error->status);
} catch (Throwable $error) {
    error_log('Atelier API: ' . $error->getMessage());
    header('Retry-After: 3');
    jsonResponse(['error' => 'Stockage temporairement indisponible. Réessaie dans un instant.'], 503);
}
