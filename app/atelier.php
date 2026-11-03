<?php
declare(strict_types=1);

function sessionInfo(PDO $db, string $code): array
{
    $row = query($db, 'SELECT code, question, revision, created_at FROM sessions WHERE code = ?', [$code])->fetch();
    if (!$row) {
        throw new ApiError(404, 'Session introuvable. Vérifie le code et réessaie.');
    }
    return $row;
}

function createSession(PDO $db, array $body): array
{
    $question = lineText($body['question'] ?? null, 300, 'La question');
    $id = requestId($body);
    return writeTransaction($db, function () use ($db, $question, $id): array {
        $existing = query($db, 'SELECT code FROM sessions WHERE creation_id = ?', [$id])->fetchColumn();
        if ($existing !== false) {
            return sessionInfo($db, $existing);
        }
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= CODE_ALPHABET[random_int(0, strlen(CODE_ALPHABET) - 1)];
            }
            $insert = query($db, 'INSERT INTO sessions(code, creation_id, question) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING', [$code, $id, $question]);
        } while ($insert->rowCount() === 0);
        return sessionInfo($db, $code);
    });
}

function editQuestion(PDO $db, string $code, array $body): array
{
    $question = lineText($body['question'] ?? null, 300, 'La question');
    $revision = revisionInput($body);
    return writeTransaction($db, function () use ($db, $code, $question, $revision): array {
        $session = sessionInfo($db, $code);
        if ($session['question'] === $question) {
            return $session;
        }
        if ($session['revision'] !== $revision) {
            throw new ApiError(409, 'La question a été modifiée dans un autre onglet. Relis-la avant d’enregistrer.');
        }
        query($db, 'UPDATE sessions SET question = ?, revision = revision + 1 WHERE code = ?', [$question, $code]);
        return sessionInfo($db, $code);
    });
}

function joinSession(PDO $db, string $code, array $body): array
{
    lineText($body['nickname'] ?? null, 40, 'Le pseudo');
    $session = sessionInfo($db, $code);
    $token = bin2hex(random_bytes(24));
    query($db, 'INSERT INTO admissions(token_hash, session_code) VALUES (?, ?)', [hash('sha256', $token), $code]);
    // Le pseudo n’est conservé que dans le navigateur. Une idée ne référence aucune admission.
    return ['session' => $session, 'token' => $token];
}

function addIdea(PDO $db, string $code, array $body): array
{
    $token = $_SERVER['HTTP_X_PARTICIPANT_TOKEN'] ?? '';
    $valid = query($db, 'SELECT 1 FROM admissions WHERE token_hash = ? AND session_code = ?', [hash('sha256', $token), $code])->fetchColumn();
    if (!$valid) {
        throw new ApiError(403, 'Rejoins cette session avec ton pseudo avant de proposer une idée.');
    }
    $id = requestId($body);
    $idea = lineText($body['idea'] ?? null, 1000, 'L’idée');
    $revision = revisionInput($body);
    return writeTransaction($db, function () use ($db, $code, $id, $idea, $revision): array {
        $previous = query($db, 'SELECT id, body FROM ideas WHERE session_code = ? AND request_id = ?', [$code, $id])->fetch();
        if ($previous) {
            if ($previous['body'] !== $idea) {
                throw new ApiError(409, 'Cet identifiant a déjà servi pour une autre idée.');
            }
            return ['id' => $previous['id'], 'created' => false];
        }
        if (sessionInfo($db, $code)['revision'] !== $revision) {
            throw new ApiError(409, 'La question a changé. Relis-la puis confirme ton idée.');
        }
        query($db, 'INSERT INTO ideas(session_code, request_id, body) VALUES (?, ?, ?)', [$code, $id, $idea]);
        return ['id' => (int) $db->lastInsertId(), 'created' => true];
    });
}

function ideasQuery(PDO $db, string $code): PDOStatement
{
    return query($db, 'SELECT body FROM ideas WHERE session_code = ? ORDER BY id', [$code]);
}

function exportCsv(PDO $db, string $code): void
{
    sessionInfo($db, $code);
    $rows = ideasQuery($db, $code);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="idees-' . $code . '.csv"');
    $out = fopen('php://output', 'wb');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['Idée'], ';', '"', '', "\r\n");
    while (($text = $rows->fetchColumn()) !== false) {
        // Empêche un tableur d’exécuter comme formule le contenu d’une contribution.
        if (preg_match('/^[\p{Cf}\s]*[=+@\-＝＋＠－]/u', $text)) {
            $text = "'" . $text;
        }
        fputcsv($out, [$text], ';', '"', '', "\r\n");
    }
    fclose($out);
}
