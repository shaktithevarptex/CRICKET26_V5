<?php
// ── nightly_sync.php ─────────────────────────────────────────────────────────
// Runs every night at 23:50 IST (18:20 UTC).
// Fetches scorecards for TODAY's unscored matches and applies points to
// the correct tournament's players only.
//
// Cron: 20 18 * * * php /var/www/html/cricket-fantasy/api/nightly_sync.php
// HTTP: GET /api/nightly_sync.php?secret=cricket_nightly_2026[&tournament_id=1]
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';

$secret = getenv('NIGHTLY_SECRET') ?: 'cricket_nightly_2026';
if(php_sapi_name() !== 'cli'){
  if(($_GET['secret'] ?? '') !== $secret){
    http_response_code(403); echo json_encode(['status'=>'failure','reason'=>'Forbidden']); exit;
  }
}

// Optional: restrict to one tournament
$filterTournamentId = isset($_GET['tournament_id']) ? (int)$_GET['tournament_id'] : null;

set_time_limit(300);

$log          = [];
$matchesFound = 0;
$matchesScored= 0;
$hitsUsed     = 0;
$errors       = [];
$startTime    = new DateTime();

// ── Scorecard API key ────────────────────────────────────────────────────────
$keyRow = $pdo->query("SELECT api_key FROM api_keys WHERE label='scorecard' LIMIT 1")->fetch();
$apiKey = $keyRow['api_key'] ?? '';
if(!$apiKey){
  echo json_encode(['status'=>'failure','reason'=>'No scorecard API key in api_keys table']); exit;
}

// ── Find today's unscored matches (per tournament) ──────────────────────────
$whereT = $filterTournamentId ? 'AND m.tournament_id = '.(int)$filterTournamentId : '';
$stmt = $pdo->query(
  "SELECT m.id AS db_id, m.external_id, m.name, m.tournament_id
   FROM matches m
   WHERE DATE(m.date) = CURDATE()
     AND m.is_scored  = 0
     AND m.external_id IS NOT NULL
     AND m.external_id != ''
     {$whereT}
   ORDER BY m.tournament_id ASC, m.date ASC"
);
$todayMatches = $stmt->fetchAll();
$matchesFound = count($todayMatches);

$log[] = date('Y-m-d H:i:s').' — Nightly sync started';
$log[] = "Today's unscored matches: {$matchesFound}";

if(!$matchesFound){
  logRun($pdo,$startTime,0,0,0,[]);
  echo json_encode(['status'=>'success','log'=>$log,'scored'=>0]); exit;
}

// ── Process each match ───────────────────────────────────────────────────────
foreach($todayMatches as $match){
  $mid   = $match['external_id'];
  $tid   = (int)$match['tournament_id'];
  $dbId  = (int)$match['db_id'];
  $name  = $match['name'];

  $log[] = "  [{$tid}] {$name}";

  // Fetch scorecard
  $url = "https://api.cricapi.com/v1/match_scorecard?apikey=".urlencode($apiKey)."&id=".urlencode($mid);
  $ctx = stream_context_create(['http'=>['timeout'=>25,'ignore_errors'=>true]]);
  $txt = @file_get_contents($url, false, $ctx);
  $hitsUsed++;

  if(!$txt){ $errors[] = "No response for {$mid}"; $log[] = "    ❌ No response"; continue; }
  $j = json_decode($txt, true);
  if(!$j || ($j['status']??'') !== 'success'){
    $errors[] = "API failure {$mid}: ".($j['reason']??'?');
    $log[] = "    ❌ ".$j['reason']; continue;
  }

  $data      = $j['data'] ?? [];
  $scorecard = $data['scorecard'] ?? [];

  if(empty($data['matchEnded'])){
    $log[] = "    ⏳ Not ended yet";
    if(!empty($data['matchStarted'])){
      $pdo->prepare('UPDATE matches SET status=? WHERE id=?')->execute(['live',$dbId]);
    }
    continue;
  }
  if(empty($scorecard)){ $errors[] = "Empty scorecard {$mid}"; $log[] = "    ⚠️ Empty scorecard"; continue; }

  // ── Load only players belonging to THIS tournament ────────────────────────
  $pStmt = $pdo->prepare(
    'SELECT p.*, t2.id AS team_id
     FROM players p
     JOIN teams t2 ON t2.id = p.team_id
     WHERE t2.tournament_id = ?'
  );
  $pStmt->execute([$tid]);
  $allPlayers = $pStmt->fetchAll();

  $updateP = $pdo->prepare(
    'UPDATE players
     SET total_points    = ?,
         batting_points  = ?,
         bowling_points  = ?,
         fielding_points = ?,
         match_points    = ?,
         cricket_team    = COALESCE(NULLIF(cricket_team,""), ?)
     WHERE id = ?'
  );

  $totalNewPts = 0;

  foreach($allPlayers as $p){
    $pname    = normName($p['name']);
    $bat=0; $bowl=0; $field=0;
    $cricTeam = $p['cricket_team'] ?? '';

    foreach($scorecard as $inn){
      // "India Inning 1" → "India"
      $innTeam = trim(preg_replace('/\s*(\d+\w*)?\s*(inning|innings).*/i','',$inn['inning']??''));

      foreach(($inn['batting']??[]) as $b){
        $bn = normName($b['batsman']['name'] ?? $b['name'] ?? '');
        if($bn !== $pname) continue;
        if(!$cricTeam && $innTeam) $cricTeam = $innTeam;
        $runs  = (int)($b['r']??0); $balls=(int)($b['b']??0);
        $fours = (int)($b['4s']??0); $sixes=(int)($b['6s']??0);
        $sr    = isset($b['sr'])?(float)$b['sr']:($balls>0?$runs/$balls*100:0);
        $duck  = $runs===0 && $balls>0;
        $notout= str_contains(strtolower($b['dismissal-text']??''),'not out');
        $bat  += calcBat($runs,$balls,$fours,$sixes,$sr,$duck,$notout);
      }

      foreach(($inn['bowling']??[]) as $bw){
        $bn = normName($bw['bowler']['name'] ?? $bw['name'] ?? '');
        if($bn !== $pname) continue;
        $wkts   = (int)($bw['w']??0); $maiden=(int)($bw['m']??0); $runsg=(int)($bw['r']??0);
        $oStr   = (string)($bw['o']??'0');
        $ovDec  = parseOvers($oStr);
        $eco    = isset($bw['eco'])?(float)$bw['eco']:($ovDec>0?$runsg/$ovDec:0);
        $bowl  += calcBowl($wkts,$maiden,$runsg,$ovDec,$eco);
      }

      foreach(($inn['catching']??[]) as $c){
        $cn = normName($c['catcher']['name'] ?? $c['name'] ?? '');
        if($cn !== $pname) continue;
        $field += (int)($c['catch']??0)*10 + (int)($c['runout']??0)*10 + (int)($c['stumped']??0)*15;
      }
    }

    if($bat===0 && $bowl===0 && $field===0) continue;

    $newPts = $bat+$bowl+$field;
    $totalNewPts += $newPts;

    // Merge into existing match_points — never overwrite other match entries
    $existMp = !empty($p['match_points']) ? json_decode($p['match_points'],true) : [];
    $existMp[$mid] = ['batting'=>$bat,'bowling'=>$bowl,'fielding'=>$field];

    $updateP->execute([
      $p['total_points']    + $newPts,
      $p['batting_points']  + $bat,
      $p['bowling_points']  + $bowl,
      $p['fielding_points'] + $field,
      json_encode($existMp, JSON_UNESCAPED_SLASHES),
      $cricTeam,
      $p['id']
    ]);
  }

  // ── Mark match scored + cache scorecard ──────────────────────────────────
  $pdo->prepare(
    'UPDATE matches
     SET is_scored=1, status=?, result=?, scorecard_raw=?, team_info=?
     WHERE id=?'
  )->execute([
    'completed',
    $data['status'] ?? '',
    json_encode($data, JSON_UNESCAPED_SLASHES),
    json_encode($data['teamInfo'] ?? [], JSON_UNESCAPED_SLASHES),
    $dbId
  ]);

  $matchesScored++;
  $log[] = "    ✅ +{$totalNewPts} pts";
}

logRun($pdo,$startTime,$matchesFound,$matchesScored,$hitsUsed,$errors);
$log[] = "Done. Scored {$matchesScored}/{$matchesFound}. Hits: {$hitsUsed}";

echo json_encode([
  'status'=>'success',
  'matches_found' =>$matchesFound,
  'matches_scored'=>$matchesScored,
  'api_hits_used' =>$hitsUsed,
  'errors'        =>$errors,
  'log'           =>$log,
], JSON_UNESCAPED_SLASHES);

// ── Helpers ──────────────────────────────────────────────────────────────────
function normName(string $s): string { return preg_replace('/[^a-z]/','',strtolower($s)); }

function parseOvers(string $s): float {
  $p = explode('.',$s); return (int)$p[0] + ((int)($p[1]??0))/6;
}

function calcBat(int $r,int $b,int $fs,int $ss,float $sr,bool $duck,bool $no):int {
  $J = $duck?-10:$r; $K=0;
  foreach([25,50,75,100,125,150,175,200] as $t){ if($r>=$t) $K+=25; }
  $L=0;
  if($sr<75)  $L-=20; if($sr<100) $L-=10; if($sr<=125) $L-=10;
  if($sr>=150)$L+=10; if($sr>=175)$L+=10; if($sr>=200) $L+=20;
  if($sr>=250)$L+=20; if($sr>=300)$L+=20; if($sr>=350) $L+=20; if($sr>=400)$L+=20;
  $M=$b>=25?$L:0;
  return $J+$K+$M+($fs*1)+($ss*2);
}

function calcBowl(int $w,int $m,int $r,float $ov,float $eco):int {
  $pts=$w*25;
  if($w>=5) $pts+=100; elseif($w>=4) $pts+=75; elseif($w>=3) $pts+=50;
  $pts+=$m*40;
  if($ov>=2){
    if($eco<6) $pts+=20; elseif($eco<8) $pts+=10;
    elseif($eco<=10) $pts+=0; elseif($eco<=12) $pts-=10; else $pts-=20;
  }
  return $pts;
}

function logRun(PDO $pdo,DateTime $s,int $f,int $sc,int $h,array $e):void{
  try{
    $pdo->prepare(
      'INSERT INTO nightly_job_log
         (run_date,started_at,finished_at,matches_found,matches_scored,api_hits_used,errors,created_at)
       VALUES (CURDATE(),?,NOW(),?,?,?,?,?)'
    )->execute([$s->format('Y-m-d H:i:s'),$f,$sc,$h,$e?implode("\n",$e):null,time()]);
  }catch(Exception $e){}
}
