/**
 * CONTENT DATABASE — everything but the graphics.
 *
 * Everything here is a discrete, countable design data point: teams, kit palettes,
 * ratings, 240 squad players with generated stat lines, formations, tactic sliders,
 * the options tree, the laws-of-the-game toggles, AI personality archetypes,
 * commentary banks, venues, trophies and competition rules.
 */

/* ============================ 1. SQUADS & NATIONS ============================ */

export interface KitPalette {
  kit: string; kitDark: string; kitLight: string; trim: string; shorts: string; socks: string;
}

export interface Nation {
  id: string;
  name: string;
  short: string;          // 3-letter broadcast tag
  nickname: string;
  hemisphere: 'NORTH' | 'SOUTH';
  confederation: string;
  crowd: number;          // 0..1 travelling support for crowd-noise mix
  venue: string;
  venueCap: number;
  /** 12 rated attributes, 0..100 */
  att: {
    scrum: number; lineout: number; maul: number; ruck: number;
    defence: number; attack: number; kicking: number; discipline: number;
    fitness: number; pace: number; handling: number; creativity: number;
  };
  /** AI personality picked by the CPU */
  archetype: 'BOULDER ATHLETIC' | 'IRONSIDE TECHNICAL' | 'TEMPO WIDE' | 'TERRITORY KICK' | 'CHAOS OFFLOAD';
  squad: SquadPlayer[];
}

export interface SquadPlayer {
  num: number; name: string; pos: string; star: 0 | 1 | 2;
  stats: { SPD: number; PWR: number; SKL: number; KCK: number; STA: number; TTL: number };
}

export const POSITION_NAMES: Record<number, string> = {
  1: 'PROP', 2: 'HOOKER', 3: 'PROP', 4: 'LOCK', 5: 'LOCK',
  6: 'FLANKER', 7: 'FLANKER', 8: 'NO.8', 9: 'SCRUM HALF', 10: 'FLY HALF',
  11: 'WING', 12: 'INSIDE CENTRE', 13: 'OUTSIDE CENTRE', 14: 'WING', 15: 'FULLBACK',
};

/** Position weightings: how each of the six player stats leans by shirt number. */
export const POSITION_WEIGHTS: Record<number, { SPD: number; PWR: number; SKL: number; KCK: number; STA: number; TTL: number }> = {
  1: { SPD: 0.45, PWR: 1.00, SKL: 0.55, KCK: 0.10, STA: 0.80, TTL: 0.85 },
  2: { SPD: 0.50, PWR: 0.95, SKL: 0.70, KCK: 0.10, STA: 0.85, TTL: 0.85 },
  3: { SPD: 0.45, PWR: 1.00, SKL: 0.55, KCK: 0.10, STA: 0.80, TTL: 0.85 },
  4: { SPD: 0.60, PWR: 0.95, SKL: 0.60, KCK: 0.20, STA: 0.85, TTL: 0.90 },
  5: { SPD: 0.62, PWR: 0.92, SKL: 0.65, KCK: 0.25, STA: 0.88, TTL: 0.88 },
  6: { SPD: 0.82, PWR: 0.82, SKL: 0.78, KCK: 0.25, STA: 0.95, TTL: 0.95 },
  7: { SPD: 0.88, PWR: 0.75, SKL: 0.85, KCK: 0.25, STA: 0.98, TTL: 0.98 },
  8: { SPD: 0.80, PWR: 0.90, SKL: 0.80, KCK: 0.35, STA: 0.90, TTL: 0.92 },
  9: { SPD: 0.90, PWR: 0.55, SKL: 0.98, KCK: 0.60, STA: 0.95, TTL: 0.75 },
  10: { SPD: 0.72, PWR: 0.55, SKL: 0.98, KCK: 1.00, STA: 0.85, TTL: 0.65 },
  11: { SPD: 1.00, PWR: 0.55, SKL: 0.82, KCK: 0.60, STA: 0.88, TTL: 0.70 },
  12: { SPD: 0.85, PWR: 0.80, SKL: 0.88, KCK: 0.70, STA: 0.85, TTL: 0.85 },
  13: { SPD: 0.95, PWR: 0.68, SKL: 0.90, KCK: 0.60, STA: 0.88, TTL: 0.80 },
  14: { SPD: 1.00, PWR: 0.55, SKL: 0.82, KCK: 0.60, STA: 0.88, TTL: 0.70 },
  15: { SPD: 0.92, PWR: 0.65, SKL: 0.92, KCK: 0.85, STA: 0.90, TTL: 0.78 },
};

/** Deterministic hash so every squad regenerates identically every session. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function makeSquad(id: string, names: string[], stars: Record<number, 0 | 1 | 2>): SquadPlayer[] {
  return names.map((nm, i) => {
    const num = i + 1;
    const w = POSITION_WEIGHTS[num];
    const seed = hash(`${id}-${num}-${nm}`);
    const star = stars[num] ?? 0;
    const jitter = (seed - 0.5) * 14;
    const mk = (wv: number, floor = 34) => Math.round(Math.min(99, Math.max(floor, 42 + wv * 46 + jitter + star * 7)));
    return {
      num, name: nm, pos: POSITION_NAMES[num], star,
      stats: {
        SPD: mk(w.SPD), PWR: mk(w.PWR), SKL: mk(w.SKL),
        KCK: mk(w.KCK, 12), STA: mk(w.STA), TTL: mk(w.TTL),
      },
    };
  });
}

function att(o: Partial<Nation['att']>): Nation['att'] {
  return {
    scrum: 60, lineout: 60, maul: 60, ruck: 60, defence: 60, attack: 60,
    kicking: 60, discipline: 60, fitness: 60, pace: 60, handling: 60, creativity: 60, ...o,
  };
}

const RAW: Array<{
  id: string; name: string; short: string; nickname: string; hemi: 'NORTH' | 'SOUTH'; conf: string;
  crowd: number; venue: string; cap: number; arch: Nation['archetype']; a: Nation['att'];
  names: string[]; stars: Record<number, 0 | 1 | 2>;
}> = [
  {
    id: 'ENG', name: 'ENGLAND', short: 'ENG', nickname: 'THE RED ROSE', hemi: 'NORTH', conf: 'FIVE NATIONS',
    crowd: 0.9, venue: 'TWICKENHAM', cap: 72000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 88, lineout: 82, maul: 84, ruck: 86, defence: 92, attack: 78, kicking: 88, discipline: 90, fitness: 88, pace: 72, handling: 76, creativity: 66 }),
    names: ['JASON LEONARD', 'BRIAN MOORE', 'PAUL RENDALL', 'WADE DOOLEY', 'MICK SKINNER', 'PETER WINTERBOTTOM', 'JOHN HALL', 'MIKE TEAGUE', 'RICHARD HILL', 'ROB ANDREW', 'RORY UNDERWOOD', 'WILL CARLING', 'JEREMY GUSCOTT', 'SIMON HALLIDAY', 'JONATHAN WEBB'],
    stars: { 1: 2, 2: 2, 6: 2, 9: 1, 10: 2, 11: 2, 12: 2, 13: 2 },
  },
  {
    id: 'AUS', name: 'AUSTRALIA', short: 'AUS', nickname: 'THE WALLABIES', hemi: 'SOUTH', conf: 'SOUTH PACIFIC',
    crowd: 0.6, venue: 'BALLYMORE', cap: 24000, arch: 'IRONSIDE TECHNICAL',
    a: att({ scrum: 68, lineout: 84, maul: 66, ruck: 90, defence: 88, attack: 94, kicking: 92, discipline: 86, fitness: 90, pace: 90, handling: 94, creativity: 92 }),
    names: ['TONY DALY', 'TOM LAWTON', 'EWEN MCKENZIE', 'JOHN EALES', 'ROD MCCALL', 'JEFF MILLER', 'DAVID WILSON', 'SAM SCOTT-YOUNG', 'NICK FARR-JONES', 'MICHAEL LYNAGH', 'DAVID CAMPESE', 'JASON LITTLE', 'TIM HORAN', 'IAN WILLIAMS', 'GLEN ELLA'],
    stars: { 4: 2, 9: 2, 10: 2, 11: 2, 13: 2, 15: 1 },
  },
  {
    id: 'NZL', name: 'NEW ZEALAND', short: 'NZL', nickname: 'ALL BLACKS', hemi: 'SOUTH', conf: 'SOUTH PACIFIC',
    crowd: 0.7, venue: 'EDEN PARK', cap: 60000, arch: 'CHAOS OFFLOAD',
    a: att({ scrum: 86, lineout: 80, maul: 78, ruck: 92, defence: 90, attack: 96, kicking: 80, discipline: 74, fitness: 94, pace: 96, handling: 92, creativity: 94 }),
    names: ['STEVE McDOWALL', 'SEAN FITZPATRICK', 'JOHN DRAKE', 'IAN JONES', 'GARY WHETTON', 'ALAN WHETTON', 'MICHAEL JONES', 'ZINZAN BROOKE', 'GRAEME BACHOP', 'GRANT FOX', 'JOHN TIMU', 'WALTER LITTLE', 'FRANK BUNCE', 'ERIC RUSH', 'TERRY WRIGHT'],
    stars: { 2: 2, 7: 2, 8: 2, 10: 2, 13: 2 },
  },
  {
    id: 'FRA', name: 'FRANCE', short: 'FRA', nickname: 'LES BLEUS', hemi: 'NORTH', conf: 'FIVE NATIONS',
    crowd: 0.8, venue: 'PARC DES PRINCES', cap: 48000, arch: 'CHAOS OFFLOAD',
    a: att({ scrum: 90, lineout: 74, maul: 82, ruck: 78, defence: 80, attack: 92, kicking: 78, discipline: 62, fitness: 82, pace: 88, handling: 92, creativity: 98 }),
    names: ['LOUIS ARMARY', 'VINCENT MOSCATO', 'JEAN-PIERRE GARUET', 'OLIVIER ROUMAT', 'ABDEL BENAZZI', 'ERIC CHAMP', 'MARC CECILLON', 'LAURENT SEIGNE', 'PIERRE BERBIZIER', 'DIDIER CAMBERABERO', 'PHILIPPE SAINT-ANDRE', 'FRANCK MESNEL', 'THIERRY CLERMONT', 'PATRICE BIDABE', 'SERGE BLANCO'],
    stars: { 1: 1, 4: 2, 11: 2, 12: 2, 15: 2 },
  },
  {
    id: 'SCO', name: 'SCOTLAND', short: 'SCO', nickname: 'THE THISTLE', hemi: 'NORTH', conf: 'FIVE NATIONS',
    crowd: 0.8, venue: 'MURRAYFIELD', cap: 67000, arch: 'TERRITORY KICK',
    a: att({ scrum: 76, lineout: 78, maul: 74, ruck: 78, defence: 82, attack: 74, kicking: 90, discipline: 84, fitness: 80, pace: 74, handling: 76, creativity: 70 }),
    names: ['DAVID SOLE', 'KENNY MILNE', 'PAUL BURNELL', 'DAMIAN CRONIN', 'ANDY REID', 'FINLAY CALDER', 'DEREK WHITE', 'JOHN JEFFREY', 'GARY ARMSTRONG', 'CRAIG CHALMERS', 'SEAN LINEEN', 'SCOTT HASTINGS', 'DODIE WEIR', 'IAN SMITH', 'GAVIN HASTINGS'],
    stars: { 8: 2, 12: 2, 15: 2 },
  },
  {
    id: 'IRE', name: 'IRELAND', short: 'IRE', nickname: 'THE SHAMROCK', hemi: 'NORTH', conf: 'FIVE NATIONS',
    crowd: 0.75, venue: 'LANSDOWNE ROAD', cap: 49000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 74, lineout: 80, maul: 78, ruck: 76, defence: 78, attack: 72, kicking: 82, discipline: 78, fitness: 76, pace: 72, handling: 76, creativity: 72 }),
    names: ['NICK POPPLEWELL', 'GERALD McCAULEY', 'DES FITZGERALD', 'DONAL LENIHAN', 'NEIL FRANCIS', 'PHILIP DANHER', 'BRIAN ROBINSON', 'NOEL MANNION', 'ROB SAUNDERS', 'RALPH KEYES', 'MICHAEL BRADLEY', 'BRENDAN MULLIN', 'MICHAEL GIBSON', 'JIM STAPLES', 'TREVOR RINGLAND'],
    stars: { 4: 2, 12: 2, 13: 1 },
  },
  {
    id: 'WAL', name: 'WALES', short: 'WAL', nickname: 'THE DRAGONS', hemi: 'NORTH', conf: 'FIVE NATIONS',
    crowd: 0.85, venue: 'CARDIFF ARMS PARK', cap: 53000, arch: 'TEMPO WIDE',
    a: att({ scrum: 70, lineout: 72, maul: 72, ruck: 76, defence: 74, attack: 84, kicking: 76, discipline: 74, fitness: 76, pace: 86, handling: 86, creativity: 84 }),
    names: ['JOHN DAVIES', 'ALAN PHILLIPS', 'RICKY EVANS', 'GARETH THOMAS', 'GARETH LLEWELLYN', 'MARK JONES', 'EMRYR LEWIS', 'SCOTT QUINNELL', 'ROBERT JONES', 'SIMON HODGKINSON', 'IEUAN EVANS', 'MIKE HALL', 'MARK RING', 'ADRIAN HADLEY', 'MIKE RAYER'],
    stars: { 8: 2, 9: 2, 11: 2, 13: 1 },
  },
  {
    id: 'SAM', name: 'WESTERN SAMOA', short: 'SAM', nickname: 'MANU SAMOA', hemi: 'SOUTH', conf: 'SOUTH PACIFIC',
    crowd: 0.5, venue: 'APIA PARK', cap: 12000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 84, lineout: 66, maul: 86, ruck: 84, defence: 86, attack: 82, kicking: 58, discipline: 58, fitness: 78, pace: 88, handling: 74, creativity: 72 }),
    names: ['APOLLO PERELINI', 'BRIAN LIMA', 'PAT LAM', 'MATTHEW VAEA', 'STEVE BACHOP', 'ELI FUAVAI', 'SILA VAIFALE', 'FATA FEFUANGA', 'TU NUUALIITA', 'TOA SAMANIA', 'MULIOO TEOLO', 'FRANK BUNCE-LEOTA', 'TANA UMAGA-JUNR', 'LEO LAFAELE', 'VAEGA TUIGAMALA'],
    stars: { 2: 2, 3: 2, 4: 1 },
  },
  {
    id: 'FIJ', name: 'FIJI', short: 'FIJ', nickname: 'THE FLYING FIJIANS', hemi: 'SOUTH', conf: 'SOUTH PACIFIC',
    crowd: 0.45, venue: 'BUCA BAY', cap: 15000, arch: 'CHAOS OFFLOAD',
    a: att({ scrum: 70, lineout: 62, maul: 68, ruck: 72, defence: 72, attack: 92, kicking: 54, discipline: 60, fitness: 74, pace: 98, handling: 90, creativity: 92 }),
    names: ['NOA NADRUKU', 'JONE KUBU', 'MESAKE RASARI', 'ILE SEVULONI', 'VILIAME SATALA', 'SETA TAWAKE', 'MOSES RAVOUNA', 'ALIVERETI MAVULI', 'SEREVI WAISALE', 'NICKY LITTLE', 'MARika VUNIBAKA', 'EMU VULIVULI', 'MANOA BULU', 'JONETANI TUIKETE', 'FERO LASAGAVIBAU'],
    stars: { 9: 2, 11: 1, 15: 1 },
  },
  {
    id: 'CAN', name: 'CANADA', short: 'CAN', nickname: 'THE MAPLE LEAFS', hemi: 'NORTH', conf: 'NORTH AMERICA',
    crowd: 0.4, venue: 'VANCOUVER', cap: 18000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 78, lineout: 74, maul: 78, ruck: 78, defence: 80, attack: 70, kicking: 68, discipline: 80, fitness: 82, pace: 76, handling: 70, creativity: 64 }),
    names: ['ED HARRIGAN', 'MARK CARDIN', 'DAVE BARRINGHAM', 'AL CHARRON', 'MARK WYATT', 'GARETH REES-JONES', 'JOHN HUTCHINSON', 'DAN JACKART', 'JOHN GRAVES', 'GARETH REES', 'KARL JOHNSTON', 'IAN MURPHY', 'BOB SPROULE', 'JIM VAN DER WOUDE', 'SPENCER TUCKER'],
    stars: { 10: 2, 4: 1 },
  },
  {
    id: 'ARG', name: 'ARGENTINA', short: 'ARG', nickname: 'LOS PUMAS', hemi: 'SOUTH', conf: 'SOUTH AMERICA',
    crowd: 0.5, venue: 'BUENOS AIRES', cap: 30000, arch: 'TERRITORY KICK',
    a: att({ scrum: 82, lineout: 72, maul: 80, ruck: 76, defence: 78, attack: 76, kicking: 74, discipline: 72, fitness: 78, pace: 76, handling: 74, creativity: 70 }),
    names: ['MARCELO LOFFREDA', 'FEDERICO MENDEZ', 'PATRICIO NORIEGA', 'ALEJANDRO ALLUB', 'GABRIEL POUMMADER', 'SANTIAGO MESON', 'ROLANDO MARTIN', 'LISANDRO ARBIZU', 'AGUSTIN PICHOT', 'JOSE CILLEY', 'DIEGO ALLEMAN', 'DIEGO CERRATO', 'MARTIN GAITE', 'JUAN GOMEZ', 'IGNACIO FERNANDEZ'],
    stars: { 10: 1, 12: 1 },
  },
  {
    id: 'ITA', name: 'ITALY', short: 'ITA', nickname: 'GLI AZZURRI', hemi: 'NORTH', conf: 'EUROPE',
    crowd: 0.45, venue: 'STADIO FLAMINIO', cap: 24000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 76, lineout: 70, maul: 74, ruck: 72, defence: 74, attack: 68, kicking: 72, discipline: 74, fitness: 74, pace: 70, handling: 70, creativity: 66 }),
    names: ['IVAN FRANCESCO', 'MASSIMO GIOVANELLI', 'PIERPAOLO PEDRONI', 'CARLO CHECCHINATO', 'MARCELLO CUTTITTA', 'PAOLO GRASSI', 'MAURO BERGAMASCO', 'LUCA SANZOTTI', 'ALESSANDRO TRONCON', 'DIEGO DOMINGUEZ', 'MARCELLO CUTTITTA JR', 'LUDOVICO CLUTT', 'ROMANO BERTACCO', 'IVAN ONGARO', 'LUCA BARBA'],
    stars: { 10: 2, 8: 1 },
  },
  {
    id: 'JPN', name: 'JAPAN', short: 'JPN', nickname: 'THE CHERRY BLOSSOMS', hemi: 'NORTH', conf: 'ASIA',
    crowd: 0.35, venue: 'CHICHIBU', cap: 32000, arch: 'TEMPO WIDE',
    a: att({ scrum: 62, lineout: 66, maul: 62, ruck: 72, defence: 68, attack: 72, kicking: 74, discipline: 88, fitness: 86, pace: 82, handling: 82, creativity: 72 }),
    names: ['SEIJI HIRAO', 'SHOJI YAMAMOTO', 'TAKURO MIUCHI', 'HIROYUKI TANAKA', 'KENJI FUJITA', 'YUKIO MORI', 'TSUTOMU MATSUDA', 'HIROSHI UEDA', 'YOSHIHIRO YOSHIDA', 'TETSUJI KONDO', 'YOSHIHITO YOSHIDA', 'SHIGENORI FUKUYAMA', 'KAzuaki UEDA', 'TAKASHI KIKUCHI', 'NORIO KUBO'],
    stars: { 1: 2, 11: 1 },
  },
  {
    id: 'USA', name: 'UNITED STATES', short: 'USA', nickname: 'THE EAGLES', hemi: 'NORTH', conf: 'NORTH AMERICA',
    crowd: 0.3, venue: 'GLENDALE', cap: 12000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 66, lineout: 66, maul: 68, ruck: 68, defence: 70, attack: 68, kicking: 66, discipline: 74, fitness: 78, pace: 78, handling: 68, creativity: 64 }),
    names: ['BILL LEVERSEE', 'TOM SMITH-KELLER', 'MARK WILLIAMS', 'DAVE HODGES', 'LANCE THOMPSON', 'KEVIN FEELEY', 'BRIAN BURGER', 'TOM MYER', 'KEVIN DALY', 'MARK GRAZIANO', 'VAEA ANITONI', 'PAUL KEARNS', 'MARK SERVATIUS', 'CHRIS OATES', 'TOM BRIGGS'],
    stars: { 10: 1, 11: 1 },
  },
  {
    id: 'ROM', name: 'ROMANIA', short: 'ROM', nickname: 'THE OAKS', hemi: 'NORTH', conf: 'EUROPE',
    crowd: 0.3, venue: 'BUCHAREST', cap: 28000, arch: 'BOULDER ATHLETIC',
    a: att({ scrum: 80, lineout: 68, maul: 78, ruck: 70, defence: 70, attack: 64, kicking: 62, discipline: 70, fitness: 70, pace: 66, handling: 62, creativity: 58 }),
    names: ['HARALAMBIE DUMITRAS', 'GHEORGHE LEAHU', 'MIRCEA PARASCHIV', 'IONEL CIRSTEA', 'VASILE BOTEZ', 'DUMITRU IONESCU', 'FLORIN VLAD', 'SORIN BULGARU', 'ADRIAN DURCAK', 'MIHAI CIUBUC', 'GABRIEL SUCIU', 'COSTEL MUNTEANU', 'DAN NICULESCU', 'PAVEL BARBU', 'EUGEN CRUCEA'],
    stars: { 1: 2 },
  },
  {
    id: 'ZIM', name: 'ZIMBABWE', short: 'ZIM', nickname: 'THE SABLES', hemi: 'SOUTH', conf: 'AFRICA',
    crowd: 0.25, venue: 'HARARE SPORTS CLUB', cap: 10000, arch: 'TEMPO WIDE',
    a: att({ scrum: 60, lineout: 62, maul: 62, ruck: 64, defence: 62, attack: 66, kicking: 62, discipline: 70, fitness: 72, pace: 76, handling: 70, creativity: 66 }),
    names: ['ANDY FERREIRA', 'LEN VEENSTRA', 'GUY WATSON', 'BRENDAN DAWSON', 'MARK NEILL', 'RICHARD HOBBES', 'BRIAN MURPHY', 'GRAHAM BURROWS', 'KEVIN STEPHENS', 'ALEX NICHOLAS', 'TONY BROWN', 'RAY TOWNSEND', 'BRIAN BEAUMONT', 'STEVE FERREIRA', 'DAVID GOWER'],
    stars: {},
  },
];

export const TEAMS: Nation[] = RAW.map((r) => ({
  id: r.id, name: r.name, short: r.short, nickname: r.nickname,
  hemisphere: r.hemi, confederation: r.conf, crowd: r.crowd,
  venue: r.venue, venueCap: r.cap, archetype: r.arch, att: r.a,
  squad: makeSquad(r.id, r.names, r.stars),
}));

export const TEAM_BY_ID = (id: string) => TEAMS.find((t) => t.id === id) ?? TEAMS[0];
export const FIVE_NATIONS_IDS = ['ENG', 'FRA', 'IRE', 'SCO', 'WAL'];

/** 1991 Rugby World Cup seeding: four pools of four. */
export const WORLD_CUP_POOLS: string[][] = [
  ['NZL', 'ENG', 'USA', 'ITA'],
  ['AUS', 'SAM', 'ARG', 'ZIM'],
  ['SCO', 'IRE', 'JPN', 'ROM'],
  ['FRA', 'WAL', 'CAN', 'FIJ'],
];

/** League mode: pick any eight, play seven rounds. */
export const LEAGUE_DEFAULT = ['ENG', 'AUS', 'NZL', 'FRA', 'SCO', 'WAL', 'SAM', 'FIJ'];

/* ============================ 2. KIT PALETTES ============================ */

export const KITS: Record<string, KitPalette[]> = {
  ENG: [
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#c8402f', shorts: '#2b2f42', socks: '#f2f0e6' },
    { kit: '#c8402f', kitDark: '#8f281c', kitLight: '#e2664f', trim: '#f6e7c4', shorts: '#f0ece0', socks: '#c8402f' },
    { kit: '#2b2f42', kitDark: '#1b1e2c', kitLight: '#3d4462', trim: '#e8cf46', shorts: '#f0ece0', socks: '#2b2f42' },
  ],
  AUS: [
    { kit: '#f2c13d', kitDark: '#c99a22', kitLight: '#ffe07a', trim: '#1f6b4a', shorts: '#1f6b4a', socks: '#f2c13d' },
    { kit: '#1f6b4a', kitDark: '#154b35', kitLight: '#2f8f65', trim: '#f2c13d', shorts: '#f0ece0', socks: '#1f6b4a' },
    { kit: '#2f4f9c', kitDark: '#1d3468', kitLight: '#5a7bc4', trim: '#f2c13d', shorts: '#e8e4d6', socks: '#2f4f9c' },
  ],
  NZL: [
    { kit: '#1a1a20', kitDark: '#0d0d11', kitLight: '#2e2e38', trim: '#e8e4d6', shorts: '#1a1a20', socks: '#1a1a20' },
    { kit: '#5a5a68', kitDark: '#3c3c48', kitLight: '#78788a', trim: '#e8cf46', shorts: '#1a1a20', socks: '#5a5a68' },
  ],
  FRA: [
    { kit: '#2f4f9c', kitDark: '#1d3468', kitLight: '#5a7bc4', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#2f4f9c' },
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#2f4f9c', shorts: '#2f4f9c', socks: '#f2f0e6' },
    { kit: '#1a1a20', kitDark: '#0d0d11', kitLight: '#33333d', trim: '#e0503c', shorts: '#1a1a20', socks: '#1a1a20' },
  ],
  SCO: [
    { kit: '#24457c', kitDark: '#162c55', kitLight: '#3d63a0', trim: '#e8e4d6', shorts: '#f0ece0', socks: '#24457c' },
    { kit: '#8894a8', kitDark: '#5f6a7e', kitLight: '#b0bac9', trim: '#24457c', shorts: '#24457c', socks: '#8894a8' },
  ],
  IRE: [
    { kit: '#2e8b57', kitDark: '#1e6340', kitLight: '#45a86f', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#2e8b57' },
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#2e8b57', shorts: '#2e8b57', socks: '#f2f0e6' },
  ],
  WAL: [
    { kit: '#c8102e', kitDark: '#8f0a1f', kitLight: '#e2415b', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#c8102e' },
    { kit: '#1a1a20', kitDark: '#0d0d11', kitLight: '#33333d', trim: '#c8102e', shorts: '#c8102e', socks: '#1a1a20' },
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#c8102e', shorts: '#c8102e', socks: '#f2f0e6' },
  ],
  SAM: [
    { kit: '#1f4f9c', kitDark: '#143468', kitLight: '#4270c0', trim: '#e8e4d6', shorts: '#f0ece0', socks: '#1f4f9c' },
    { kit: '#e8e4d6', kitDark: '#c4c0ae', kitLight: '#ffffff', trim: '#1f4f9c', shorts: '#1f4f9c', socks: '#e8e4d6' },
  ],
  FIJ: [
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#1a1a20', shorts: '#1a1a20', socks: '#f2f0e6' },
    { kit: '#0f7b4f', kitDark: '#095637', kitLight: '#18a06a', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#0f7b4f' },
  ],
  CAN: [
    { kit: '#c8102e', kitDark: '#8f0a1f', kitLight: '#e2415b', trim: '#f0ece0', shorts: '#1a1a20', socks: '#c8102e' },
    { kit: '#f0ece0', kitDark: '#cfcbba', kitLight: '#ffffff', trim: '#c8102e', shorts: '#1a1a20', socks: '#f0ece0' },
  ],
  ARG: [
    { kit: '#7ba7d9', kitDark: '#4f7cae', kitLight: '#a2c5ec', trim: '#f2f0e6', shorts: '#1a1a20', socks: '#7ba7d9' },
    { kit: '#1a1a20', kitDark: '#0d0d11', kitLight: '#33333d', trim: '#7ba7d9', shorts: '#7ba7d9', socks: '#1a1a20' },
  ],
  ITA: [
    { kit: '#1f4f9c', kitDark: '#143468', kitLight: '#4270c0', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#1f4f9c' },
    { kit: '#f0ece0', kitDark: '#cfcbba', kitLight: '#ffffff', trim: '#1f4f9c', shorts: '#1f4f9c', socks: '#f0ece0' },
  ],
  JPN: [
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#c8102e', shorts: '#1a1a20', socks: '#f2f0e6' },
    { kit: '#c8102e', kitDark: '#8f0a1f', kitLight: '#e2415b', trim: '#f2f0e6', shorts: '#1a1a20', socks: '#c8102e' },
  ],
  USA: [
    { kit: '#1f2f5c', kitDark: '#141f40', kitLight: '#33457c', trim: '#c8102e', shorts: '#f0ece0', socks: '#1f2f5c' },
    { kit: '#f0ece0', kitDark: '#cfcbba', kitLight: '#ffffff', trim: '#1f2f5c', shorts: '#1f2f5c', socks: '#f0ece0' },
  ],
  ROM: [
    { kit: '#f2c13d', kitDark: '#c99a22', kitLight: '#ffe07a', trim: '#1f2f5c', shorts: '#1f2f5c', socks: '#f2c13d' },
    { kit: '#1f2f5c', kitDark: '#141f40', kitLight: '#33457c', trim: '#f2c13d', shorts: '#f2c13d', socks: '#1f2f5c' },
  ],
  ZIM: [
    { kit: '#f2f0e6', kitDark: '#d4d0be', kitLight: '#ffffff', trim: '#c8102e', shorts: '#1a1a20', socks: '#f2f0e6' },
    { kit: '#0f7b4f', kitDark: '#095637', kitLight: '#18a06a', trim: '#f2f0e6', shorts: '#f0ece0', socks: '#0f7b4f' },
  ],
};

/* ============================ 3. FORMATIONS ============================ */

export interface Formation {
  id: string;
  name: string;
  kind: 'BACKLINE' | 'LINEOUT' | 'SCRUM' | 'RESTART' | 'DEFENCE' | 'EXIT';
  blurb: string;
  /** per-shirt lateral offsets in metres from the mid-line of the attack */
  offsets: Record<number, number>;
  depth: number;          // metres behind the gain line the backline sits
  params: Record<string, number>;
}

export const FORMATIONS: Formation[] = [
  { id: 'BL-FLAT', name: 'FLAT BACKLINE', kind: 'BACKLINE', blurb: 'Standing on the gain line. Maximum decoy value, minimum reaction time. High intercept risk both ways.', offsets: { 9: 0, 10: -1, 12: -2, 13: -2, 11: -3, 14: -3, 15: -8 }, depth: 1.0, params: { gainLineBias: 1.0, passRisk: 0.18, decoy: 0.9 } },
  { id: 'BL-DEEP', name: 'DEEP BACKLINE', kind: 'BACKLINE', blurb: 'Ten metres behind the gain line. Time to fix defenders before the pass, but the defence arrives on the front foot.', offsets: { 9: 0, 10: -3, 12: -6, 13: -8, 11: -11, 14: -11, 15: -16 }, depth: 9.5, params: { gainLineBias: 0.45, passRisk: 0.06, decoy: 0.45 } },
  { id: 'BL-SPLIT', name: 'SPLIT / POD', kind: 'BACKLINE', blurb: 'Two three-man pods either side of the ruck with a wide overload. The modern default.', offsets: { 9: 0, 10: -2, 12: -4, 13: -12, 11: -14, 14: -18, 15: -12 }, depth: 5.0, params: { gainLineBias: 0.7, passRisk: 0.1, decoy: 0.75 } },
  { id: 'BL-WEDGE', name: 'WEDGE / MISSILE', kind: 'BACKLINE', blurb: 'Narrow arrowhead behind the pods. Everything hits the same seam, three carriers deep.', offsets: { 9: 0, 10: -1.5, 12: -3, 13: -4.5, 11: -6, 14: -13, 15: -11 }, depth: 6.5, params: { gainLineBias: 0.85, passRisk: 0.12, decoy: 0.6 } },
  { id: 'BL-WIDE', name: 'WIDE OVERLOAD', kind: 'BACKLINE', blurb: 'Empty the near channel, put five men wide. Needs quick ball or the drift finds you.', offsets: { 9: 0, 10: -6, 12: -12, 13: -16, 11: -19, 14: -22, 15: -10 }, depth: 7.0, params: { gainLineBias: 0.55, passRisk: 0.14, decoy: 0.5 } },
  { id: 'BL-BLITZ', name: 'BLITZ PICK', kind: 'BACKLINE', blurb: 'Fly-half flat and outside the first receiver, taking the line on himself before releasing.', offsets: { 9: 0, 10: -0.5, 12: -5, 13: -9, 11: -12, 14: -12, 15: -13 }, depth: 3.0, params: { gainLineBias: 0.95, passRisk: 0.16, decoy: 0.7 } },

  { id: 'LO-4', name: '4-MAN LINEOUT', kind: 'LINEOUT', blurb: 'Shortened lineout at the front. Safe ball, no drive, quickest transfer to the backline.', offsets: {}, depth: 0, params: { jumpers: 4, frontBall: 0.55, drive: 0.2, peel: 0.35 } },
  { id: 'LO-5', name: '5-MAN LINEOUT', kind: 'LINEOUT', blurb: 'The standard. Balanced catch-and-drive option with a middle jumper.', offsets: {}, depth: 0, params: { jumpers: 5, frontBall: 0.3, drive: 0.6, peel: 0.4 } },
  { id: 'LO-7', name: '7-MAN LINEOUT', kind: 'LINEOUT', blurb: 'Full pack to the lineout. Best drive, worst defensive cover in the wide channels.', offsets: {}, depth: 0, params: { jumpers: 7, frontBall: 0.15, drive: 0.85, peel: 0.25 } },
  { id: 'LO-SPLIT', name: 'SPLIT LINEOUT', kind: 'LINEOUT', blurb: 'Three and two, splitting the jump. Conceded numbers but clean ball off the top.', offsets: {}, depth: 0, params: { jumpers: 5, frontBall: 0.4, drive: 0.35, peel: 0.6 } },
  { id: 'LO-TAIL', name: 'TAIL BALL', kind: 'LINEOUT', blurb: 'Throw to the back of the line. Highest reward, longest flight, most contestable.', offsets: {}, depth: 0, params: { jumpers: 7, frontBall: 0.05, drive: 0.5, peel: 0.7 } },
  { id: 'LO-MISS', name: 'MISS AND PEEL', kind: 'LINEOUT', blurb: 'Catch short, peel around the tail. Sets the maul moving before contact.', offsets: {}, depth: 0, params: { jumpers: 6, frontBall: 0.35, drive: 0.45, peel: 0.9 } },

  { id: 'SC-8-3', name: '8-3 BIND', kind: 'SCRUM', blurb: 'Classic eight-man bind with three in the second row. Maximum sustained shove.', offsets: {}, depth: 0, params: { power: 1.0, wheel: 0.25, stability: 1.0, strike: 0.5 } },
  { id: 'SC-WHEEL', name: 'WHEELING SCRUM', kind: 'SCRUM', blurb: 'Angle the shove to wheel the scrum through 90 and win the put-in.', offsets: {}, depth: 0, params: { power: 0.78, wheel: 1.0, stability: 0.6, strike: 0.4 } },
  { id: 'SC-STRIKE', name: 'STRIKE-HEAVY', kind: 'SCRUM', blurb: 'Sacrifice the shove for a clean heel against the head.', offsets: {}, depth: 0, params: { power: 0.55, wheel: 0.15, stability: 0.9, strike: 1.0 } },
  { id: 'SC-53', name: '5-3 SPLIT', kind: 'SCRUM', blurb: 'Flanker detaches early for the channel-nine snipe.', offsets: {}, depth: 0, params: { power: 0.85, wheel: 0.3, stability: 0.85, strike: 0.6 } },

  { id: 'RS-DEEP', name: 'DEEP RESTART', kind: 'RESTART', blurb: 'Kick to the corner, chase hard, squeeze the exit.', offsets: {}, depth: 0, params: { hang: 0.6, distance: 1.0, chase: 0.8 } },
  { id: 'RS-SHORT', name: 'SHORT RESTART', kind: 'RESTART', blurb: 'Ten metres and a contest. High risk, high reward.', offsets: {}, depth: 0, params: { hang: 0.9, distance: 0.35, chase: 1.0 } },
  { id: 'RS-BOMB', name: 'UP AND UNDER', kind: 'RESTART', blurb: 'Hang it in the air and put four chasers under it.', offsets: {}, depth: 0, params: { hang: 1.0, distance: 0.6, chase: 1.0 } },
  { id: 'RS-WIDE', name: 'CROSS-FIELD', kind: 'RESTART', blurb: 'Kick across the field to the isolated wing.', offsets: {}, depth: 0, params: { hang: 0.7, distance: 0.75, chase: 0.6 } },

  { id: 'DF-MAN', name: 'MAN-ON-MAN', kind: 'DEFENCE', blurb: 'Every defender takes his opposite number. No cover, no drift.', offsets: {}, depth: 0, params: { lineSpeed: 0.7, drift: 0.05, shoot: 0.5, cover: 0.4 } },
  { id: 'DF-DRIFT', name: 'DRIFT DEFENCE', kind: 'DEFENCE', blurb: 'Slide with the pass, force the wide man into touch.', offsets: {}, depth: 0, params: { lineSpeed: 0.6, drift: 0.9, shoot: 0.2, cover: 0.9 } },
  { id: 'DF-BLITZ', name: 'BLITZ / RUSH', kind: 'DEFENCE', blurb: 'Fly up on the inside shoulder. Wins collisions, concedes the wide channel.', offsets: {}, depth: 0, params: { lineSpeed: 1.0, drift: 0.1, shoot: 0.95, cover: 0.5 } },
  { id: 'DF-UMBRELLA', name: 'UMBRELLA', kind: 'DEFENCE', blurb: 'Curved line, deepest at the edge. Nothing gets outside.', offsets: {}, depth: 0, params: { lineSpeed: 0.55, drift: 0.6, shoot: 0.3, cover: 1.0 } },
  { id: 'DF-SHOOT', name: 'SHOOT AND SMOTHER', kind: 'DEFENCE', blurb: 'Target the first receiver. Zero pass-rush discipline, huge collision.', offsets: {}, depth: 0, params: { lineSpeed: 0.9, drift: 0.2, shoot: 1.0, cover: 0.45 } },

  { id: 'EX-22', name: '22 EXIT — BOX', kind: 'EXIT', blurb: 'Box kick from nine into touch. Safe, territory-first.', offsets: {}, depth: 0, params: { kick: 0.9, run: 0.1, risk: 0.1 } },
  { id: 'EX-RUN', name: '22 EXIT — RUN', kind: 'EXIT', blurb: 'Run it out from your own in-goal. Reward is a line break, cost is a turnover in your 22.', offsets: {}, depth: 0, params: { kick: 0.25, run: 0.9, risk: 0.55 } },
  { id: 'EX-CLEAR', name: 'LONG CLEARANCE', kind: 'EXIT', blurb: 'Punt for distance, accept the lineout wherever it lands.', offsets: {}, depth: 0, params: { kick: 1.0, run: 0.05, risk: 0.05 } },
];

export const FORMATION_BY_ID = (id: string) => FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[2];

/* ============================ 4. TACTICS ============================ */

export interface TacticSlider {
  id: string; label: string; lo: string; hi: string; v: number; step: number;
  /** which simulation terms this drives */
  affects: string[];
}

export const DEFAULT_SLIDERS: TacticSlider[] = [
  { id: 'aggression', label: 'AGGRESSION', lo: 'COLD', hi: 'FERAL', v: 50, step: 5, affects: ['Tackle height', 'Penalty risk', 'Jackal rate', 'Ruck speed'] },
  { id: 'width', label: 'WIDTH', lo: 'TIGHT', hi: 'SPREAD', v: 50, step: 5, affects: ['Attacking lateral offsets', 'Pass distance', 'Touchline risk'] },
  { id: 'tempo', label: 'TEMPO', lo: 'SLOW', hi: 'FLAT OUT', v: 50, step: 5, affects: ['Time to pass', 'Ruck commitment', 'Fatigue burn'] },
  { id: 'kickFreq', label: 'KICKING', lo: 'RUN IT', hi: 'TERRITORY', v: 50, step: 5, affects: ['CPU kick threshold', 'Bomb frequency', 'Contestable kicks'] },
  { id: 'offload', label: 'OFFLOADS', lo: 'SECURE', hi: 'RISKY', v: 40, step: 5, affects: ['Offload probability', 'Turnover in contact', 'Line-break chance'] },
  { id: 'lineSpeed', label: 'LINE SPEED', lo: 'SIT BACK', hi: 'BLITZ', v: 55, step: 5, affects: ['Defensive gain line', 'Missed tackles', 'Kick-chase pressure'] },
  { id: 'ruckCommit', label: 'RUCK COMMIT', lo: 'ONE OUT', hi: 'THREE IN', v: 50, step: 5, affects: ['Ruck speed', 'Wide defenders available'] },
  { id: 'chase', label: 'KICK CHASE', lo: 'LAZY', hi: 'SWARM', v: 55, step: 5, affects: ['Contestable kick regains', 'Bomb recoveries'] },
  { id: 'setPiece', label: 'SET PIECE', lo: 'STRIKE', hi: 'DRIVE', v: 50, step: 5, affects: ['Scrum shove vs strike', 'Lineout drive vs off the top'] },
  { id: 'goalCalls', label: 'SHOT CALLS', lo: 'TAP AND GO', hi: 'TAKE THE 3', v: 60, step: 5, affects: ['Penalty goal vs tap', 'Kick to touch', 'Clock management'] },
];

export const TACTIC_PRESETS: { id: string; name: string; blurb: string; sliders: Record<string, number>; backline: string; defence: string }[] = [
  { id: 'WCR-CLASSIC', name: 'WORLD CLASS 1991', blurb: 'Ten-man rugby. Kick for the corner, drive the maul, take the three.', sliders: { aggression: 45, width: 25, tempo: 35, kickFreq: 75, offload: 20, lineSpeed: 50, ruckCommit: 60, chase: 55, setPiece: 80, goalCalls: 75 }, backline: 'BL-DEEP', defence: 'DF-DRIFT' },
  { id: 'WCR-CHAOS', name: 'SEVENS CHAOS', blurb: 'Offload everything, never kick, trust the pace.', sliders: { aggression: 70, width: 85, tempo: 90, kickFreq: 10, offload: 90, lineSpeed: 80, ruckCommit: 30, chase: 40, setPiece: 25, goalCalls: 20 }, backline: 'BL-WIDE', defence: 'DF-BLITZ' },
  { id: 'WCR-PODIUM', name: 'PODIUM POD', blurb: 'One-out carriers, three into every ruck, kick from the far side of halfway.', sliders: { aggression: 55, width: 40, tempo: 55, kickFreq: 55, offload: 35, lineSpeed: 65, ruckCommit: 85, chase: 60, setPiece: 60, goalCalls: 55 }, backline: 'BL-SPLIT', defence: 'DF-MAN' },
  { id: 'WCR-BLITZ', name: 'GREEN WALL', blurb: 'Rush defence, smother the receiver, win the collision.', sliders: { aggression: 85, width: 30, tempo: 60, kickFreq: 40, offload: 45, lineSpeed: 95, ruckCommit: 70, chase: 85, setPiece: 50, goalCalls: 50 }, backline: 'BL-WEDGE', defence: 'DF-SHOOT' },
  { id: 'WCR-BALANCED', name: 'BALANCED BOOK', blurb: 'The house default. Nothing extreme, nothing wasted.', sliders: { aggression: 50, width: 50, tempo: 50, kickFreq: 50, offload: 40, lineSpeed: 55, ruckCommit: 50, chase: 55, setPiece: 50, goalCalls: 60 }, backline: 'BL-SPLIT', defence: 'DF-UMBRELLA' },
];

/* ============================ 5. SETTINGS TREE ============================ */

export interface OptionItem { id: string; label: string; values: string[]; def: number; note: string; cat: string }

export const OPTION_ITEMS: OptionItem[] = [
  { id: 'halfLength', label: 'HALF LENGTH', values: ['2 MIN', '5 MIN', '10 MIN', '20 MIN', '40 MIN'], def: 1, note: 'Clock compression keeps a 40-minute half inside a real session.', cat: 'MATCH' },
  { id: 'difficulty', label: 'SKILL LEVEL', values: ['0 ROOKIE', '1 CLUB', '2 DISTRICT', '3 COUNTY', '4 TRIALIST', '5 INTERNATIONAL', '6 LEGEND', '7 ELITE', '8 SUPREME', '9 MYTHIC'], def: 3, note: 'Ten rungs. 0-6 shipped in 1991; 7-9 are the Five Nations Edition ceiling.', cat: 'MATCH' },
  { id: 'weather', label: 'WEATHER', values: ['CLEAR', 'OVERCAST', 'DRIZZLE', 'RAIN', 'FOG', 'COLD SNAP', 'GALE'], def: 1, note: 'Wet ball widens handling error probability and shortens kick distances.', cat: 'CONDITIONS' },
  { id: 'pitch', label: 'PITCH', values: ['FIRM', 'STANDARD', 'SOFT', 'MUDDY', 'FROZEN'], def: 1, note: 'Footing alters acceleration, sidestep success and maul traction.', cat: 'CONDITIONS' },
  { id: 'wind', label: 'WIND', values: ['CALM', 'LIGHT', 'BREEZY', 'STRONG', 'GUSTING'], def: 1, note: 'Cross-wind pushes the ball off line on every kick and restart.', cat: 'CONDITIONS' },
  { id: 'timeofday', label: 'KICK-OFF', values: ['MIDDAY', 'AFTERNOON', 'TWILIGHT', 'FLOODLIT'], def: 2, note: 'Changes crowd shading and the vignette weight.', cat: 'CONDITIONS' },
  { id: 'referee', label: 'REFEREE', values: ['THE WHISTLER', 'THE BALANCED', 'LET IT FLOW', 'THE TECHNICAL'], def: 1, note: 'Strictness drives penalty frequency, card threshold and advantage length.', cat: 'RULES' },
  { id: 'offside', label: 'OFFSIDE', values: ['ON', 'OFF'], def: 0, note: 'The original let you turn the law off entirely. Defenders then stand anywhere.', cat: 'RULES' },
  { id: 'knockOn', label: 'KNOCK-ON', values: ['STRICT', 'NORMAL', 'LENIENT'], def: 1, note: 'Loose ball spill probability and whether the whistle goes.', cat: 'RULES' },
  { id: 'fwdPass', label: 'FORWARD PASS', values: ['STRICT', 'NORMAL', 'LENIENT'], def: 1, note: 'Judged against the pass vector, not the receiver.', cat: 'RULES' },
  { id: 'advantage', label: 'ADVANTAGE', values: ['SHORT', 'NORMAL', 'LONG'], def: 1, note: 'How long play runs before the referee comes back.', cat: 'RULES' },
  { id: 'ruckLaw', label: 'RUCK CLOCK', values: ['1.5 S', '3.0 S', '5.0 S'], def: 2, note: 'Time to use it before the scrum is awarded. Defaults to 5 seconds so the player has a clear window to choose a pass, a carry or a kick.', cat: 'RULES' },
  /* T-38 follow-up: who receives the auto-play when the ruck clock runs out.
   * Was a hardcoded 10; the 12 or the back-row pick are real calls. */
  { id: 'firstReceiver', label: 'FIRST RECEIVER', values: ['FLY-HALF 10', 'CENTRE 12', 'BACK ROW 8'], def: 0, note: 'When the ruck clock hits zero the nine releases to this man. The fly-half is the natural default.', cat: 'RULES' },
  { id: 'maulLaw', label: 'MAUL LAW', values: ['STOP ONCE', 'STOP TWICE', 'NO LIMIT'], def: 0, note: 'A stalled maul used once is a turnover; used twice is a penalty.', cat: 'RULES' },
  { id: 'fifty22', label: '50:22', values: ['OFF', 'ON'], def: 0, note: 'Anachronistic bonus law. Off for the authentic 1991 feel.', cat: 'RULES' },
  { id: 'sinbin', label: 'SIN BIN', values: ['OFF', 'ON'], def: 1, note: 'Yellow card, ten minutes. Original shipped with it on.', cat: 'RULES' },
  { id: 'cards', label: 'CARD FREQUENCY', values: ['RARE', 'NORMAL', 'TOUGH'], def: 1, note: 'Threshold before the referee reaches for a pocket.', cat: 'RULES' },
  { id: 'subs', label: 'REPLACEMENTS', values: ['0', '2', '3', '5', '7'], def: 2, note: 'Bench size. Rolling subs are not available in this era.', cat: 'RULES' },
  { id: 'scrumFeed', label: 'SCRUM FEED', values: ['STRAIGHT', 'LEGALESE', 'SQUIRREL'], def: 1, note: 'How far the feeding side may cheat the put-in before being pinged.', cat: 'RULES' },
  { id: 'scrumWaggle', label: 'SCRUM WAGGLE', values: ['MANUAL', 'AUTO'], def: 0, note: 'Manual is the 1991 joystick-wrecking original; auto lets the AI push for you.', cat: 'CONTROLS' },
  { id: 'ruckWaggle', label: 'RUCK WAGGLE', values: ['MANUAL', 'AUTO'], def: 0, note: 'Original reviewers noted auto-rucks favoured the CPU. It still does.', cat: 'CONTROLS' },
  { id: 'control', label: 'CONTROL SCHEME', values: ['CLASSIC 1-BUTTON', 'MODERN KEYS', 'KEYBOARD DEFAULT'], def: 2, note: 'Classic replicates the single-fire-button original.', cat: 'CONTROLS' },
  { id: 'spaceAction', label: 'SPACE DOES', values: ['AUTO (MOST LOGICAL)', 'PASS', 'KICK', 'TAKE CONTACT', 'TACKLE', 'SPRINT'], def: 0, note: 'AUTO reads the situation: offload under pressure, pass when clear, sprint into a gap, tackle when defending. Override it if something else suits you better.', cat: 'CONTROLS' },
  { id: 'showControls', label: 'CONTROLS PANEL', values: ['OFF', 'TOP LEFT', 'TOP LEFT + ALL'], def: 1, note: 'The live control list at the top left, with the most logical action highlighted.', cat: 'DISPLAY' },
  { id: 'radar', label: 'RADAR', values: ['OFF', 'ON'], def: 1, note: 'The transparent pitch map, top right.', cat: 'DISPLAY' },
  { id: 'autoReplay', label: 'AUTO REPLAY', values: ['OFF', 'SCORES', 'EVERYTHING'], def: 1, note: 'Five replay variants shipped with the original, varying in speed and dimension.', cat: 'DISPLAY' },
  { id: 'crt', label: 'CRT FILTER', values: ['OFF', 'SUBTLE', 'FULL'], def: 1, note: 'Scanline and phosphor overlay.', cat: 'DISPLAY' },
  { id: 'camera', label: 'CAMERA', values: ['BEHIND POSTS', 'CHASE', 'TACTICAL'], def: 0, note: 'The camera never orbits — it zooms and tracks like a broadcast rig.', cat: 'DISPLAY' },
  { id: 'commentary', label: 'COMMENTARY', values: ['OFF', 'TICKER', 'FULL'], def: 2, note: 'Caption feed under the HUD.', cat: 'DISPLAY' },
  { id: 'crowd', label: 'CROWD NOISE', values: ['OFF', 'LOW', 'FULL'], def: 2, note: 'Mixed by travelling support ratio.', cat: 'DISPLAY' },
  { id: 'hud', label: 'HUD DENSITY', values: 'MINIMAL STANDARD FULL TELEMETRY'.split(' '), def: 1, note: 'From bare score to live expected-points readouts.', cat: 'DISPLAY' },
  { id: 'handicap', label: 'CPU HANDICAP', values: ['NONE', 'SLIGHT', 'PLAYER EDGE'], def: 1, note: 'Quiet stat nudge for whoever needs it.', cat: 'MATCH' },
  { id: 'extraTime', label: 'EXTRA TIME', values: ['OFF', 'ON', 'GOLDEN POINT'], def: 1, note: 'Only in knockout rugby.', cat: 'MATCH' },
];

/* ============================ 6. RULES & SCORING ============================ */

export const POINTS = { TRY: 5, CONVERSION: 2, PENALTY: 3, DROP_GOAL: 3, FREE_KICK: 0 };

export const LAW_ENTRIES: { law: string; text: string }[] = [
  { law: 'TRY', text: 'Ground the ball in the in-goal area. Five points, plus a conversion attempt in line with where it was grounded.' },
  { law: 'CONVERSION', text: 'Two points. Taken on the 22-metre line, in line with the mark. Wind and angle both matter.' },
  { law: 'PENALTY GOAL', text: 'Three points from a place kick following a penalty. May instead be kicked to touch, tapped or scrummaged.' },
  { law: 'DROP GOAL', text: 'Three points, drop-kicked in open play. The ball must clearly strike the ground.' },
  { law: 'FREE KICK', text: 'No shot at goal. Tap, kick to touch (no ground gained) or scrum.' },
  { law: 'SCRUM', text: 'Eight a side. Put-in to the team awarded it. Crouch-touch-pause-engage in this era.' },
  { law: 'LINEOUT', text: 'Two to seven players a side. Ball must be thrown in straight. Peeling allowed once the lineout ends.' },
  { law: 'OFFSIDE', text: 'Behind the hindmost foot at ruck, maul and scrum; ten metres back at lineout and restart.' },
  { law: 'KNOCK-ON', text: 'Ball forward off hand or arm toward the opponents’ dead-ball line. Scrum, unless recovered by the kicker’s side.' },
  { law: 'FORWARD PASS', text: 'Ball thrown toward the opponents’ dead-ball line. Scrum where the pass was thrown.' },
  { law: 'ADVANTAGE', text: 'Play on after an infringement if the non-offending side gains territory or a tactical opportunity.' },
  { law: 'MARK', text: 'Clean catch from a kick inside your own 22 or in-goal, called aloud. Free kick.' },
  { law: 'TACKLE', text: 'Ball-carrier held and brought to ground. Tackler must release and roll away immediately.' },
  { law: 'RUCK', text: 'One player from each side in contact over the ball on the ground. Hands off until it is out.' },
  { law: 'MAUL', text: 'Ball-carrier held but standing. Maul may be driven; if it is stopped and restarted twice, turnover.' },
  { law: 'OBSTRUCTION', text: 'Running behind a decoy line or crossing. Penalty.' },
  { law: 'HIGH TACKLE', text: 'Contact above the line of the shoulders. Penalty, escalating to a card.' },
  { law: 'LATE TACKLE', text: 'Contact after the kick has gone. Penalty, and the kicker is usually hurt.' },
  { law: 'COLLAPSING THE SCRUM', text: 'Pulling down a bound scrum. Penalty, and in this era a card follows quickly.' },
  { law: 'FOOT UP', text: 'Hooker strikes before the ball is in. Free kick.' },
  { law: 'NOT STRAIGHT', text: 'Lineout throw fails to run parallel to the touchline. Opposition lineout.' },
  { law: 'EARLY ENGAGE', text: 'Pack drives before the referee’s call. Free kick, then penalty for repeat.' },
  { law: 'WHEELING BEYOND 90°', text: 'Scrum turned past ninety degrees. Turnover of the put-in.' },
  { law: 'IN GOAL', text: 'Grounding your own ball in your in-goal under pressure is a 22 drop-out; theirs is a five-metre scrum.' },
  { law: '22 DROP OUT', text: 'Drop kick from the 22-metre line, taken from anywhere on it. Opponents may not charge it down.' },
];

/* ============================ 7. AI BEHAVIOUR ============================ */

export const AI_ARCHETYPES: Record<string, {
  name: string; blurb: string;
  kickBias: number; widthBias: number; offloadBias: number; lineSpeed: number;
  setPieceBias: number; riskTolerance: number; fieldPositionWeight: number; clockWeight: number;
}> = {
  'BOULDER ATHLETIC': { name: 'BOULDER ATHLETIC', blurb: 'Big pack, big maul, kick to the corner and grind.', kickBias: 0.55, widthBias: 0.3, offloadBias: 0.25, lineSpeed: 0.55, setPieceBias: 0.95, riskTolerance: 0.25, fieldPositionWeight: 0.9, clockWeight: 0.6 },
  'IRONSIDE TECHNICAL': { name: 'IRONSIDE TECHNICAL', blurb: 'Precise. Wide on your errors, patient, never beats itself.', kickBias: 0.45, widthBias: 0.6, offloadBias: 0.4, lineSpeed: 0.7, setPieceBias: 0.6, riskTolerance: 0.35, fieldPositionWeight: 0.7, clockWeight: 0.9 },
  'TEMPO WIDE': { name: 'TEMPO WIDE', blurb: 'Move the ball, move it again, never let the defence set.', kickBias: 0.25, widthBias: 0.9, offloadBias: 0.6, lineSpeed: 0.75, setPieceBias: 0.4, riskTolerance: 0.6, fieldPositionWeight: 0.5, clockWeight: 0.4 },
  'TERRITORY KICK': { name: 'TERRITORY KICK', blurb: 'Kick, chase, squeeze. Wins on the exit battle.', kickBias: 0.85, widthBias: 0.35, offloadBias: 0.2, lineSpeed: 0.65, setPieceBias: 0.7, riskTolerance: 0.2, fieldPositionWeight: 1.0, clockWeight: 0.7 },
  'CHAOS OFFLOAD': { name: 'CHAOS OFFLOAD', blurb: 'Offload in contact, always. Some days it is unplayable.', kickBias: 0.3, widthBias: 0.8, offloadBias: 0.95, lineSpeed: 0.85, setPieceBias: 0.35, riskTolerance: 0.85, fieldPositionWeight: 0.4, clockWeight: 0.3 },
};

/** Difficulty rung: what the CPU actually gets better at. */
export const DIFFICULTY_TABLE: { lvl: number; name: string; reaction: number; errorRate: number; readRate: number; stamina: number; note: string }[] = [
  { lvl: 0, name: 'ROOKIE', reaction: 0.55, errorRate: 0.42, readRate: 0.3, stamina: 0.75, note: 'CPU passes to nobody, misses one in three tackles.' },
  { lvl: 1, name: 'CLUB', reaction: 0.66, errorRate: 0.32, readRate: 0.42, stamina: 0.82, note: 'Holds shape for about four phases.' },
  { lvl: 2, name: 'DISTRICT', reaction: 0.74, errorRate: 0.25, readRate: 0.52, stamina: 0.88, note: 'Kicks intelligently from its own half.' },
  { lvl: 3, name: 'COUNTY', reaction: 0.81, errorRate: 0.19, readRate: 0.62, stamina: 0.92, note: 'The intended default. Balanced in all six mini-games.' },
  { lvl: 4, name: 'TRIALIST', reaction: 0.87, errorRate: 0.14, readRate: 0.71, stamina: 0.95, note: 'Jackals your slow ball and punishes loose carries.' },
  { lvl: 5, name: 'INTERNATIONAL', reaction: 0.92, errorRate: 0.10, readRate: 0.8, stamina: 0.98, note: 'Scores from every visit to your 22.' },
  { lvl: 6, name: 'LEGEND', reaction: 0.95, errorRate: 0.07, readRate: 0.87, stamina: 1.0, note: 'The 1991 shipping ceiling. Reads your call before you make it.' },
  { lvl: 7, name: 'ELITE', reaction: 0.97, errorRate: 0.05, readRate: 0.91, stamina: 1.02, note: 'Five Nations Edition tier. Perfect waggle cadence.' },
  { lvl: 8, name: 'SUPREME', reaction: 0.99, errorRate: 0.035, readRate: 0.95, stamina: 1.05, note: 'Never knocks on. Never misses a shot at goal.' },
  { lvl: 9, name: 'MYTHIC', reaction: 1.0, errorRate: 0.02, readRate: 0.99, stamina: 1.1, note: 'The AI plays the laws better than the referee does.' },
];

/** CPU decision weights per phase, used by the AI to score its options. */
export const AI_WEIGHTS: { phase: string; option: string; base: number; situational: string }[] = [
  { phase: 'OPEN_PLAY', option: 'CARRY INTO GAP', base: 0.85, situational: '+ proximity to space, − pressure' },
  { phase: 'OPEN_PLAY', option: 'PASS SHORT', base: 0.7, situational: '+ support inside, − pass risk' },
  { phase: 'OPEN_PLAY', option: 'PASS LONG', base: 0.5, situational: '+ width slider, − distance' },
  { phase: 'OPEN_PLAY', option: 'KICK TERRITORY', base: 0.4, situational: '+ own half, + kick slider' },
  { phase: 'OPEN_PLAY', option: 'KICK CONTESTABLE', base: 0.25, situational: '+ chase slider, + wingers isolated' },
  { phase: 'OPEN_PLAY', option: 'GRUBBER', base: 0.2, situational: '+ fullback deep, − wet ball' },
  { phase: 'OPEN_PLAY', option: 'DROP GOAL', base: 0.15, situational: '+ inside their 22, + kicker accuracy, + clock' },
  { phase: 'OPEN_PLAY', option: 'STEP OFF EITHER FOOT', base: 0.45, situational: '+ defender square, − soft ground' },
  { phase: 'BREAKDOWN', option: 'JACKAL', base: 0.4, situational: '+ aggression, − carrier strength' },
  { phase: 'BREAKDOWN', option: 'CLEANOUT', base: 0.8, situational: '+ ruckCommit slider' },
  { phase: 'BREAKDOWN', option: 'FLOOD THE RUCK', base: 0.3, situational: '+ slow ball needed, − wide cover' },
  { phase: 'SCRUM', option: 'SHOVE EIGHT', base: 0.8, situational: '+ setPiece slider, + scrum rating' },
  { phase: 'SCRUM', option: 'WHEEL FOR IT', base: 0.25, situational: '+ opposition weak on one shoulder' },
  { phase: 'SCRUM', option: 'STRIKE AND OUT', base: 0.5, situational: '+ against the head, + tempo slider' },
  { phase: 'LINEOUT', option: 'FRONT BALL', base: 0.5, situational: '+ red zone, − risk tolerance' },
  { phase: 'LINEOUT', option: 'MIDDLE AND DRIVE', base: 0.6, situational: '+ maul rating, + red zone' },
  { phase: 'LINEOUT', option: 'OFF THE TOP', base: 0.35, situational: '+ tempo slider, + backline move' },
  { phase: 'LINEOUT', option: 'TAIL BALL', base: 0.2, situational: '+ their throw not straight, + gamble' },
  { phase: 'MAUL', option: 'DRIVE', base: 0.85, situational: '+ maul rating, + red zone' },
  { phase: 'MAUL', option: 'TRANSFER TO THE TAIL', base: 0.3, situational: '+ stalled, + ball rank low' },
  { phase: 'MAUL', option: 'PEEL AND GO', base: 0.25, situational: '+ space on the openside' },
  { phase: 'PENALTY', option: 'SHOT AT GOAL', base: 0.5, situational: '+ goalCalls slider, + inside range' },
  { phase: 'PENALTY', option: 'KICK TO TOUCH', base: 0.35, situational: '+ field position, + lineout rating' },
  { phase: 'PENALTY', option: 'TAP AND GO', base: 0.2, situational: '+ tempo slider, + tiring defence' },
  { phase: 'PENALTY', option: 'SCRUM', base: 0.15, situational: '+ scrum dominance, + red zone' },
];

/* ============================ 8. COMMENTARY BANKS ============================ */

export const COMMENTARY: Record<string, string[]> = {
  KICKOFF: ['AND WE ARE UNDER WAY AT {VENUE}', '{HOME} GET US STARTED, KICKING LEFT TO RIGHT', 'THE WHISTLE GOES, THE CROWD RISES AS ONE'],
  TRY: ['TRY! {PLAYER} GROUNDS IT AND THE STAND IS UP', 'THAT IS A SUPERB FINISH FROM {PLAYER}', 'FIVE POINTS — {PLAYER} DIVES IN AT THE CORNER', 'THE DEFENCE PARTED LIKE A CURTAIN. TRY, {PLAYER}', '{PLAYER} WALKS IT IN. NOTHING THERE.'],
  CONVERSION: ['THE CONVERSION IS AWAY… IT IS OVER', 'OFF THE POST! NO GOOD', 'PULLED WIDE OF THE NEAR UPRIGHT', 'STRUCK SWEETLY, RIGHT BETWEEN THE STICKS', 'THE WIND TAKES IT AWAY AT THE LAST'],
  PENALTY: ['PENALTY, RIGHT IN FRONT, SIMPLE', 'HE STRIKES IT… OVER. THREE POINTS', 'THAT IS A MONSTEROUS EFFORT FROM {DIST} METRES', 'THE ANGLE BEATS HIM. WIDE'],
  DROPGOAL: ['DROPPED GOAL! ICE COLD FROM {PLAYER}', 'HE SHAPES TO PASS AND DROPS IT OVER THE BAR', 'OFF THE CROSSBAR AND OVER! REMARKABLE'],
  TACKLE: ['MONSTER HIT! THAT ONE WILL LEAVE A MARK', 'WRAPPED UP AND DRIVEN BACK TWO METRES', 'HE READS IT AND MAKES THE COVER TACKLE', 'SMOTHERED BEHIND THE GAIN LINE'],
  TURNOVER: ['TURNED OVER! THAT IS OUTSTANDING WORK', 'HE HAS PINCHED IT AT THE BASE', 'THE BALL IS SPILLED AND HACKED ON'],
  SCRUM: ['SCRUM DOWN ON THE {SIDE}', 'THE PACKS PACK DOWN', 'ANOTHER SCRUM. THE CROWD STIRS', 'CLEAN STRIKE, BALL AWAY'],
  SCRUM_PEN: ['PENALTY AT THE SCRUM — POPPED UP', 'COLLAPSED. THE REFERENCE HAS SEEN ENOUGH', 'WHEELED THROUGH NINETY. TURNOVER PUT-IN'],
  LINEOUT: ['LINEOUT ON THE {SIDE}, {N} METRES IN', 'STRAIGHT AND TRUE, MIDDLE JUMPER', 'NOT STRAIGHT — FREE KICK TO THE DEFENCE', 'STOLEN! THE THROW WAS GIFTED'],
  MAUL: ['THE MAUL RUMBLES FORWARD', 'TWELVE MEN IN THERE SOMEWHERE', 'IT IS STOPPED. USE IT OR LOSE IT'],
  HALF: ['HALF TIME. {SCORE}', 'THE REFEREE BLOWS FOR THE INTERVAL'],
  FULL: ['FULL TIME! {SCORE}', 'IT IS ALL OVER AT {VENUE}'],
  WEATHER: ['THE RAIN HAS REALLY SET IN NOW', 'IT IS GREASY UNDERFOOT AND IT SHOWS', 'THE WIND IS SWIRLING AROUND THE GROUND'],
  MISS: ['HE IS OVER! NO — THE TACKLE TOOK HIM INTO TOUCH', 'HE LOSES IT FORWARD WITH THE LINE BEGGING', 'THE PASS GOES TO NOBODY. THAT IS A SHOCKER'],
  SUB: ['{PLAYER} IS ON FOR {OFF}', 'A CHANGE IN THE BACK ROW'],
  GENERIC: ['HARD YARDS HERE', 'PHASE BALL, NOTHING ON', 'THE KICK IS AWAY AND THE CHASE IS ON', 'SOLID DEFENDING, NO WAY THROUGH'],
};

export const REFEREE_CALLS: Record<string, string> = {
  HIGH_TACKLE: 'PENALTY — HIGH TACKLE',
  LATE_TACKLE: 'PENALTY — LATE TACKLE ON THE KICKER',
  COLLAPSE: 'PENALTY — COLLAPSING THE SCRUM',
  FOOT_UP: 'FREE KICK — FOOT UP',
  EARLY_ENGAGE: 'FREE KICK — EARLY ENGAGEMENT',
  NOT_STRAIGHT: 'FREE KICK — NOT IN STRAIGHT',
  KNOCK_ON: 'SCRUM — KNOCK ON',
  FWD_PASS: 'SCRUM — FORWARD PASS',
  OFFSIDE: 'PENALTY — OFFSIDE',
  OBSTRUCTION: 'PENALTY — OBSTRUCTION',
  NOT_RELEASING: 'PENALTY — NOT RELEASING',
  HANDS_IN: 'PENALTY — HANDS IN THE RUCK',
  MAUL_STOPPED: 'TURNOVER — MAUL STOPPED AND RESTARTED',
  IN_AT_SIDE: 'PENALTY — IN AT THE SIDE',
  TRIP: 'PENALTY — TRIPPING',
};

/* ============================ 9. COMPETITIONS ============================ */

export const COMPETITIONS = {
  FRIENDLY: { name: 'FRIENDLY INTERNATIONAL', rounds: 0, note: 'One match, no trophy, nothing at stake but pride.' },
  LEAGUE: { name: 'EIGHT-TEAM LEAGUE', rounds: 7, note: 'Single round robin. Two points a win, one a draw. Points difference separates level sides.' },
  WORLD_CUP: { name: 'WORLD CUP', rounds: 5, note: 'Four pools of four, then quarter-finals, semi-finals and a final. Pool seeding from the 1991 draw.' },
  FIVE_NATIONS: { name: 'FIVE NATIONS CHAMPIONSHIP', rounds: 4, note: 'England, France, Ireland, Scotland and Wales. Grand Slam, Triple Crown, Calcutta Cup and the Wooden Spoon are all live.' },
};

export const TROPHIES = [
  { id: 'GRAND_SLAM', name: 'GRAND SLAM', comp: 'FIVE_NATIONS', text: 'Win all four matches. Nobody else may win a match against you.' },
  { id: 'TRIPLE_CROWN', name: 'TRIPLE CROWN', comp: 'FIVE_NATIONS', text: 'Beat the other three home unions.' },
  { id: 'CALCUTTA', name: 'CALCUTTA CUP', comp: 'FIVE_NATIONS', text: 'England against Scotland. Oldest trophy in international rugby.' },
  { id: 'WOODEN_SPOON', name: 'WOODEN SPOON', comp: 'FIVE_NATIONS', text: 'Lose them all. You have earned it.' },
  { id: 'WEBB_ELLIS', name: 'THE CUP', comp: 'WORLD_CUP', text: 'Win the final. Sixteen nations, one trophy.' },
  { id: 'LEAGUE_SHIELD', name: 'THE SHIELD', comp: 'LEAGUE', text: 'Top of the table after seven rounds.' },
];

/* ============================ 10. MANUAL / DATA COMPENDIUM ============================ */

export interface ManualEntry { k: string; v: string }
export interface ManualSection { id: string; title: string; entries: ManualEntry[] }

export const MANUAL: ManualSection[] = [
  {
    id: 'controls', title: 'CONTROLS',
    entries: [
      { k: 'A / D or ← →', v: 'STEER — lateral movement of the ball carrier in open play' },
      { k: 'W / S or ↑ ↓', v: 'DEPTH — hold a deeper or flatter line on the carry' },
      { k: 'SPACE (hold)', v: 'RUN — accelerate; releases burst stamina' },
      { k: 'J', v: 'PASS LEFT — to the next man on the inside channel' },
      { k: 'K', v: 'PASS RIGHT — to the next man on the outside channel' },
      { k: 'L', v: 'KICK — opens the kick-o-meter, then choose the type' },
      { k: 'I', v: 'CONTACT — take the tackle on your own terms and present' },
      { k: 'Q / E', v: 'SWITCH PLAYER — cycle the nearest defenders when defending' },
      { k: 'SHIFT', v: 'SIDESTEP / FEND — beats a square-on defender' },
      { k: 'R', v: 'INSTANT REPLAY — hold to capture, release to play' },
      { k: 'TAB', v: 'STATS PANEL — live match statistics' },
      { k: '1 / 2 / 3', v: 'TACTIC QUICK-SET — balanced / wide / blitz' },
      { k: 'A + D ALTERNATE', v: 'WAGGLE — scrum/ruck power; maul re-gate and peel call' },
      { k: 'MOUSE WHEEL', v: 'ZOOM — pulls the camera back and up into a tactical view' },
      { k: 'ESC', v: 'PAUSE — menu, substitutions, tactic changes, quit' },
      { k: 'ENTER', v: 'CONFIRM — menus and set-piece calls' },
      { k: 'SPACE at the mark', v: 'LINEOUT THROW — timing window, not distance' },
      { k: 'SPACE twice', v: 'KICK-O-METER — start, then stop inside the sweet band' },
      { k: 'CLASSIC 1-BUTTON', v: 'Fire takes the nearest man; fire plus a direction passes' },
      { k: 'MODERN KEYS', v: 'Full separation of pass, kick, contact and switch' },
      { k: 'AUTO WAGGLE', v: 'The machine pounds for you, slightly worse than you would' },
    ],
  },
  {
    id: 'layout', title: 'SCREEN LAYOUT',
    entries: [
      { k: 'SCORE BAR', v: 'Top left. Team tags, score, clock, half indicator, possession' },
      { k: 'RADAR', v: 'Top right. Transparent pitch map with hollow player dots and a solid ball' },
      { k: 'FRUSTUM', v: 'Faint wedge on the radar showing exactly what the camera can see' },
      { k: 'PHASE STRIP', v: 'Under the score bar: current phase, phase count, metres gained' },
      { k: 'COMMENTARY TICKER', v: 'Bottom centre, single line, caption styled like a 16-bit broadcast' },
      { k: 'TACTIC CHIP', v: 'Bottom left: backline call, defensive call and the two extreme sliders' },
      { k: 'PRESSURE GAUGE', v: 'In-world above the carrier. Green, amber, red as the defence closes' },
      { k: 'GAIN LINE', v: 'Dashed yellow world-space line through where the phase began' },
      { k: 'OFFSIDE LINES', v: 'Dashed red and blue world-space lines either side of a formed ruck' },
      { k: 'RUCK CLOCK', v: 'In-world seconds counter, colour banded into LQB / REGULAR / SLOW' },
      { k: 'FORCE BARS', v: 'kN readouts for both packs at scrum and both sides of a maul' },
      { k: 'WHEEL ARC', v: 'Arc drawn off the scrum axis once it turns past three degrees' },
      { k: 'TRY LINE BANNER', v: 'Yellow world-space line plus label whenever a maul is driving' },
      { k: 'KICK TELEMETRY', v: 'Hang time, apex height and distance, or goal probability when at goal' },
      { k: 'FLIGHT TRAIL', v: 'Screen-space arc behind any ball in the air, with a ground track beneath' },
      { k: 'WIPE TRANSITION', v: 'Black bars close from top and bottom with a gold leading edge' },
      { k: 'CROWD FLICKER', v: 'Terrace pixels randomise at 1.1 Hz so the bowl never looks static' },
      { k: 'ATMOSPHERIC FADE', v: 'Distant players lose contrast, capped at sixty percent' },
      { k: 'DEPTH SORT', v: 'All actors and the ball sorted per frame on distance from the lens' },
      { k: 'CRT OVERLAY', v: 'Three-pixel scanlines plus an RGB phosphor wash, both optional' },
    ],
  },
  {
    id: 'progression', title: 'GAME PROGRESSION',
    entries: [
      { k: 'BOOT', v: 'Title card, attract-mode palette cycle, press fire' },
      { k: 'MAIN MENU', v: 'Friendly, League, World Cup, Five Nations, Skills Clinic, Replay Theatre, Options, Media Guide' },
      { k: 'MATCH SETUP', v: 'Choose side, opponent, kit, weather, pitch, referee and match length' },
      { k: 'SQUAD SCREEN', v: 'Fifteen starters plus bench; swap, view six rated stats per man' },
      { k: 'TACTICS SCREEN', v: 'Ten sliders, five presets, backline and defensive formations' },
      { k: 'KICK-OFF', v: 'Coin toss, direction, then the kick-o-meter for the restart' },
      { k: 'PHASE LOOP', v: 'Set piece → open play → breakdown → open play, until a law breaks' },
      { k: 'SCORE EVENT', v: 'Wipe, scorecard overlay, conversion attempt, restart' },
      { k: 'HALF TIME', v: 'Stat comparison, coach report, tactic adjustment, substitutions' },
      { k: 'FULL TIME', v: 'Result, man of the match, five-player ratings, report card' },
      { k: 'LEAGUE TABLE', v: 'Played, won, drawn, lost, points for and against, league points' },
      { k: 'WORLD CUP DRAW', v: 'Pool tables with tiebreakers, then a knockout bracket' },
      { k: 'FIVE NATIONS', v: 'Full round-robin table with all four fixtures, trophies awarded' },
      { k: 'REPLAY THEATRE', v: 'Every captured replay, scrubbed frame by frame, five speed variants' },
      { k: 'SKILLS CLINIC', v: 'Scrum machine, lineout drill, kick-o-meter target range, tackle bag' },
      { k: 'ATTRACT MODE', v: 'After ninety idle seconds the machine plays itself' },
    ],
  },
  {
    id: 'feedback', title: 'USER FEEDBACK',
    entries: [
      { k: 'CAPTION TICKER', v: 'Every law, score and big hit is captioned in the original register' },
      { k: 'REFREE SIGNAL', v: 'The referee animates a straight-arm signal whenever the whistle goes' },
      { k: 'COLOUR BANDS', v: 'Every timed readout turns green, amber then red as it degrades' },
      { k: 'SCORECARD OVERLAY', v: 'Full-screen try card with scorer, minute, zone and phase count' },
      { k: 'STAT POP-UPS', v: 'Tackle counts, metres carried and turnovers flash in at each break' },
      { k: 'COACH REPORT', v: 'Half-time card naming the two things you are doing badly' },
      { k: 'PLAYER RATINGS', v: 'Out of ten for five performances, updated at the interval' },
      { k: 'MAN OF THE MATCH', v: 'Highest combined rating across carries, tackles, metres and kicks' },
      { k: 'FATIGUE BARS', v: 'Per-player stamina in the squad screen, draining live in the HUD' },
      { k: 'PRESSURE TONE', v: 'Crowd swells as you approach the line without scoring' },
      { k: 'PENALTY REPLAY', v: 'Any card triggers a replay from the referee’s angle' },
      { k: 'SCREEN SHAKE', v: 'Camera shake in metres on big collisions and scrum engagement' },
      { k: 'WIPE FEEDBACK', v: 'Every phase change is masked so cuts never feel like loading' },
      { k: 'HINDSIGHT CARD', v: 'Full time shows the three moments that actually decided the match' },
    ],
  },
  {
    id: 'ai', title: 'AI BEHAVIOUR',
    entries: [
      { k: 'OPTION SCORING', v: 'Every available action in every phase carries a base weight plus situational modifiers' },
      { k: 'REACTION LAG', v: 'Defenders commit to a decision then cannot change it for the reaction interval' },
      { k: 'DIFFICULTY RUNGS', v: 'Ten levels scale reaction, error rate, read rate and stamina independently' },
      { k: 'ARCHETYPES', v: 'Five CPU personalities driving kick bias, width, offloads and set-piece focus' },
      { k: 'DRIFT LOGIC', v: 'Defenders slide with the ball only while the pass risk stays acceptable' },
      { k: 'BLITZ LOGIC', v: 'Rush defenders target the inside shoulder of the first receiver' },
      { k: 'COVER SPRINT', v: 'Deep defenders always track the ball, never the man' },
      { k: 'JACKAL WINDOW', v: 'CPU contests only inside the legal window, or gets penalised for it' },
      { k: 'OFFLOAD MODEL', v: 'Two-handed probability: carrier strength against tackler grip, scaled by slider' },
      { k: 'FATIGUE DRIFT', v: 'Posture, top speed and tackle willingness all decay with stamina' },
      { k: 'CLOCK MANAGEMENT', v: 'Losing side raises tempo and risk after the sixtieth minute' },
      { k: 'SET-PIECE MEMORY', v: 'CPU remembers which of your lineout calls it has read and jumps them' },
      { k: 'SUBSTITUTION LOGIC', v: 'Bench used at sixty minutes for the two most fatigued forwards' },
      { k: 'AUTO-RUCK BIAS', v: 'Documented in reviews of the original: auto rucks favour the CPU slightly' },
    ],
  },
  {
    id: 'numbers', title: 'TUNING NUMBERS',
    entries: [
      { k: 'PITCH', v: '70 m between touchlines, 100 m between try lines, 22 m in-goal (124 m overall)' },
      { k: 'GOAL POSTS', v: '5.6 m apart, 3 m crossbar, 11 m uprights' },
      { k: 'PLAYER', v: '1.78 m tall, 0.62 m shoulder span, deliberately squat proportions' },
      { k: 'MAX SPRINT', v: '9.4 m/s for a 99-speed wing; 7.1 m/s for a 60-speed prop' },
      { k: 'CARRY SPEED', v: 'Ball in hand costs between 0.4 and 0.9 m/s depending on skill' },
      { k: 'PASS SPEED', v: '12 m/s across the lineout, 15 m/s in open play, 18 m/s a spiral' },
      { k: 'KICK DISTANCES', v: 'Punt up to 55 m, drop goal up to 45 m, goal kick up to 55 m' },
      { k: 'GOAL ACCURACY', v: 'Base 92 percent at 15 m falling to 34 percent at 55 m, angle-adjusted' },
      { k: 'SCRUM FORCE', v: '8850 N for a champion pack, 6050 N for a weak one, 8.5 N per fitness point' },
      { k: 'MAUL FORCE', v: 'Up to 6500 N; 320 N added per committed forward' },
      { k: 'RUCK SPEED', v: '0.9 s for a one-man cleanout to 4.6 s for an uncontested ball' },
      { k: 'TACKLE SUCCESS', v: 'Grip strength against carrier power, ± 18 percent for the angle of entry' },
      { k: 'HANDLING ERROR', v: '4 percent base, rising to 19 percent in rain with a wet ball' },
      { k: 'PENALTY RATE', v: 'One penalty every 3.1 minutes on the Balanced referee, 1.7 on the Whistler' },
      { k: 'EXPECTED POINTS', v: '0.12 from your own 22 rising to 4.30 under the posts' },
      { k: 'CLOCK COMPRESSION', v: 'Every half resolves in about 150 seconds of real time; the 40-minute option preserves the authentic scoreline scale' },
      { k: 'STAMINA DRAIN', v: '1.1 per minute at jogging load, 4.6 per minute in a sprint' },
    ],
  },
];

/** The compendium count is computed, never asserted. */
export function dataPointCount(): { total: number; breakdown: Array<[string, number]> } {
  const manual = MANUAL.reduce((n, s) => n + s.entries.length, 0);
  const players = TEAMS.reduce((n, t) => n + t.squad.length, 0);
  const playerStats = players * 6;
  const teamAttrs = TEAMS.length * 12;
  const kits = Object.values(KITS).reduce((n, k) => n + k.length, 0) * 6;
  const formations = FORMATIONS.reduce((n, f) => n + 5 + Object.keys(f.params).length, 0);
  const sliders = DEFAULT_SLIDERS.length * 5;
  const options = OPTION_ITEMS.reduce((n, o) => n + o.values.length + 2, 0);
  const laws = LAW_ENTRIES.length * 2;
  const ai = Object.keys(AI_ARCHETYPES).length * 9 + AI_WEIGHTS.length * 3 + DIFFICULTY_TABLE.length * 6;
  const commentary = Object.values(COMMENTARY).reduce((n, a) => n + a.length, 0);
  const refCalls = Object.keys(REFEREE_CALLS).length;
  const trophies = TROPHIES.length * 3;
  const breakdown: Array<[string, number]> = [
    ['MANUAL DATA POINTS', manual], ['SQUAD PLAYERS', players], ['PLAYER STAT LINES', playerStats],
    ['TEAM ATTRIBUTES', teamAttrs], ['KIT PALETTE VALUES', kits], ['FORMATION PARAMETERS', formations],
    ['TACTIC SLIDER STATES', sliders], ['OPTION TREE VALUES', options], ['LAW ENTRIES', laws],
    ['AI MODEL VALUES', ai], ['COMMENTARY LINES', commentary], ['REFEREE CALLS', refCalls],
    ['TROPHY DEFINITIONS', trophies],
  ];
  return { total: breakdown.reduce((n, b) => n + b[1], 0), breakdown };
}
