@echo off
rem Serves Song Cards at http://127.0.0.1:8888/ (the redirect URI registered with Spotify).
cd /d "%~dp0"
start "" http://127.0.0.1:8888/
python -m http.server 8888 --bind 127.0.0.1
