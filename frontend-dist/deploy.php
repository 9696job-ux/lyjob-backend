<?php
// Script de auto-deploy - descarga el index.js de GitHub y lo guarda localmente
$token = $_GET['t'] ?? '';
if ($token !== 'lyjob_deploy_2026') {
    http_response_code(403);
    die('Forbidden');
}

$files = [
    'index.js'  => 'https://raw.githubusercontent.com/9696job-ux/lyjob-backend/main/frontend-dist/index.js',
    'index.css' => 'https://raw.githubusercontent.com/9696job-ux/lyjob-backend/main/frontend-dist/index.css',
];

$results = [];
foreach ($files as $filename => $url) {
    $content = file_get_contents($url);
    if ($content === false) {
        $results[$filename] = 'ERROR: no se pudo descargar';
        continue;
    }
    $path = __DIR__ . '/assets/' . $filename;
    $ok = file_put_contents($path, $content);
    $results[$filename] = $ok !== false ? "OK ({$ok} bytes)" : 'ERROR: no se pudo escribir';
}

header('Content-Type: application/json');
echo json_encode(['status' => 'ok', 'files' => $results, 'time' => date('Y-m-d H:i:s')]);
