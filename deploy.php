<?php
$token = $_GET['t'] ?? '';
if ($token !== 'lyjob_deploy_2026') { http_response_code(403); die('Forbidden'); }

$base = 'https://raw.githubusercontent.com/9696job-ux/lyjob-backend/main/frontend-dist';
$assetsDir = __DIR__ . '/assets/';
$results = [];
$ts = time();

// Descargar index.js e index.css
foreach (['index.js', 'index.css'] as $f) {
  $ch = curl_init("$base/$f");
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>120,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_SSL_VERIFYPEER=>false,CURLOPT_USERAGENT=>'Mozilla/5.0']);
  $c = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if (!$c || $code !== 200 || strlen($c) < 5000) { $results[$f] = "ERROR code=$code"; continue; }
  file_put_contents($assetsDir . $f, $c);
  $results[$f] = "OK " . strlen($c) . " bytes";
}

// Auto-actualizar el deploy.php con la versión de GitHub
$deployPhp = curl_init("$base/deploy.php");
curl_setopt_array($deployPhp, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_SSL_VERIFYPEER=>false]);
$newDeploy = curl_exec($deployPhp);
curl_close($deployPhp);
if ($newDeploy && strlen($newDeploy) > 100) {
  file_put_contents(__FILE__, $newDeploy);
  $results['deploy.php'] = "OK self-updated";
}

// Actualizar index.html con nuevo timestamp (forza al browser a recargar el JS)
$html = '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Lyjob - Sistema Tributario Ecuador</title><script type="module" crossorigin src="/assets/index.js?v=' . $ts . '"></script><link rel="stylesheet" crossorigin href="/assets/index.css?v=' . $ts . '"></head><body><div id="root"></div></body></html>';
$ok = file_put_contents(__DIR__ . '/index.html', $html);
$results['index.html'] = $ok !== false ? "OK ts=$ts" : 'ERROR write';

header('Content-Type: application/json');
echo json_encode(['status'=>'ok','files'=>$results,'time'=>date('Y-m-d H:i:s'),'php'=>phpversion()]);
