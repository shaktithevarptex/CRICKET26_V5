<?php
require 'db.php';

// This script fetches the full CricAPI players list (paginated) and maps names -> country,
// then updates `players` rows in DB where country is empty.
// Usage: invoke from browser or CLI: http://localhost/cricket26_v2/api/backfill_countries.php

set_time_limit(0);
$apikey = isset($_GET['apikey']) ? $_GET['apikey'] : null;
if(!$apikey) { http_response_code(400); echo json_encode(['status'=>'failure','reason'=>'apikey required as query param']); exit; }

// ensure column exists
try{
  $pdo->exec("ALTER TABLE players ADD COLUMN IF NOT EXISTS country VARCHAR(255) DEFAULT NULL");
} catch(Exception $e){ /* ignore if not supported */ }
try{ $pdo->exec("ALTER TABLE players ADD COLUMN IF NOT EXISTS country_flag_url VARCHAR(512) DEFAULT NULL"); } catch(Exception $e){}
try{ $pdo->exec("ALTER TABLE players ADD COLUMN IF NOT EXISTS player_info JSON DEFAULT NULL"); } catch(Exception $e){}

// fetch players list pages
$playersMap = []; // norm(name) => country
$pageSize = 1000;
$offset = 0;
$maxIterations = 100; // safety
for($i=0;$i<$maxIterations;$i++){
  $url = "https://api.cricapi.com/v1/players?apikey=".urlencode($apikey)."&offset=".intval($offset);
  $ctx = stream_context_create(['http'=>['timeout'=>10]]);
  $txt = @file_get_contents($url, false, $ctx);
  if(!$txt) break;
  $j = json_decode($txt, true);
  if(!$j || !isset($j['data']) || !is_array($j['data']) || count($j['data'])==0) break;
  foreach($j['data'] as $p){
    if(!isset($p['name'])) continue;
    $name = trim($p['name']);
    $country = '';
    $playerInfo = $p; // store the list entry by default
    if(isset($p['country'])) $country = $p['country'];
    elseif(isset($p['country_name'])) $country = $p['country_name'];
    if($country === null) $country = '';
    $key = preg_replace('/[^a-z]/','',strtolower($name));
    if($key) $playersMap[$key] = ['country'=>$country,'info'=>$playerInfo];
  }
  if(count($j['data']) < $pageSize) break;
  $offset += $pageSize;
}

// Now update DB players where country is null or empty
$stmt = $pdo->query('SELECT id, name, team_id FROM players');
$all = $stmt->fetchAll();
$updated = 0;
$notfound = [];
// update with country, flag url and player info JSON
$updateStmt = $pdo->prepare('UPDATE players SET country = ?, country_flag_url = ?, player_info = ? WHERE id = ?');
// try to load countries cache (created by get_countries.php)
$countries = [];
$cacheFile = __DIR__ . '/cache/countries.json';
if(file_exists($cacheFile)){
  $txt = @file_get_contents($cacheFile);
  if($txt){
    $cj = json_decode($txt, true);
    if(isset($cj['data']) && is_array($cj['data'])) $countries = $cj['data'];
  }
}
// fallback: try fetching via local proxy endpoint if cache missing
if(empty($countries)){
  $proxyUrl = (isset($_SERVER['REQUEST_SCHEME']) ? $_SERVER['REQUEST_SCHEME'] : 'http') . '://' . $_SERVER['HTTP_HOST'] . dirname($_SERVER['REQUEST_URI']) . '/get_countries.php?apikey=' . urlencode($apikey);
  $ctx = stream_context_create(['http'=>['timeout'=>10]]);
  $txt = @file_get_contents($proxyUrl, false, $ctx);
  if($txt){
    $cj = json_decode($txt, true);
    if(isset($cj['data']) && is_array($cj['data'])) $countries = $cj['data'];
  }
}
foreach($all as $row){
  $name = trim($row['name']);
  $key = preg_replace('/[^a-z]/','',strtolower($name));
  $country = '';
  $playerInfo = null;
  if($key && isset($playersMap[$key])){
    $country = $playersMap[$key]['country'];
    $playerInfo = $playersMap[$key]['info'];
  }
  if(!$country){ $notfound[] = $name; continue; }
  // determine flag url: prefer CricAPI genericFlag if available
  $flagUrl = null;
  $lc = strtolower(trim($country));
  if($lc && isset($countries[$lc]) && isset($countries[$lc]['genericFlag']) && $countries[$lc]['genericFlag']){
    $flagUrl = $countries[$lc]['genericFlag'];
    // prefer canonical name from countries mapping
    if(isset($countries[$lc]['name'])) $country = $countries[$lc]['name'];
  } else {
    // also try matching by ISO id keys in the map
    if($lc && isset($countries[$lc])){
      $flagUrl = isset($countries[$lc]['genericFlag']) ? $countries[$lc]['genericFlag'] : null;
    }
  }
  if(!$flagUrl){
    // fallback: best-effort external flag service
    $flagUrl = 'https://countryflagsapi.com/png/'.rawurlencode($country);
  }
  $playerInfoJson = $playerInfo ? json_encode($playerInfo) : null;
  $updateStmt->execute([$country, $flagUrl, $playerInfoJson, $row['id']]);
  $updated++;
}

echo json_encode(['status'=>'success','fetchedPlayers'=>count($playersMap),'updated'=>$updated,'notFoundCount'=>count($notfound),'notFoundSample'=>array_slice($notfound,0,10)]);
