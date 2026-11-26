#!/usr/bin/env bash
# tmdb-check.sh: the showcase app's live-data contract with TMDB.
#
# The showcase scenarios replay against the real TMDB API, so they pass only while the
# facts they rely on still hold (Shawshank's id, title and runtime, a search that finds
# nothing, the filters that find it, ...). This script checks those facts with curl + jq
# before any device boots, and `--reachability` tells a TMDB outage from a real failure
# after a scenario fails. A red run here is TMDB, not mauto.
#
# It is app-specific. If you copy the showcase workflow for your own app, replace this
# script with a check of your own app's live dependencies, or drop it.
#
# Usage:
#   TMDB_API_KEY=... showcase-app/ci/tmdb-check.sh                 # every check
#   TMDB_API_KEY=... showcase-app/ci/tmdb-check.sh --reachability  # one cheap call only
#   TMDB_BASE_URL overrides https://api.themoviedb.org/3 (used to test the outage path).
#
# Exit codes:
#   0   healthy
#   10  TMDB outage: network failure, timeout, HTTP 5xx, or 429 after retries
#   11  data drift: a fact the scenarios rely on has changed (full mode only)
#   12  key missing, or rejected by TMDB (HTTP 401, status_code 7)
#
# The key goes to curl through a config on stdin, so it is never in argv, a URL that is
# printed, or the output. curl's own error text is discarded; failures name only the path.
#
# The discover parameter names below are literal on purpose: a lint guard compares them
# with the `put("...")` keys and MIN_VOTES_FOR_RATING in the app's FilterState.kt.

set -uo pipefail

readonly EXIT_OUTAGE=10 EXIT_DRIFT=11 EXIT_KEY=12
readonly BASE_URL="${TMDB_BASE_URL:-https://api.themoviedb.org/3}"
# FilterState.kt's MIN_VOTES_FOR_RATING: sent whenever a minimum rating or Highest rated is set.
readonly MIN_VOTES_FOR_RATING=200
# The scenarios wait for Shawshank without scrolling, so it must be near the top of the list.
readonly TOP_N=3

mode=full
case "${1:-}" in
  '') ;;
  --reachability) mode=reachability ;;
  *) echo "usage: $0 [--reachability]" >&2; exit 2 ;;
esac

for tool in curl jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "tmdb-check: $tool is required" >&2; exit 2; }
done

if [ -z "${TMDB_API_KEY:-}" ]; then
  echo "::error title=TMDB key rejected::TMDB_API_KEY is not set"
  exit "$EXIT_KEY"
fi

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
drift=0

outage() { # <path> <reason>
  echo "OUTAGE $1: $2"
  echo "::error title=TMDB outage (not mauto)::$1: $2"
  exit "$EXIT_OUTAGE"
}

# tmdb <path> [name=value ...]: a GET whose body lands in $body_file and whose HTTP status
# lands in $last_status. Exits on a rejected key and on an outage; any other status
# returns, and the checks report a non-2xx as drift.
last_status=""
tmdb() {
  local path="$1" status rc p
  shift
  local args=(-s -G -o "$body_file" -w '%{http_code}' --max-time 20
              --retry 2 --retry-delay 2 --retry-connrefused -K -)
  for p in "$@"; do args+=(--data-urlencode "$p"); done
  # The key reaches curl on stdin as a config line, never on the command line.
  status="$(printf 'url = "%s/%s?api_key=%s"\n' "$BASE_URL" "$path" "$TMDB_API_KEY" \
    | curl "${args[@]}" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      6) outage "/$path" "could not resolve host" ;;
      7) outage "/$path" "could not connect" ;;
      28) outage "/$path" "timed out after 20s" ;;
      35|60) outage "/$path" "TLS failure (curl exit $rc)" ;;
      *) outage "/$path" "network failure (curl exit $rc)" ;;
    esac
  fi
  last_status="$status"
  case "$status" in
    401)
      if [ "$(jq -r '.status_code // empty' "$body_file" 2>/dev/null)" = 7 ]; then
        echo "KEY /$path: HTTP 401, status_code 7"
        echo "::error title=TMDB key rejected::/$path: HTTP 401, status_code 7 (invalid API key)"
        exit "$EXIT_KEY"
      fi ;;
    429) outage "/$path" "HTTP 429 (rate limited) after retries" ;;
    5??) outage "/$path" "HTTP $status" ;;
  esac
  return 0
}

# The actual value for a check: jq's answer on a 2xx, otherwise the HTTP status.
actual() { # <jq expression>
  if [[ "$last_status" != 2?? ]]; then echo "HTTP $last_status"; return; fi
  jq -r "$1" "$body_file" 2>/dev/null || echo "(unparsable body)"
}

ok() { echo "ok $1"; }

drifted() { # <name> <expected> <got>
  echo "DRIFT $1: expected $2, got $3"
  echo "::error title=TMDB data drift::$1: expected $2, got $3"
  drift=1
}

# check <name> <expected> <jq expression printing the actual value>
check() {
  local got
  got="$(actual "$3")"
  if [ "$got" = "$2" ]; then ok "$1"; else drifted "$1" "$2" "${got:-(empty)}"; fi
}

# check_rank <name> <id>: the id is among the first TOP_N results of the last list.
check_rank() {
  local rank
  rank="$(actual "[.results[]?.id] | index($2) // \"absent\"")"
  if [[ "$rank" =~ ^[0-9]+$ ]] && [ "$rank" -lt "$TOP_N" ]; then
    ok "$1"
  else
    [[ "$rank" =~ ^[0-9]+$ ]] && rank="position $((rank + 1))"
    drifted "$1" "id $2 in the first $TOP_N results of page 1" "$rank"
  fi
}

if [ "$mode" = reachability ]; then
  tmdb configuration
  echo "ok reachability"
  exit 0
fi

# Details: every scenario that opens Shawshank (search_open_details, details_layout_*, ...).
tmdb movie/278 language=en-US
check movie_278_title "The Shawshank Redemption" '.title'
check movie_278_release_year 1994 '.release_date[0:4]'
check movie_278_runtime 142 '.runtime'
check movie_278_has_overview true '(.overview // "") | length > 0'

# Search, sent as KtorTmdbClient.searchMovies sends it.
tmdb search/movie query=Shawshank include_adult=false language=en-US page=1
check_rank search_shawshank_finds_278 278

tmdb search/movie query=xqzvbnmkw include_adult=false language=en-US page=1
check search_xqzvbnmkw_empty 0 '.total_results'

# Genres: the Filters screen picks Drama and Animation by name; discover sends their ids.
tmdb genre/movie/list language=en-US
check genre_drama_id 18 '[.genres[]? | select(.name == "Drama") | .id][0] // "absent"'
check genre_animation_id 16 '[.genres[]? | select(.name == "Animation") | .id][0] // "absent"'

# filter_drama_1994: Drama, 1994, Rated 8+, Highest rated (FilterState.toDiscoverQuery).
tmdb discover/movie \
  "sort_by=vote_average.desc" "include_adult=false" "language=en-US" "page=1" \
  "with_genres=18" "primary_release_year=1994" "vote_average.gte=8" \
  "vote_count.gte=$MIN_VOTES_FOR_RATING"
check_rank discover_drama_1994_rated_8_finds_278 278

# filter_no_results: Animation, 1931, Rated 9+, default sort (Most popular).
tmdb discover/movie \
  "sort_by=popularity.desc" "include_adult=false" "language=en-US" "page=1" \
  "with_genres=16" "primary_release_year=1931" "vote_average.gte=9" \
  "vote_count.gte=$MIN_VOTES_FOR_RATING"
check discover_animation_1931_rated_9_empty 0 '.total_results'

# browse_popular and every scenario that waits for the list to load.
tmdb movie/popular language=en-US page=1
check popular_not_empty true '(.results // []) | length >= 1'

# rate_and_remove starts a guest session. Nothing is rated here; the replay does that.
tmdb authentication/guest_session/new
check guest_session_created true '(.success == true) and ((.guest_session_id // "") | length > 0)'

[ "$drift" -eq 0 ] || exit "$EXIT_DRIFT"
exit 0
