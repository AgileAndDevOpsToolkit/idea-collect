<?php
declare(strict_types=1);

function database(): PDO
{
    $dir = getenv('DATA_DIR') ?: dirname(__DIR__) . '/var';
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        throw new RuntimeException('Répertoire de données inaccessible.');
    }
    $db = new PDO('sqlite:' . $dir . '/atelier.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 8,
    ]);
    $db->exec('PRAGMA foreign_keys = ON');
    $version = (int) $db->query('PRAGMA user_version')->fetchColumn();
    if ($version === 0) {
        writeTransaction($db, function () use ($db): void {
            // Un deuxième worker peut avoir terminé l’initialisation entre-temps.
            if ((int) $db->query('PRAGMA user_version')->fetchColumn() !== 0) {
                return;
            }
            $db->exec(<<<'SQL'
                CREATE TABLE sessions (
                    code TEXT PRIMARY KEY NOT NULL,
                    creation_id TEXT NOT NULL UNIQUE,
                    question TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
                );
                CREATE TABLE admissions (
                    token_hash TEXT PRIMARY KEY NOT NULL,
                    session_code TEXT NOT NULL REFERENCES sessions(code)
                );
                CREATE TABLE ideas (
                    id INTEGER PRIMARY KEY,
                    session_code TEXT NOT NULL REFERENCES sessions(code),
                    request_id TEXT NOT NULL,
                    body TEXT NOT NULL,
                    UNIQUE(session_code, request_id)
                );
                CREATE INDEX ideas_by_session ON ideas(session_code, id);
                PRAGMA user_version = 1;
                SQL);
        });
    } elseif ($version !== 1) {
        throw new RuntimeException('Version de base incompatible.');
    }
    return $db;
}

function writeTransaction(PDO $db, callable $operation): mixed
{
    // Réserver l’écriture avant toute lecture, pour que les autres workers puissent attendre.
    $db->exec('BEGIN IMMEDIATE');
    try {
        $result = $operation();
        $db->exec('COMMIT');
        return $result;
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}

function query(PDO $db, string $sql, array $args = []): PDOStatement
{
    $statement = $db->prepare($sql);
    $statement->execute($args);
    return $statement;
}
