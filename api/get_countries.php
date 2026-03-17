<?php
// Proxy/cache for CricAPI countries list with flags.
// Usage: GET api/get_countries.php?apikey=YOUR_KEY[&force=1]
set_time_limit(30);
header('Content-Type: application/json');
$apikey = isset($_GET['apikey']) ? $_GET['apikey'] : null;
if(!$apikey){ http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'apikey required']); exit; }
$force = isset($_GET['force']) && ($_GET['force']=='1' || $_GET['force']=='true');
$cacheDir = __DIR__ . '/cache';
if(!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);
$cacheFile = $cacheDir . '/countries.json';
if(!$force && file_exists($cacheFile)){
  $txt = @file_get_contents($cacheFile);
  if($txt){ echo $txt; exit; }
}
$url = 'https://api.cricapi.com/v1/countries?apikey='.urlencode($apikey).'&offset=0';
$ctx = stream_context_create(['http'=>['timeout'=>20]]);
$txt = @file_get_contents($url, false, $ctx);
if(!$txt){ http_response_code(502); echo json_encode(['status'=>'failure','reason'=>'could not fetch from cricapi']); exit; }
$j = json_decode($txt, true);
if(!$j || !isset($j['status'])){ http_response_code(502); echo json_encode(['status'=>'failure','reason'=>'invalid response']); exit; }
// normalize to simple map for easier lookups
$map = [];
if(isset($j['data']) && is_array($j['data'])){
  foreach($j['data'] as $c){
    if(!isset($c['name'])) continue;
    $id = isset($c['id']) ? $c['id'] : null;
    $name = $c['name'];
    $generic = isset($c['genericFlag']) ? $c['genericFlag'] : null;
    $fanart = isset($c['fanartFlag']) ? $c['fanartFlag'] : null;
    $map[strtolower($name)] = ['id'=>$id,'name'=>$name,'genericFlag'=>$generic,'fanartFlag'=>$fanart];
    if($id) $map[strtolower($id)] = ['id'=>$id,'name'=>$name,'genericFlag'=>$generic,'fanartFlag'=>$fanart];
  }
}
$out = ['status'=>'success','fetched'=>count($map),'data'=>$map,'raw'=>$j];
$dump = json_encode($out, JSON_UNESCAPED_SLASHES);
@file_put_contents($cacheFile, $dump);
echo $dump;
