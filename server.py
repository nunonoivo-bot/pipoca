#!/usr/bin/env python3
import http.server
import json
import os
import re
import urllib.request
import urllib.parse
from datetime import date
import time
import threading
import gzip

PORT = int(os.environ.get('PORT', 8090))
DIR = os.path.dirname(os.path.abspath(__file__))
OMDB_KEY = os.environ.get('OMDB_KEY', '9d8ae30a')

MEO_HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://www.meo.pt',
    'Referer': 'https://www.meo.pt/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
}

JW_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept-Language': 'pt-PT,pt;q=0.9',
}

# ---- MEO TV channels config ----

MOVIE_CHANNELS = {
    'TVCTOPH', 'TVCEDIH', 'TVCEMOH', 'TVCACTH',
    'CINEHD', 'HOLHD', 'STARMOV', 'AXNMHD', 'STARCHA',
}

SERIES_CHANNELS = {
    'AXNHD', 'AXWHD', 'SYFHD', 'AMCHD', 'AMCBRE',
    'STARLIF', 'STARCRI', 'STARCOM', 'DIZI',
}

GENERAL_CHANNELS = {
    'RTP1', 'RTP2', 'SIC', 'TVI', 'SICR', 'RTPM', 'QHD', 'OPTO',
}

ALL_TV_CHANNELS = MOVIE_CHANNELS | SERIES_CHANNELS | GENERAL_CHANNELS

SKIP_RE = re.compile(
    r'telev[ae]nd|teleshopping|infomercial|'
    r'jornal|not[ií]ci|telejornal|24\s*horas|'
    r'bom\s*dia\s*portugal|primeir[oa]\s*p[aá]gina|'
    r'praça\s*da\s*alegria|a\s*nossa\s*tarde|boa\s*tarde|'
    r'casa\s*feliz|fama\s*show|big\s*brother|reality|'
    r'secret\s*story|o\s*amor\s*acontece|'
    r'debate|coment[aá]rio|entrevista|opini[aã]o|'
    r'futebol|benfica|sporting|porto\s*canal|'
    r'liga\s*nos|champions|premier\s*league|'
    r'desporto|sport\s*tv|golo|f[ó]rmula\s*1|'
    r'novela|laços\s*de\s*sangue|festa\s*[eé]\s*festa|'
    r'amor\s*amor|sangue\s*oculto|cacau|a\s*rosa|'
    r'morang|floribella|nazaré|'
    r'culiná|cozinh|receita|masterchef|mestre\s*do\s*sabor|'
    r'portugal\s*em\s*direto|linha\s*da\s*frente|'
    r'report[aá]rio|grande\s*reportagem|sexta\s*[àa]s\s*9|'
    r'document[aá]rio|national\s*geographic|discovery|'
    r'selvag|natureza|planet\s*earth|'
    r'magazine|zig\s*zag|batatoon|cartoon|'
    r'andebol|basquete|ténis|ciclismo|atletismo|'
    r'toiro|touro|eurovis[ãa]o|'
    r'concurso|o\s*pre[çc]o\s*certo|joker(?!\s)|'
    r'the\s*wall|quem\s*quer\s*ser\s*milion',
    re.IGNORECASE,
)

EP_RE = re.compile(
    r'(?:ep\.?\s*\d|episódio|temporada|season|'
    r's\d{1,2}\s*e\d|t\d{1,2}\s*[-–]\s*ep|\bT\d{1,2}\b(?:\s*[-–]))',
    re.IGNORECASE,
)

FICTION_HINTS = re.compile(
    r'inspector|detetive|detective|criminal|crime|mystery|thriller|'
    r'murder|assassin|homicí|polícia|swat|fbi|cia|csi|ncis|law\s*&|'
    r'hospital|médic|grey|house\s*m|emergên|'
    r'sci-fi|fantasy|fantasia|dragon|zombie|vampire|'
    r'guerra|war|battle|combat|adónis|herói|vista\s*larga',
    re.IGNORECASE,
)

# ---- JustWatch streaming platforms ----

PLATFORM_PATHS = {
    '/provedor/netflix': 'Netflix',
    '/provedor/disney-plus': 'Disney+',
    '/provedor/max': 'Max',
    '/provedor/amazon-prime-video': 'Prime Video',
    '/provedor/apple-tv-plus': 'Apple TV+',
    '/provedor/skyshowtime': 'SkyShowtime',
}


# ---- OMDb rating lookup (with persistent file cache) ----

OMDB_CACHE_FILE = os.path.join(DIR, 'omdb_cache.json')

def _load_omdb_cache():
    try:
        with open(OMDB_CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_omdb_cache(cache):
    with open(OMDB_CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)

_omdb_cache = _load_omdb_cache()

def omdb_lookup(title):
    if title in _omdb_cache:
        return _omdb_cache[title]
    try:
        q = urllib.parse.quote(title)
        url = f'http://www.omdbapi.com/?t={q}&apikey={OMDB_KEY}'
        req = urllib.request.Request(url)
        raw = urllib.request.urlopen(req, timeout=5).read()
        data = json.loads(raw)
        if data.get('Response') == 'True':
            result = {
                'imdb': float(data['imdbRating']) if data.get('imdbRating', 'N/A') != 'N/A' else None,
                'year': data.get('Year', ''),
                'genre': data.get('Genre', ''),
                'poster': data.get('Poster', ''),
            }
        else:
            result = {}
    except Exception:
        result = {}
    _omdb_cache[title] = result
    _save_omdb_cache(_omdb_cache)
    return result


# ---- MEO TV functions ----

def meo_fetch(url):
    req = urllib.request.Request(url, headers=MEO_HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=15).read())


def get_meo_channels():
    url = 'https://meogouser.apps.meo.pt/Services/GridTv/GridTv.svc/GetContentsForChannels?userAgent=IPTV_OFR_GTV'
    return meo_fetch(url).get('Result', [])


def get_meo_programs(call_letter, target_date):
    url = (
        f'https://meogouser.apps.meo.pt/Services/GridTv/GridTv.svc/'
        f'GetLiveChannelProgramsByDate?callLetter={urllib.parse.quote(call_letter)}'
        f'&date={target_date}&userAgent=IPTV_OFR_GTV'
    )
    return meo_fetch(url).get('Result', [])


def classify_tv(title, synopsis, channel_id):
    text = f'{title} {synopsis}'.lower()
    has_ep = bool(EP_RE.search(title))
    if channel_id in MOVIE_CHANNELS:
        return 'series' if has_ep else 'movie'
    if channel_id in SERIES_CHANNELS:
        return 'series'
    if channel_id in GENERAL_CHANNELS:
        if has_ep or FICTION_HINTS.search(text):
            return 'series'
        if any(k in text for k in ['filme', 'movie', 'cinema', 'telefilme']):
            return 'movie'
    return None


def extract_episode(title):
    m = re.search(r'[-–]\s*Ep\.?\s*(\d+)', title)
    episode = int(m.group(1)) if m else None
    m2 = re.search(r'\bT(\d{1,2})\b\s*[-–]', title)
    season = int(m2.group(1)) if m2 else None
    clean = re.sub(r'\s*[-–]\s*(?:T\d{1,2}\s*[-–]\s*)?Ep\.?\s*\d+.*$', '', title).strip()
    clean = re.sub(r'\s*\bT\d{1,2}\b$', '', clean).strip()
    return clean, season, episode


def build_tv_schedule(target_date):
    all_channels = get_meo_channels()
    channel_map = {ch['CallLetter']: ch['Title'] for ch in all_channels}
    to_fetch = [c for c in ALL_TV_CHANNELS if c in channel_map]

    programs = []
    for cl in to_fetch:
        try:
            progs = get_meo_programs(cl, target_date)
        except Exception:
            continue
        for p in progs:
            title = p.get('Title', '')
            synopsis = p.get('Synopsis', '')
            if SKIP_RE.search(f'{title} {synopsis}'):
                continue
            cat = classify_tv(title, synopsis, cl)
            if not cat:
                continue
            clean, season, episode = extract_episode(title)
            encoded = urllib.parse.quote(title)
            image = (
                f'https://cdn-er-images.online.meo.pt/eemstb/ImageHandler.ashx'
                f'?chCallLetter={cl}&progTitle={encoded}'
                f'&profile=16_9&profileFallback=false&noFallback=true'
                f'&appSource=PC_CHROME_PWA&width=640&csf'
            )
            programs.append({
                'title': clean,
                'originalTitle': title,
                'channel': channel_map.get(cl, cl),
                'channelId': cl,
                'start': p.get('StartDate', ''),
                'end': p.get('EndDate', ''),
                'synopsis': synopsis,
                'category': cat,
                'season': season,
                'episode': episode,
                'image': image,
                'source': 'tv',
            })

    seen_titles = set()
    for prog in programs:
        t = prog['title']
        if t not in seen_titles:
            seen_titles.add(t)
            info = omdb_lookup(t)
            if info.get('imdb'):
                prog['imdb'] = info['imdb']
            if info.get('poster') and info['poster'] != 'N/A':
                prog['omdb_poster'] = info['poster']
        else:
            cached = _omdb_cache.get(t, {})
            if cached.get('imdb'):
                prog['imdb'] = cached['imdb']
            if cached.get('poster') and cached['poster'] != 'N/A':
                prog['omdb_poster'] = cached['poster']

    print(f'  OMDb: looked up {len(seen_titles)} unique titles')
    programs.sort(key=lambda p: p.get('start', ''))
    return programs


# ---- JustWatch streaming functions ----

def parse_apollo(html):
    match = re.search(r'window\.__APOLLO_STATE__\s*=\s*', html)
    if not match:
        return {}
    start = match.end()
    depth = 0
    for i in range(start, min(start + 600000, len(html))):
        if html[i] == '{':
            depth += 1
        elif html[i] == '}':
            depth -= 1
            if depth == 0:
                break
    return json.loads(html[start:i + 1]).get('defaultClient', {})


def extract_jw_titles(dc, platform=''):
    items = []
    for k, v in dc.items():
        if not (k.startswith('Show:') or k.startswith('Movie:')): continue
        if not isinstance(v, dict): continue

        obj_type = v.get('objectType', '')
        content_ref = v.get('content({"country":"PT","language":"pt"})', {})
        content_id = content_ref.get('id', '') if isinstance(content_ref, dict) else ''
        content = dc.get(content_id, {})
        scoring = dc.get(f'{content_id}.scoring', {})

        poster_url = content.get('posterUrl({})') or content.get('posterUrl', '')
        if poster_url:
            poster_url = (
                f'https://images.justwatch.com{poster_url}'
                .replace('{profile}', 's332')
                .replace('{format}', 'webp')
            )

        items.append({
            'title': content.get('title', '?'),
            'type': 'movie' if obj_type == 'MOVIE' else 'series',
            'year': content.get('originalReleaseYear', ''),
            'imdb': scoring.get('imdbScore'),
            'tmdb': scoring.get('tmdbScore'),
            'tomato': scoring.get('tomatoMeter'),
            'platforms': [platform] if platform else [],
            'poster': poster_url,
            'description': content.get('shortDescription', ''),
        })
    return items


def fetch_jw_page(path):
    url = f'https://www.justwatch.com/pt{path}'
    req = urllib.request.Request(url, headers=JW_HEADERS)
    html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')
    return parse_apollo(html)


def build_streaming():
    all_items = {}

    for path, platform in PLATFORM_PATHS.items():
        try:
            dc = fetch_jw_page(path)
            items = extract_jw_titles(dc, platform)
            for item in items:
                key = f'{item["type"]}:{item["title"]}'
                if key in all_items:
                    if platform not in all_items[key]['platforms']:
                        all_items[key]['platforms'].append(platform)
                    if item.get('imdb') and not all_items[key].get('imdb'):
                        all_items[key]['imdb'] = item['imdb']
                        all_items[key]['tmdb'] = item['tmdb']
                        all_items[key]['tomato'] = item['tomato']
                else:
                    all_items[key] = item
        except Exception as e:
            print(f'  JustWatch {platform}: {e}')

    for path in ['', '/filmes', '/series']:
        try:
            dc = fetch_jw_page(path)
            items = extract_jw_titles(dc)
            for item in items:
                key = f'{item["type"]}:{item["title"]}'
                if key in all_items:
                    if item.get('imdb') and not all_items[key].get('imdb'):
                        all_items[key]['imdb'] = item['imdb']
                        all_items[key]['tmdb'] = item['tmdb']
                        all_items[key]['tomato'] = item['tomato']
                else:
                    all_items[key] = item
        except Exception:
            pass

    results = []
    for item in all_items.values():
        results.append({
            'title': item['title'],
            'category': item['type'],
            'year': item.get('year', ''),
            'imdb': item.get('imdb'),
            'tmdb': item.get('tmdb'),
            'tomato': item.get('tomato'),
            'platforms': item.get('platforms', []),
            'image': item.get('poster', ''),
            'synopsis': item.get('description', ''),
            'source': 'streaming',
        })

    results.sort(key=lambda x: x.get('imdb') or 0, reverse=True)
    return results


# ---- Combined API (with 30-min cache) ----

CACHE_TTL = 1800
_api_cache = {}
_cache_lock = threading.Lock()


def build_all(target_date=None):
    if target_date is None:
        target_date = date.today().isoformat()

    with _cache_lock:
        cached = _api_cache.get(target_date)
        if cached and time.time() - cached['ts'] < CACHE_TTL:
            print(f'  Cache hit for {target_date}')
            return cached['data']

    print(f'  Fetching TV schedule for {target_date}...')
    tv_programs = build_tv_schedule(target_date)
    print(f'  TV: {len(tv_programs)} programs')

    print(f'  Fetching streaming catalog...')
    streaming = build_streaming()
    print(f'  Streaming: {len(streaming)} titles')

    data = {
        'date': target_date,
        'tv': {
            'count': len(tv_programs),
            'programs': tv_programs,
        },
        'streaming': {
            'count': len(streaming),
            'titles': streaming,
        },
    }

    with _cache_lock:
        _api_cache[target_date] = {'data': data, 'ts': time.time()}

    return data


# ---- HTTP Server ----

class PipocaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/all':
            params = urllib.parse.parse_qs(parsed.query)
            target_date = params.get('date', [date.today().isoformat()])[0]
            try:
                data = build_all(target_date)
                self.send_json(data)
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
        else:
            super().do_GET()

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        accept_enc = self.headers.get('Accept-Encoding', '')
        if 'gzip' in accept_enc:
            body = gzip.compress(raw)
            encoding = 'gzip'
        else:
            body = raw
            encoding = None
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        if encoding:
            self.send_header('Content-Encoding', encoding)
        self.send_header('Cache-Control', 'public, max-age=300')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if self.path and not self.path.startswith('/api/'):
            ext = self.path.split('?')[0].rsplit('.', 1)[-1]
            if ext in ('css', 'js', 'png', 'jpg', 'webp', 'ico', 'woff2'):
                self.send_header('Cache-Control', 'public, max-age=3600')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/api/' in (args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(DIR)
    server = http.server.HTTPServer(('', PORT), PipocaHandler)
    print(f'🍿 Pipoca a servir em http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nA desligar...')
        server.shutdown()
