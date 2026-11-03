<?php
declare(strict_types=1);

final class ApiError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function jsonResponse(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

function readBody(): array
{
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($type !== 'application/json') {
        throw new ApiError(415, 'Le corps doit être au format JSON.');
    }
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) {
        throw new ApiError(413, 'Requête trop longue.');
    }
    $value = json_decode($raw, true, 12);
    if (!is_array($value) || array_is_list($value)) {
        throw new ApiError(400, 'Objet JSON attendu.');
    }
    return $value;
}

function lineText(mixed $value, int $max, string $label): string
{
    // Une contribution = une ligne, y compris après un collage depuis un traitement de texte.
    $value = is_string($value) ? preg_replace('/[\p{Z}\p{Cc}]+/u', ' ', $value) : null;
    $value = trim($value ?? '');
    if ($value === '' || preg_match_all('/./u', $value) > $max) {
        throw new ApiError(422, "$label doit contenir entre 1 et $max caractères.");
    }
    return $value;
}

function codeInput(): string
{
    $input = $_GET['code'] ?? '';
    $code = is_string($input) ? strtoupper(trim($input)) : '';
    if (strlen($code) !== 6 || strspn($code, CODE_ALPHABET) !== 6) {
        throw new ApiError(422, 'Saisis un code de session valide à 6 caractères.');
    }
    return $code;
}

function requestId(array $body): string
{
    $id = $body['requestId'] ?? null;
    if (!is_string($id) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) {
        throw new ApiError(422, 'Identifiant d’envoi invalide.');
    }
    return $id;
}

function revisionInput(array $body): int
{
    $revision = $body['revision'] ?? null;
    if (!is_int($revision) || $revision < 1) {
        throw new ApiError(422, 'Version de la question invalide.');
    }
    return $revision;
}
